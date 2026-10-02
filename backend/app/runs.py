"""Executes one agent run and reports progress on an event channel."""

from __future__ import annotations

import logging
import time
from typing import Any, Literal

from pydantic import BaseModel, Field

from .agent.events import Event, EventChannel, new_id
from .agent.llm import LLMBackend
from .agent.loop import run_agent
from .agent.qloo_tools import GENERAL_TOOLS
from .agent.tools import ToolContext
from .qloo.client import QlooClient

log = logging.getLogger(__name__)

EXPLORE_SYSTEM = """You help people discover things they will love, grounded in Qloo's taste data.
Work in this order: resolve the user's favorites to Qloo entities with resolve_entities, then call
recommend for the requested domain. Never recommend anything that did not come back from a tool.
If a favorite is ambiguous, say which match you used. Describe results as what audiences with this
taste tend to like, not as facts about the user. Finish with a short, friendly summary (under 120
words) that names the top picks and the favorites that drove them."""


class ExploreInput(BaseModel):
    favorites: list[str] = Field(min_length=1, max_length=6)
    target: str = "urn:entity:place"
    location: str = ""


class RunRequest(BaseModel):
    scenario: Literal["explore"] = "explore"
    input: ExploreInput


async def execute_run(
    channel: EventChannel, backend: LLMBackend, qloo: QlooClient, request: RunRequest
) -> None:
    run_id = new_id("run")
    started = time.perf_counter()
    qloo_calls = 0
    usage: dict[str, int] | None = None

    async def emit(event: Event) -> None:
        nonlocal qloo_calls
        if event.get("type") == "tool_result":
            qloo_calls += len(event.get("requests") or [])
        await channel.emit(event)

    await emit({"type": "run_started", "run_id": run_id, "mode": "live"})
    try:
        ctx = ToolContext(qloo=qloo)
        data = request.input
        prompt = f"My favorites: {', '.join(data.favorites)}. Recommend: {data.target}." + (
            f" Location: {data.location}." if data.location else ""
        )
        outcome = await run_agent(
            backend,
            system=[{"type": "text", "text": EXPLORE_SYSTEM}],
            user_content=prompt,
            tools=GENERAL_TOOLS,
            ctx=ctx,
            emit=emit,
        )
        usage = outcome.usage
        if outcome.stop == "done":
            result: dict[str, Any] = {"text": outcome.text, "tool_data": ctx.state.get("tool_data", {})}
            await emit({"type": "result", "kind": "explore", "data": result})
        else:
            await emit(
                {
                    "type": "error",
                    "message": _stop_message(outcome.stop),
                    "retryable": outcome.stop != "refusal",
                }
            )
    except Exception:
        log.exception("Run %s failed", run_id)
        await emit(
            {
                "type": "error",
                "message": "Something went wrong on our side. Please try again.",
                "retryable": True,
            }
        )
    finally:
        await channel.emit(
            {
                "type": "run_finished",
                "run_id": run_id,
                "usage": usage,
                "qloo_calls": qloo_calls,
                "elapsed_ms": round((time.perf_counter() - started) * 1000),
            }
        )
        await channel.close()


def _stop_message(stop: str) -> str:
    return {
        "refusal": "The model declined this request.",
        "max_tokens": "The answer was cut off. Please try again.",
        "max_turns": "The agent ran out of steps before finishing. Please try a narrower request.",
    }.get(stop, "The run did not finish.")
