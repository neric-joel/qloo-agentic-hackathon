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

    def take_qloo_slot(self) -> None:
        """Reserve one Qloo request before a Qloo-backed tool runs, or refuse it once the budget is used.

        Reserving up front keeps concurrent calls in one turn from all passing the check. A tool that
        starts under the cap finishes; the cap stops the next one.
        """
        used = self.state.get(QLOO_CALLS, 0)
        if self.qloo_budget is not None and used >= self.qloo_budget:
            raise ToolRefused(QLOO_BUDGET_USED, "Qloo budget for this run is used up")
        self.state[QLOO_CALLS] = used + 1


Handler = Callable[[dict[str, Any], ToolContext], Awaitable[ToolOutput]]


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    input_schema: dict[str, Any]
    handler: Handler
    provenance: Provenance = "qloo"

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
    """Run the tool calls from one model turn concurrently.

    Calls past ``max_calls`` are not run: each gets an error result, so the model can carry on. Returns
    the ``tool_result`` blocks in the original order so they can be sent back to the model in a single
    user message.
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
        reserved = 0
        with record_requests() as records:
            try:
                if skip:
                    raise ToolRefused(TOO_MANY_CALLS, "Skipped: too many tool calls in one turn")
                if tool is None:
                    raise ToolInputError(f"Unknown tool '{block.name}'.")
                if tool.provenance == "qloo":
                    ctx.take_qloo_slot()
                    reserved = 1
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

        # Swap the reserved slot for the requests the tool actually made (failed ones count too).
        ctx.state[QLOO_CALLS] = ctx.state.get(QLOO_CALLS, 0) + len(records) - reserved
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
    return list(await asyncio.gather(*(run_one(block, i >= limit) for i, block in enumerate(tool_uses))))
