"""The agent loop: model turn -> concurrent tool calls -> model turn, until the model is done."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from .events import Emit
from .llm import LLMBackend
from .tools import Tool, ToolContext, run_tool_calls

MAX_TURNS = 8


@dataclass
class RunOutcome:
    text: str
    turns: int
    stop: str  # "done" | "refusal" | "max_tokens" | "max_turns"
    usage: dict[str, int] = field(default_factory=lambda: {"input_tokens": 0, "output_tokens": 0})


async def run_agent(
    backend: LLMBackend,
    *,
    system: Sequence[dict[str, Any]],
    user_content: str | list[dict[str, Any]],
    tools: Sequence[Tool],
    ctx: ToolContext,
    emit: Emit,
    max_turns: int = MAX_TURNS,
    max_tool_calls: int | None = None,
) -> RunOutcome:
    registry = {tool.name: tool for tool in tools}
    api_tools = [tool.to_api() for tool in tools]
    messages: list[dict[str, Any]] = [{"role": "user", "content": user_content}]
    usage = {"input_tokens": 0, "output_tokens": 0}
    final_text: list[str] = []

    async def on_text(text: str) -> None:
        final_text.append(text)
        await emit({"type": "text_delta", "text": text})

    for turn in range(1, max_turns + 1):
        final_text.clear()
        response = await backend.turn(system=system, messages=messages, tools=api_tools, on_text=on_text)
        _add_usage(usage, response.usage)

        if response.stop_reason == "refusal":
            return RunOutcome("".join(final_text), turn, "refusal", usage)
        tool_uses = [block for block in response.content if block.type == "tool_use"]
        if not tool_uses:
            return RunOutcome("".join(final_text), turn, "done", usage)
        if response.stop_reason == "max_tokens":
            # A truncated tool input can parse as a valid partial object: never run it.
            return RunOutcome("".join(final_text), turn, "max_tokens", usage)

        messages.append({"role": "assistant", "content": response.content})
        results = await run_tool_calls(tool_uses, registry, ctx, emit, max_tool_calls)
        messages.append({"role": "user", "content": results})

    return RunOutcome("".join(final_text), max_turns, "max_turns", usage)


def _add_usage(totals: dict[str, int], usage: Any) -> None:
    if usage is None:
        return
    totals["input_tokens"] += (
        (getattr(usage, "input_tokens", 0) or 0)
        + (getattr(usage, "cache_read_input_tokens", 0) or 0)
        + (getattr(usage, "cache_creation_input_tokens", 0) or 0)
    )
    totals["output_tokens"] += getattr(usage, "output_tokens", 0) or 0
