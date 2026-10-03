"""Executes one agent run and reports progress on an event channel."""

from __future__ import annotations

import logging
import time
from collections.abc import Sequence
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from .agent.clash_tools import CLASH_TOOLS, bound_text, keep_apart_text, keep_stage_text, lock_text
from .agent.events import Event, EventChannel, new_id
from .agent.llm import LLMBackend
from .agent.loop import MAX_TURNS, run_agent
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
A clash is two sets on different stages at the same time. Its cost = how popular the two acts are (combined
draw, Qloo popularity) x how much their audiences overlap in taste (taste overlap, 0-100: Qloo's affinity
between the two acts' audiences, turned into a rank among the acts compared for this bill; tool results
call it taste_overlap_out_of_100) x minutes overlapping. Taste overlap measures taste, not attendance.
Never describe taste overlap as a percentage of fans or a headcount.
State taste overlap and draw as whole numbers out of 100, exactly as the tools give them, for example
"taste overlap 92 out of 100". Never write them as decimals.
Taste overlap, prices and the Clash Budget Index are calculated by this app from Qloo data. Do not call them
"Qloo's own measure" or "Qloo's score". Only the tags from explain_clash and each act's popularity are
values Qloo returned.
Quote the Clash Budget Index with one decimal, as the tools give it. Describe a move only by what it changes
("goes from 116.7 to 114.3"). Do not call a result an improvement and do not offer to find a bigger one.

