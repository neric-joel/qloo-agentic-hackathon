"""Tool registry and concurrent tool execution for the agent loop."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from typing import Any, TypeVar

from ..qloo.client import QlooClient, QlooError, record_requests
from .events import Emit, Provenance

log = logging.getLogger(__name__)
T = TypeVar("T")


TOO_MANY_CALLS = "Too many tool calls in one turn; the rest were skipped."
QLOO_BUDGET_USED = "Error: this run's Qloo budget is used up."
ENGINE_BUDGET_USED = "Error: this run's calculation budget is used up."
QLOO_PAUSED = "Error: Qloo's monthly allowance is nearly used up, so live Qloo requests are paused."
QLOO_CALLS = "qloo_calls"  # ToolContext.state key: Qloo requests made so far in this run


class ToolInputError(Exception):
    """The model called a tool with arguments the tool can't use; the message goes back to the model."""


class ToolRefused(Exception):
    """A run cap stopped this call before it ran; ``content`` goes back to the model as an error."""

    def __init__(self, content: str, summary: str) -> None:
        super().__init__(summary)
        self.content = content
        self.summary = summary


@dataclass(frozen=True)
class ToolOutput:
    content: str  # what the model reads (compact JSON or short text)
    summary: str  # one line for the run log in the UI
    data: Any = None  # structured payload kept server-side for the final artifact


@dataclass
class ToolContext:
    qloo: QlooClient
    state: dict[str, Any] = field(default_factory=dict)
    qloo_budget: int | None = None  # most Qloo requests one run may make; None means no cap
    reslot_budget: int | None = None  # most re-slots one run may make; None means no cap
    engine_budget: float | None = None  # most seconds of engine work one run may use; None means no cap
    # Qloo requests to keep in the month: below it Qloo-backed tools are refused; None means no floor
    qloo_floor: int | None = None
    reslots: int = 0
    engine_seconds: float = 0.0

    def take_reslot(self) -> None:
        """Count one re-slot, or refuse it once the run has had its share (checked before any await)."""
        if self.reslot_budget is not None and self.reslots >= self.reslot_budget:
            allowed = "one re-slot" if self.reslot_budget == 1 else f"{self.reslot_budget} re-slots"
            raise ToolRefused(f"Error: only {allowed} per run.", f"Skipped: {allowed} per run")
        self.reslots += 1

    async def engine(self, work: Callable[..., T], *args: Any) -> T:
        """Run CPU-bound engine work off the event loop and charge its wall time to the run.

        Work that starts under the budget finishes; once the budget is spent the next call is refused.
        """
        if self.engine_budget is not None and self.engine_seconds >= self.engine_budget:
            raise ToolRefused(ENGINE_BUDGET_USED, "Calculation budget for this run is used up")
        started = time.perf_counter()
        try:
            return await asyncio.to_thread(work, *args)
        finally:
            self.engine_seconds += time.perf_counter() - started

    def reserve_qloo(self, worst_case: int) -> None:
        """Reserve a Qloo-backed tool's worst-case requests before it runs, or refuse it.

        ``worst_case`` is the most requests the call can send: its calls times the client's attempts per call.
        The run's remaining budget must cover all of it, and the client must be able to promise it against the
        month's floor (``QlooClient.reserve``, the same reservation the pair check takes). Both are taken
        before any await, so concurrent calls in one turn cannot all pass the check. Pair every successful
        call with ``settle_qloo``, which swaps the reservation for the requests actually made.
        """
        used = self.state.get(QLOO_CALLS, 0)
        if self.qloo_budget is not None and used + worst_case > self.qloo_budget:
            raise ToolRefused(QLOO_BUDGET_USED, "Qloo budget for this run is used up")
        if not self.qloo.reserve(self.qloo_floor, worst_case):
            raise ToolRefused(QLOO_PAUSED, "Qloo allowance paused")
        self.state[QLOO_CALLS] = used + worst_case

    def settle_qloo(self, worst_case: int, made: int) -> None:
        """Give back a reservation and charge the run for the ``made`` requests the tool actually sent."""
        self.qloo.release(worst_case)
        self.state[QLOO_CALLS] = max(0, self.state.get(QLOO_CALLS, 0) - worst_case) + made


