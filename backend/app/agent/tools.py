"""Tool registry and concurrent tool execution for the agent loop."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from typing import Any

from ..qloo.client import QlooClient, QlooError, record_requests
from .events import Emit, Provenance

log = logging.getLogger(__name__)


class ToolInputError(Exception):
    """The model called a tool with arguments the tool can't use; the message goes back to the model."""


@dataclass(frozen=True)
class ToolOutput:
    content: str  # what the model reads (compact JSON or short text)
    summary: str  # one line for the run log in the UI
    data: Any = None  # structured payload kept server-side for the final artifact


@dataclass
class ToolContext:
    qloo: QlooClient
    state: dict[str, Any] = field(default_factory=dict)


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
    tool_uses: Sequence[Any], registry: Mapping[str, Tool], ctx: ToolContext, emit: Emit
) -> list[dict[str, Any]]:
    """Run every tool call from one assistant turn concurrently.

    Returns the ``tool_result`` blocks in the original order so they can be sent back to the
    model in a single user message.
    """

    async def run_one(block: Any) -> dict[str, Any]:
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
        with record_requests() as records:
            try:
                if tool is None:
                    raise ToolInputError(f"Unknown tool '{block.name}'.")
                output = await tool.handler(dict(block.input), ctx)
                ok, content, summary = True, output.content, output.summary
                if output.data is not None:
                    ctx.state.setdefault("tool_data", {})[block.id] = output.data
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

    return list(await asyncio.gather(*(run_one(block) for block in tool_uses)))