How to work:
- Every number you state must come from a tool result in this run. Never estimate.
- When the user states a programming rule ("keep X on the Pyramid", "nothing before 2pm", "X and Y must
  not overlap"), record it with add_constraint first.
- To answer "why", call explain_clash and use the shared taste it returns, not general knowledge.
- To find where a set could go, call find_moves once; it checks every start on a 5-minute grid and lists
  the legal places, priced. Do not guess times
  with try_move. Use try_move for a specific move the user names. If a move breaks a rule, say which rule.
- Call reslot only when the user asks for suggestions. Describe its results as
  suggestions graded by the same measure used to find them.
- If Qloo has no signal for an act, say its clashes cannot be priced.
- Answer in plain language, under 150 words, naming acts, stages and times. Do not judge the real
  festival's programming; it does not use this tool."""

MAX_HISTORY = 8
# Bounds on what a client may send back as its session (every string reaches the prompt or the engine)
MAX_SESSION_SETS = 80
MAX_NO_CLASH_PAIRS = 50
MAX_BILLING_RULES = 10


class _Input(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)


class ExploreInput(_Input):
    favorites: list[Annotated[str, StringConstraints(max_length=80)]] = Field(min_length=1, max_length=6)
    target: str = Field(default="urn:entity:place", max_length=60)
    location: str = Field(default="", max_length=80)


class ChatTurn(_Input):
    role: Literal["user", "assistant"]
    text: str = Field(max_length=4000)


class ClashInput(_Input):
    """One message to the clash agent. The client keeps the session: it sends back the working timetable,
    constraints and rules that the previous run returned."""

    preset_id: str = Field(max_length=80)
    message: str = Field(min_length=1, max_length=600)
    history: list[ChatTurn] = Field(default_factory=list, max_length=MAX_HISTORY)
    timetable: list[SetSlot] | None = Field(default=None, max_length=MAX_SESSION_SETS)
    constraints: Constraints | None = None
    rules: list[Annotated[str, StringConstraints(max_length=200)]] = Field(
        default_factory=list, max_length=30
    )

    @field_validator("constraints")
    @classmethod
    def _bounded_constraints(cls, value: Constraints | None) -> Constraints | None:
        if value is not None and len(value.no_clash_with) > MAX_NO_CLASH_PAIRS:
            raise ValueError(f"at most {MAX_NO_CLASH_PAIRS} no_clash_with pairs are supported")
        if value is not None and len(value.billing_rules) > MAX_BILLING_RULES:
            raise ValueError(f"at most {MAX_BILLING_RULES} billing rules are supported")
        return value


class RunRequest(_Input):
    """What to run follows the input's shape; ``scenario`` may be left out, but it may not contradict it."""

    scenario: Literal["explore", "clash"] | None = None
    input: ExploreInput | ClashInput

    @model_validator(mode="after")
    def _scenario_matches_input(self) -> RunRequest:
        implied = "clash" if isinstance(self.input, ClashInput) else "explore"
        if self.scenario is not None and self.scenario != implied:
            raise ValueError(f"scenario {self.scenario!r} does not match a {implied} input")
        self.scenario = implied
        return self


class SessionError(ValueError):
    """The client's session does not fit the preset it names."""


def published_state(preset: Preset) -> dict[str, Any]:
    """The published day as the engine scores it: festival, matrix and a config with the preset's baseline."""
    baseline = BaselineStats.model_validate(preset.report["baseline"])
    return {"festival": preset.festival, "matrix": preset.matrix, "config": ScoringConfig(baseline=baseline)}


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
        if not _only_tightens(preset.festival, festival):
            raise SessionError("The timetable does not match this festival day.")
    # The rules the model is told come from the timetable and constraints the engine will use, never from the
    # client's own list of rule texts (``data.rules``, still accepted from older pages, is not read)
    return {
        **published_state(preset),
        "festival": festival,
        "constraints": recorded_rules(preset.festival, festival),
    }


def recorded_rules(published: Festival, session: Festival) -> list[str]:
    """One line for each rule the session holds that the published day does not, worded as ``add_constraint``
    words it: sets locked now but not published, sets kept on their stage, start bounds, and pairs kept apart.

    Read from the structure the engine uses, so a line is there exactly when the engine holds the rule.
    """
    names = session.act_by_id()
    stages = session.stage_by_id()
    before = {slot.act_id: slot for slot in published.timetable}
    kinds: dict[str, list[str]] = {"lock": [], "stage": [], "not_before": [], "not_after": []}
    for slot in session.timetable:
        was, name = before[slot.act_id], names[slot.act_id].name
        if slot.locked and not was.locked:
            kinds["lock"].append(lock_text(name))
        pinned = slot.stages == [slot.stage_id] and was.stages != [slot.stage_id]
        if pinned or (slot.stage_locked and not was.stage_locked):
            kinds["stage"].append(keep_stage_text(name, stages[slot.stage_id].name))
        for kind in ("not_before", "not_after"):
            bound = getattr(slot, kind)
            if bound is not None and bound != getattr(was, kind):
                kinds[kind].append(bound_text(kind, name, bound))
    lines = [line for group in kinds.values() for line in group]
    held = {frozenset(pair) for pair in published.constraints.no_clash_with}
    for a, b in session.constraints.no_clash_with:
        if frozenset((a, b)) not in held:
            held.add(frozenset((a, b)))
            lines.append(keep_apart_text(names[a].name, names[b].name))
    return lines


def _only_tightens(published: Festival, session: Festival) -> bool:
    """Whether a session could have come from the published day. The agent never applies a move, and a rule
    may add a lock, narrow a start window or a stage list, or keep two acts apart, never the reverse; so a
    real session has every set where it was published and is at least as constrained."""
    fixed = {"no_clash_with"}
    if session.constraints.model_dump(exclude=fixed) != published.constraints.model_dump(exclude=fixed):
        return False
    pairs = {frozenset(pair) for pair in session.constraints.no_clash_with}
    if any(frozenset(pair) not in pairs for pair in published.constraints.no_clash_with):
        return False
    slots = {slot.act_id: slot for slot in session.timetable}
    return all(_slot_tightens(slot, slots[slot.act_id]) for slot in published.timetable)


def _slot_tightens(published: SetSlot, slot: SetSlot) -> bool:
    place = ("day", "stage_id", "start", "end")
    if any(getattr(slot, name) != getattr(published, name) for name in place):
        return False
    if (published.locked and not slot.locked) or (published.stage_locked and not slot.stage_locked):
        return False
    if published.not_before is not None and (
        slot.not_before is None or slot.not_before < published.not_before
    ):
        return False
    if published.not_after is not None and (slot.not_after is None or slot.not_after > published.not_after):
        return False
    # Without a published list any list passes: the festival already requires it to hold the set's stage
    return published.stages is None or (slot.stages is not None and set(slot.stages) <= set(published.stages))


def clash_prompt(festival: Festival, data: ClashInput, rules: Sequence[str] = ()) -> str:
    """The user turn: the day, the rules the session holds (``recorded_rules``) and the conversation."""
    lines = [f"Festival day: {festival.name}."]
    if rules:
        lines.append("Rules already recorded: " + "; ".join(rules) + ".")
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
    *,
    max_turns: int = MAX_TURNS,
    max_tool_calls: int | None = None,
    max_qloo_calls: int | None = None,
    max_reslots: int | None = None,
    max_engine_seconds: float | None = None,
    qloo_floor: int | None = None,
) -> None:
    """Run one agent request. The caps (model turns, tool calls per turn, Qloo requests, re-slots and
    seconds of engine work) and the monthly Qloo floor come from the caller's settings; ``None`` leaves that
    cap off."""
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
            ctx = ToolContext(
                qloo=qloo,
                state=state,
                qloo_budget=max_qloo_calls,
                reslot_budget=max_reslots,
                engine_budget=max_engine_seconds,
                qloo_floor=qloo_floor,
            )
            system, prompt, tools = (
                CLASH_SYSTEM,
                clash_prompt(state["festival"], data, state["constraints"]),
                CLASH_TOOLS,
            )
        else:
            ctx = ToolContext(qloo=qloo, qloo_budget=max_qloo_calls, qloo_floor=qloo_floor)
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
            max_turns=max_turns,
            max_tool_calls=max_tool_calls,
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