Handler = Callable[[dict[str, Any], ToolContext], Awaitable[ToolOutput]]


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    input_schema: dict[str, Any]
    handler: Handler
    provenance: Provenance = "qloo"
    # The tool changes the run's working state (the timetable or its rules), so within one model turn it runs
    # before the tools that only read that state
    mutates_state: bool = False
    # How many Qloo calls one invocation can make, from its input (a Qloo-backed tool only); each call can be
    # tried ``max_retries + 1`` times, so the request budget it reserves is this times the client's attempts
    qloo_calls: Callable[[dict[str, Any]], int] | None = None

    def worst_case_requests(self, args: dict[str, Any], qloo: QlooClient) -> int:
        """The most Qloo requests one invocation can send: its calls times the client's attempts per call."""
        calls = self.qloo_calls(args) if self.qloo_calls else 1
        return max(1, calls) * (qloo.max_retries + 1)

    def to_api(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
            "strict": True,
        }


async def run_tool_calls(
    tool_uses: Sequence[Any],
    registry: Mapping[str, Tool],
    ctx: ToolContext,
    emit: Emit,
    max_calls: int | None = None,
) -> list[dict[str, Any]]:
    """Run the tool calls from one model turn: the ones that change the run's state first, then the rest
    concurrently.

    A tool with ``mutates_state`` (a rule added with add_constraint) runs before the others, one call after
    another in the order the model gave them, so a same-turn what-if or search already sees the rule. Calls
    past ``max_calls`` are not run: each gets an error result, so the model can carry on. Returns the
    ``tool_result`` blocks in the original order so they can be sent back to the model in a single user
    message.
    """

    async def run_one(block: Any, skip: bool) -> dict[str, Any]:
        tool = registry.get(block.name)
        provenance: Provenance = tool.provenance if tool else "llm"
        await emit(
            {
                "type": "tool_call",
                "id": block.id,
                "tool": block.name,
                "input": block.input,
                "provenance": provenance,
            }
        )
        started = time.perf_counter()
        reserved = 0  # worst-case Qloo requests held for this call until it ends
        with record_requests() as records:
            try:
                if skip:
                    raise ToolRefused(TOO_MANY_CALLS, "Skipped: too many tool calls in one turn")
                if tool is None:
                    raise ToolInputError(f"Unknown tool '{block.name}'.")
                if tool.provenance == "qloo":
                    worst_case = tool.worst_case_requests(dict(block.input), ctx.qloo)
                    ctx.reserve_qloo(worst_case)
                    reserved = worst_case
                output = await tool.handler(dict(block.input), ctx)
                ok, content, summary = True, output.content, output.summary
                if output.data is not None:
                    ctx.state.setdefault("tool_data", {})[block.id] = output.data
            except ToolRefused as exc:
                ok, content, summary = False, exc.content, exc.summary
            except ToolInputError as exc:
                ok, content, summary = False, f"Error: {exc}", str(exc)
            except QlooError as exc:
                reason = exc.reason or str(exc)
                ok, content, summary = (
                    False,
                    f"Qloo error: {reason}",
                    f"Qloo error ({exc.status or 'network'})",
                )
            except Exception:
                log.exception("Tool %s failed", block.name)
                ok, content, summary = False, "Error: the tool failed unexpectedly.", "Tool failed"
            finally:
                # Swap the reservation for the requests the tool actually made (failed ones count too); this
                # also runs when the run is cancelled mid-call.
                if reserved:
                    ctx.settle_qloo(reserved, len(records))
                ctx.state.setdefault(QLOO_CALLS, 0)
        if records and all(r.recorded for r in records):
            provenance = "recorded"
        await emit(
            {
                "type": "tool_result",
                "id": block.id,
                "tool": block.name,
                "ok": ok,
                "summary": summary,
                "latency_ms": round((time.perf_counter() - started) * 1000),
                "provenance": provenance,
                "requests": [asdict(r) for r in records],
            }
        )
        result: dict[str, Any] = {"type": "tool_result", "tool_use_id": block.id, "content": content}
        if not ok:
            result["is_error"] = True
        return result

    limit = len(tool_uses) if max_calls is None else max_calls
    results: list[dict[str, Any] | None] = [None] * len(tool_uses)

    def changes_state(i: int, block: Any) -> bool:
        tool = registry.get(block.name)
        return i < limit and tool is not None and tool.mutates_state

    first = [i for i, block in enumerate(tool_uses) if changes_state(i, block)]
    for i in first:
        results[i] = await run_one(tool_uses[i], False)
    rest = [i for i in range(len(tool_uses)) if i not in first]
    for i, result in zip(
        rest, await asyncio.gather(*(run_one(tool_uses[i], i >= limit) for i in rest)), strict=True
    ):
        results[i] = result
    return [result for result in results if result is not None]
