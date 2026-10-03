"""Executes one agent run and reports progress on an event channel."""

from __future__ import annotations

import logging
import time
from typing import Any, Literal

from pydantic import BaseModel, Field

from .agent.clash_tools import CLASH_TOOLS
from .agent.events import Event, EventChannel, new_id
from .agent.llm import LLMBackend
from .agent.loop import run_agent
from .agent.qloo_tools import GENERAL_TOOLS
from .agent.tools import ToolContext
from .presets import Preset
from .qloo.client import QlooClient
from .schedule.models import BaselineStats, Constraints, Festival, ScoringConfig, SetSlot

log = logging.getLogger(__name__)

EXPLORE_SYSTEM = """You help people discover things they will love, grounded in Qloo's taste data.
Work in this order: resolve the user's favorites to Qloo entities with resolve_entities, then call
recommend for the requested domain. Never recommend anything that did not come back from a tool.
If a favorite is ambiguous, say which match you used. Describe results as what audiences with this
taste tend to like, not as facts about the user. Finish with a short, friendly summary (under 120
words) that names the top picks and the favorites that drove them."""


CLASH_SYSTEM = """You are Clash Control, a programming assistant for one day of a festival timetable.
A clash is two sets on different stages at the same time. Its cost = how many fans are at stake (draw,
Qloo popularity) x how many of them are the same people (shared audience: Qloo's measure of taste overlap
between the two acts' audiences, 0-1, relative to this lineup) x minutes overlapping. Shared audience is
taste, not attendance.

How to work:
- Every number you state must come from a tool result in this run. Never estimate.
- When the user states a programming rule ("keep X on the Pyramid", "nothing before 2pm", "X and Y must
  not overlap"), record it with add_constraint first.
- To answer "why", call explain_clash and use the shared taste it returns, not general knowledge.
- Before recommending any move, test it with try_move. If it breaks a rule, say which rule.
- Call reslot only when the user asks for suggestions. Present the result as suggestions, graded by the
  same measure (by Qloo's measure); do not call them optimal.
- If Qloo has no signal for an act, say its clashes cannot be priced.
- Answer in plain language, under 150 words, naming acts, stages and times. Do not judge the real
  festival's programming; it does not use this tool."""

MAX_HISTORY = 8


class ExploreInput(BaseModel):
    favorites: list[str] = Field(min_length=1, max_length=6)
    target: str = "urn:entity:place"
    location: str = ""


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(max_length=4000)


class ClashInput(BaseModel):
    """One message to the clash agent. The client keeps the session: it sends back the working timetable,
    constraints and rules that the previous run returned."""

    preset_id: str = Field(max_length=80)
    message: str = Field(min_length=1, max_length=600)
    history: list[ChatTurn] = Field(default_factory=list, max_length=MAX_HISTORY)
    timetable: list[SetSlot] | None = None
    constraints: Constraints | None = None
    rules: list[str] = Field(default_factory=list, max_length=30)


class RunRequest(BaseModel):
    scenario: Literal["explore", "clash"] = "explore"
    input: ExploreInput | ClashInput


class SessionError(ValueError):
    """The client's session does not fit the preset it names."""


def clash_state(preset: Preset, data: ClashInput) -> dict[str, Any]:
    festival = preset.festival
    if data.timetable is not None or data.constraints is not None:
        timetable = data.timetable if data.timetable is not None else festival.timetable
        if sorted(s.act_id for s in timetable) != sorted(s.act_id for s in festival.timetable):
            raise SessionError("The timetable does not match this festival day.")
        update: dict[str, Any] = {"timetable": [s.model_dump() for s in timetable]}
        if data.constraints is not None:
            update["constraints"] = data.constraints.model_dump()
        try:
            festival = Festival.model_validate({**festival.model_dump(), **update})
        except ValueError as exc:
            raise SessionError("The timetable is not valid for this festival day.") from exc
    baseline = BaselineStats.model_validate(preset.report["baseline"])
    return {
        "festival": festival,
        "matrix": preset.matrix,
        "config": ScoringConfig(baseline=baseline),
        "constraints": list(data.rules),
    }


def clash_prompt(festival: Festival, data: ClashInput) -> str:
    lines = [f"Festival day: {festival.name}."]
    if data.rules:
        lines.append("Rules already recorded: " + "; ".join(data.rules) + ".")
    if data.history:
        lines.append("Earlier in this conversation:")
        lines += [f"{'User' if t.role == 'user' else 'You'}: {t.text}" for t in data.history[-MAX_HISTORY:]]
    lines.append(f"User: {data.message}")
    return "\n".join(lines)


async def execute_run(
    channel: EventChannel,
    backend: LLMBackend,
    qloo: QlooClient,
    request: RunRequest,
    presets: dict[str, Preset] | None = None,
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
        data = request.input
        if isinstance(data, ClashInput):
            preset = (presets or {}).get(data.preset_id)
            if preset is None:
                await emit(
                    {"type": "error", "message": "That festival day is not available.", "retryable": False}
                )
                return
            try:
                state = clash_state(preset, data)
            except SessionError as exc:
                await emit({"type": "error", "message": str(exc), "retryable": False})
                return
            ctx = ToolContext(qloo=qloo, state=state)
            system, prompt, tools = CLASH_SYSTEM, clash_prompt(state["festival"], data), CLASH_TOOLS
        else:
            ctx = ToolContext(qloo=qloo)
            system, tools = EXPLORE_SYSTEM, GENERAL_TOOLS
            prompt = f"My favorites: {', '.join(data.favorites)}. Recommend: {data.target}." + (
                f" Location: {data.location}." if data.location else ""
            )
        outcome = await run_agent(
            backend,
            system=[{"type": "text", "text": system}],
            user_content=prompt,
            tools=tools,
            ctx=ctx,
            emit=emit,
        )
        usage = outcome.usage
        if outcome.stop == "done":
            result: dict[str, Any] = {"text": outcome.text, "tool_data": ctx.state.get("tool_data", {})}
            if isinstance(data, ClashInput):
                festival: Festival = ctx.state["festival"]
                result["session"] = {
                    "timetable": [s.model_dump(mode="json") for s in festival.timetable],
                    "constraints": festival.constraints.model_dump(mode="json"),
                    "rules": ctx.state["constraints"],
                }
            await emit({"type": "result", "kind": request.scenario, "data": result})
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
