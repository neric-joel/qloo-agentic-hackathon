"""Tools the agent uses to inspect, question and re-slot one festival day.

The session state (``ctx.state``) holds the working ``festival``, its Qloo ``matrix`` and a scoring ``config``
with a fixed random-timetable baseline, so every number the agent quotes is on the same scale. Constraint
tools change the working festival; ``try_move`` never does.

Each tool returns ``content`` (what the model reads) and ``data`` (what the web app's cards read). The content
uses the page's units: taste overlap and draw as whole numbers out of 100, a Clash Budget Index with one
decimal. The data keeps the engine's values unchanged.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from typing import Any

from pydantic import ValidationError

from ..qloo.overlap import shared_taste
from ..schedule.layout import Layout, Placement
from ..schedule.metrics import score_festival
from ..schedule.models import Festival, OverlapMatrix, ScoringConfig, SetSlot, format_minutes, parse_minutes
from ..schedule.moves import grid_moves
from ..schedule.optimizer import optimize
from ..schedule.reports import ScoreReport
from .tools import Tool, ToolContext, ToolInputError, ToolOutput

MAX_MOVE_BUDGET = 12
CONSTRAINT_KINDS = ["lock", "keep_stage", "not_before", "not_after", "keep_apart"]
# Clashes ranked when a set's own clashes are listed: every pair (the day's report ranks its 15 costliest).
# The Clash Budget Index is computed from every pair either way, so this changes lists, never a budget.
ALL_PAIRS = 200


def _compact(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def _state(ctx: ToolContext) -> tuple[Festival, OverlapMatrix, ScoringConfig]:
    try:
        return ctx.state["festival"], ctx.state["matrix"], ctx.state["config"]
    except KeyError as exc:
        raise ToolInputError("No festival is loaded for this session.") from exc


def _act_id(festival: Festival, ref: str) -> str:
    """Accept an act id or a name (case-insensitive, unique substring)."""
    ref = (ref or "").strip()
    acts = festival.acts
    for act in acts:
        if act.id == ref or act.name.casefold() == ref.casefold():
            return act.id
    hits = [a for a in acts if ref.casefold() in a.name.casefold()]
    if len(hits) == 1:
        return hits[0].id
    if hits:
        raise ToolInputError(
            f"'{ref}' matches several acts: {', '.join(a.name for a in hits[:6])}. Be specific."
        )
    raise ToolInputError(f"No act called '{ref}' plays this day. Use list_timetable to see who does.")


def _minutes(value: Any, field: str) -> int:
    try:
        minutes = parse_minutes(value)
    except ValueError as exc:
        raise ToolInputError(f"{field} must be a time like '18:30'.") from exc
    if not isinstance(minutes, int):
        raise ToolInputError(f"{field} must be a time like '18:30'.")
    return minutes


def _rebuild(festival: Festival, **update: Any) -> Festival:
    """A validated copy of the festival with some fields replaced."""
    data = festival.model_dump()
    data.update({k: (v.model_dump() if hasattr(v, "model_dump") else v) for k, v in update.items()})
    try:
        return Festival.model_validate(data)
    except ValidationError as exc:
        first = exc.errors()[0]["msg"].removeprefix("Value error, ")
        raise ToolInputError(f"That change is not possible: {first}") from exc


def _slot_text(festival: Festival, slot: SetSlot) -> str:
    stage = festival.stage_by_id()[slot.stage_id].name
    return f"{stage} {format_minutes(slot.start)}-{format_minutes(slot.end)}"


def _out_of_100(value: float | None) -> int | None:
    """A 0-1 value (taste overlap, draw) as the whole number out of 100 the page shows."""
    return None if value is None else round(100 * value)


def _budget(value: float | None) -> float | None:
    """A Clash Budget Index as the page shows it: one decimal."""
    return None if value is None else round(value, 1)


def _clash_rows(report: ScoreReport, limit: int) -> list[dict[str, Any]]:
    return [
        {
            "a": c.a.name,
            "b": c.b.name,
            "taste_overlap_out_of_100": _out_of_100(c.audience_overlap),
            "draw_out_of_100": _out_of_100(c.draw),
            "minutes_overlapping": c.overlap_minutes,
            "share_of_day_cost_percent": round(100 * c.regret_share),
            "label": c.label,
        }
        for c in report.clashes[:limit]
    ]


# ---------------------------------------------------------------------------------------------- read


async def list_timetable(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
    festival, matrix, _ = _state(ctx)
    acts = festival.act_by_id()
    rows = []
    for slot in sorted(festival.timetable, key=lambda s: (s.stage_id, s.start)):
        act = acts[slot.act_id]
        row: dict[str, Any] = {
            "act_id": act.id,
            "name": act.name,
            "slot": _slot_text(festival, slot),
            "draw_out_of_100": _out_of_100(act.popularity),
            "qloo_signal": matrix.coverage_of(act.id),
        }
        if slot.locked:
            row["locked"] = True
        if slot.not_before is not None or slot.not_after is not None:
            row["window"] = [
                format_minutes(slot.not_before) if slot.not_before is not None else None,
                format_minutes(slot.not_after) if slot.not_after is not None else None,
            ]
        rows.append(row)
    stages = [f"{s.name} (rank {s.tier})" for s in festival.stages]
    return ToolOutput(
        content=_compact({"festival": festival.name, "stages": stages, "sets": rows}),
        summary=f"{len(rows)} sets on {len(stages)} stages",
    )


LIST_TIMETABLE = Tool(
    name="list_timetable",
    description=(
        "The working timetable: every set with its act id, stage and time, draw (Qloo popularity, 0 to "
        "100), whether Qloo has a usable audience signal for the act, locks and allowed start windows."
    ),
    input_schema={"type": "object", "additionalProperties": False, "properties": {}, "required": []},
    handler=list_timetable,
    provenance="derived",
)


async def clash_report(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
    festival, matrix, config = _state(ctx)
    limit = args.get("limit") or 8
    report = score_festival(festival, matrix, config)
    data = {
        "clash_budget_index": _budget(report.metrics.clash_budget_index),
        "index_meaning": (
            "100 = average of random re-orderings of this lineup that keep each set near its "
            "published slot; lower is better"
        ),
        "top_clashes": _clash_rows(report, min(int(limit), 20)),
        "acts_without_qloo_signal": [u.name for u in report.coverage.unscored],
        "problems": [v.message for v in report.violations],
    }
    return ToolOutput(
        content=_compact(data),
        summary=f"Clash Budget {data['clash_budget_index']}, {len(report.clashes)} scored clashes",
        data={"kind": "score", "report": report.model_dump(mode="json")},
    )


CLASH_REPORT = Tool(
    name="clash_report",
    description=(
        "Score the working timetable: the Clash Budget Index (100 = average random legal timetable, lower is "
        "better) and the costliest clashes. Cost of a clash = taste overlap (0 to 100, a rank among this "
        "day's acts, calculated from Qloo data) x combined draw (Qloo popularity, 0 to 100) x minutes "
        "overlapping."
    ),
    input_schema={
        "type": "object",
        "additionalProperties": False,
        "properties": {"limit": {"type": "integer", "description": "How many clashes to list, 1-20."}},
        "required": ["limit"],
    },
    handler=clash_report,
    provenance="derived",
)


async def explain_clash(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
    festival, matrix, _ = _state(ctx)
    a_id, b_id = _act_id(festival, args.get("act_a")), _act_id(festival, args.get("act_b"))
    if a_id == b_id:
        raise ToolInputError("Pick two different acts.")
    acts = festival.act_by_id()
    a, b = acts[a_id], acts[b_id]
    slots = {s.act_id: s for s in festival.timetable}
    sa, sb = slots[a_id], slots[b_id]
    minutes = max(0, min(sa.end, sb.end) - max(sa.start, sb.start)) if sa.stage_id != sb.stage_id else 0
    data: dict[str, Any] = {
        "a": {"name": a.name, "slot": _slot_text(festival, sa), "draw": a.popularity},
        "b": {"name": b.name, "slot": _slot_text(festival, sb), "draw": b.popularity},
        "minutes_overlapping": minutes,
    }
    # What the model reads: the same facts in the page's units, and tag names without Qloo's raw scores
    view: dict[str, Any] = {
        "a": {"name": a.name, "slot": data["a"]["slot"], "draw_out_of_100": _out_of_100(a.popularity)},
        "b": {"name": b.name, "slot": data["b"]["slot"], "draw_out_of_100": _out_of_100(b.popularity)},
        "minutes_overlapping": minutes,
    }
    if matrix.coverage_of(a_id) == "none" or matrix.coverage_of(b_id) == "none":
        data["taste_overlap"] = view["taste_overlap_out_of_100"] = None
        data["note"] = view["note"] = (
            "Qloo has no usable audience signal for one of these acts, so the clash is not priced."
        )
        return ToolOutput(content=_compact(view), summary="No Qloo signal for one act")
    data["taste_overlap"] = round(matrix.value(a_id, b_id), 2)
    view["taste_overlap_out_of_100"] = _out_of_100(data["taste_overlap"])
    if a.qloo_id and b.qloo_id:
        tags = await shared_taste(ctx.qloo, a.qloo_id, b.qloo_id, take=6)
        data["qloo_tags_for_pair"] = view["qloo_tags_for_pair"] = [t.name for t in tags]
        data["tags"] = [asdict(t) for t in tags]
    return ToolOutput(
        content=_compact(view),
        summary=f"{a.name} / {b.name}: taste overlap {round(100 * data['taste_overlap'])}/100",
        data={"kind": "clash", **data},
    )


EXPLAIN_CLASH = Tool(
    name="explain_clash",
    description=(
        "Explain one pair of acts: their slots, minutes overlapping, taste overlap (0 to 100, a rank among "
        "this day's acts, calculated from Qloo data), each act's draw (Qloo popularity, 0 to 100), and the "
        "tags Qloo returns when it compares the two audiences (genres, themes). Accepts act ids or names."
    ),
    input_schema={
        "type": "object",
        "additionalProperties": False,
        "properties": {"act_a": {"type": "string"}, "act_b": {"type": "string"}},
        "required": ["act_a", "act_b"],
    },
    handler=explain_clash,
)


# ----------------------------------------------------------------------------------------- what-if


def all_pairs(config: ScoringConfig) -> ScoringConfig:
    """The same scoring with every clash ranked, so a set's clashes are listed even below the day's top 15."""
    return config.model_copy(update={"top_clashes": ALL_PAIRS})


def index_points(report: ScoreReport, act_id: str) -> list[tuple[str, float]]:
    """Each of the act's clashes as the partner's name and the Clash Budget Index points the clash adds (one
    decimal), largest first: comparable before and after a move."""
    points = [
        (
            c.b.name if c.a.act_id == act_id else c.a.name,
            round(c.regret_share * report.metrics.clash_budget_index, 1),
        )
        for c in report.clashes
        if act_id in (c.a.act_id, c.b.act_id)
    ]
    return sorted(points, key=lambda item: item[1], reverse=True)


async def try_move(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
    festival, matrix, config = _state(ctx)
    act_id = _act_id(festival, args.get("act"))
    stage_ref = (args.get("stage") or "").strip()
    stages = {s.id: s for s in festival.stages} | {s.name.casefold(): s for s in festival.stages}
    stage = stages.get(stage_ref) or stages.get(stage_ref.casefold())
    if stage is None:
        raise ToolInputError(
            f"Unknown stage '{stage_ref}'. Stages: {', '.join(s.name for s in festival.stages)}."
        )
    start = _minutes(args.get("start"), "start")
    slots = {s.act_id: s for s in festival.timetable}
    old = slots[act_id]
    if old.locked:
        raise ToolInputError(f"{festival.act_by_id()[act_id].name} is locked in place.")
    moved = old.model_copy(update={"stage_id": stage.id, "start": start, "end": start + old.duration})
    name = festival.act_by_id()[act_id].name
    # Scored with every clash ranked, so the model reads the act's clashes among all pairs; the data keeps the
    # day's ranked clashes (the first ``top_clashes`` of the same ranking) as before.
    wide = all_pairs(config)
    before = score_festival(festival, matrix, wide)
    try:
        trial = _rebuild(festival, timetable=[moved if s.act_id == act_id else s for s in festival.timetable])
    except ToolInputError as exc:  # the slot is already taken on that stage
        data = {
            "move": f"{name} -> {stage.name} {format_minutes(start)}",
            "allowed": False,
            "problems": [str(exc)],
        }
        return ToolOutput(
            content=_compact(data),
            summary=f"What if {name} moves: slot taken",
            data={"kind": "what_if", **data},
        )
    after = score_festival(trial, matrix, wide)
    new_problems = sorted({v.message for v in after.violations} - {v.message for v in before.violations})

    def involving(report: ScoreReport) -> dict[str, float]:
        return {
            (c.b.name if c.a.act_id == act_id else c.a.name): round(c.regret_share * report.metrics.regret, 4)
            for c in report.clashes[: config.top_clashes]
            if act_id in (c.a.act_id, c.b.act_id)
        }

    data = {
        "move": f"{name}: {_slot_text(festival, old)} -> {_slot_text(trial, moved)}",
        "allowed": not new_problems,
        "problems": new_problems,
        "clash_budget_before": before.metrics.clash_budget_index,
        "clash_budget_after": after.metrics.clash_budget_index,
        "clashes_before": involving(before),
        "clashes_after": involving(after),
    }

    # What the model reads: index units only, never the engine's raw 0-1 clash costs.
    view = {k: v for k, v in data.items() if k not in ("clashes_before", "clashes_after")} | {
        "clash_budget_before": _budget(before.metrics.clash_budget_index),
        "clash_budget_after": _budget(after.metrics.clash_budget_index),
        "clash_index_points_before": dict(index_points(before, act_id)),
        "clash_index_points_after": dict(index_points(after, act_id)),
    }
    verdict = (
        "breaks a rule" if new_problems else f"{view['clash_budget_before']} -> {view['clash_budget_after']}"
    )
    return ToolOutput(
        content=_compact(view), summary=f"What if {name} moves: {verdict}", data={"kind": "what_if", **data}
    )


TRY_MOVE = Tool(
    name="try_move",
    description=(
        "What-if: move one set to a stage and start time (it keeps its length) and report whether that "
        "breaks a "
        "rule (stage hours, changeover, curfew, the set's allowed window or stages, billing, keep-apart "
        "pairs), the "
        "Clash Budget before and after, and the act's clashes before and after. Does not change the "
        "timetable."
    ),
    input_schema={
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "act": {"type": "string", "description": "Act id or name."},
            "stage": {"type": "string", "description": "Stage id or name."},
            "start": {"type": "string", "description": "New start time, 'HH:MM'."},
        },
        "required": ["act", "stage", "start"],
    },
    handler=try_move,
    provenance="derived",
)


MAX_MOVE_OPTIONS = 8
MOVE_GRID_MINUTES = 5


async def find_moves(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
    festival, matrix, config = _state(ctx)
    act_id = _act_id(festival, args.get("act"))
    limit = args.get("limit", 5)
    if not isinstance(limit, int) or not 1 <= limit <= MAX_MOVE_OPTIONS:
        raise ToolInputError(f"limit must be 1-{MAX_MOVE_OPTIONS}.")
    # Scoring every candidate is CPU work: keep it off the event loop so other requests are served.
    return await ctx.engine(_find_moves, festival, matrix, config, act_id, limit)


MAX_PARTNERS = 3  # clashes listed per place in the web's what-if


def _partners(report: ScoreReport, act_id: str) -> list[dict[str, Any]]:
    return [{"with": name, "points": points} for name, points in index_points(report, act_id)[:MAX_PARTNERS]]


def is_priced(matrix: OverlapMatrix, act_id: str) -> bool:
    """Whether Qloo has a usable signal for the act, so its clashes are priced (the scorer's own test)."""
    return act_id in matrix.act_ids and matrix.coverage_of(act_id) != "none"


def _evaluate_place(
    festival: Festival,
    matrix: OverlapMatrix,
    config: ScoringConfig,
    old: SetSlot,
    place: Placement,
    stage_ids: Sequence[str],
    known_problems: set[str],
) -> tuple[Festival, SetSlot, ScoreReport] | None:
    """The timetable with one set at ``place``, the set's new slot and the score; None when the place is
    taken or breaks a rule the timetable did not already break (``known_problems``)."""
    day, stage, start = place
    moved = old.model_copy(
        update={"day": day, "stage_id": stage_ids[stage], "start": start, "end": start + old.duration}
    )
    try:
        trial = _rebuild(
            festival, timetable=[moved if s.act_id == old.act_id else s for s in festival.timetable]
        )
    except ToolInputError:  # the place is already taken on that stage
        return None
    after = score_festival(trial, matrix, config)
    if {v.message for v in after.violations} - known_problems:
        return None
    return trial, moved, after


def compute_move_options(
    festival: Festival,
    matrix: OverlapMatrix,
    config: ScoringConfig,
    act_id: str,
    limit: int,
    *,
    partners: bool = False,
) -> dict[str, Any]:
    """Every legal place one set could go, priced with the Clash Budget after the move, best first.

    Checks every start on a 5-minute grid in the free time the set may use; a place that breaks a rule the
    timetable did not already break is left out. This is ``find_moves``'s data. With ``partners`` (the web's
    what-if) it also gives the act id, whether the act is priced, the set's clashes now and, per place, the
    stage id, end, day and the clashes after the move, each as Clash Budget Index points (at most 3 partners,
    largest first, among all the day's pairs).
    """
    name = festival.act_by_id()[act_id].name
    layout = Layout.from_festival(festival)
    i = layout.rules.act_ids.index(act_id)
    old = {s.act_id: s for s in festival.timetable}[act_id]
    if layout.frozen[i]:
        why = "locked in place" if old.locked else "tied up in a rule the published timetable already breaks"
        frozen: dict[str, Any] = {"act": name, "from": _slot_text(festival, old)}
        if partners:
            priced = is_priced(matrix, act_id)
            frozen = {"act": name, "act_id": act_id, "priced": priced, "from": frozen["from"]}
        return frozen | {"movable": False, "why": why, "options": []}

    # Every pair is ranked for the web's lists; budgets, order and legal places do not depend on it
    scoring = all_pairs(config) if partners else config
    before = score_festival(festival, matrix, scoring)
    known = {v.message for v in before.violations}
    seen: set[Placement] = set()
    options: list[dict[str, Any]] = []
    for move in grid_moves(layout, i, step=MOVE_GRID_MINUTES):
        place = move.to[0]
        if place in seen or not layout.is_feasible(move):
            continue
        seen.add(place)
        evaluated = _evaluate_place(festival, matrix, scoring, old, place, layout.rules.stage_ids, known)
        if evaluated is None:
            continue
        trial, moved, after = evaluated
        day, _, start = place
        option: dict[str, Any] = {
            "move": f"{name}: {_slot_text(festival, old)} -> {_slot_text(trial, moved)}",
            "stage": festival.stage_by_id()[moved.stage_id].name,
            "start": format_minutes(start),
            "clash_budget_after": after.metrics.clash_budget_index,
        }
        if partners:
            option = {
                "move": option["move"],
                "stage": option["stage"],
                "stage_id": moved.stage_id,
                "start": option["start"],
                "end": format_minutes(moved.end),
                "day": day,
                "clash_budget_after": option["clash_budget_after"],
                "clashes_after": _partners(after, act_id),
            }
        options.append(option)
    options.sort(key=lambda o: o["clash_budget_after"])
    found: dict[str, Any] = {"act": name, "from": _slot_text(festival, old), "movable": True}
    if partners:
        found = {
            "act": name,
            "act_id": act_id,
            "priced": is_priced(matrix, act_id),
            "from": found["from"],
            "movable": True,
            "why": None,
        }
    found |= {
        "clash_budget_before": before.metrics.clash_budget_index,
        "legal_places": len(options),
        "searched": f"every start on a {MOVE_GRID_MINUTES}-minute grid in the free time it may use",
    }
    if partners:
        found["clashes_now"] = _partners(before, act_id)
    return found | {"options": options[:limit]}


# ------------------------------------------------------------------------------------ stacked moves


@dataclass(frozen=True, slots=True)
class PlanMove:
    """One kept move: a set to a stage, day and start (minutes from the start of the day)."""

    act_id: str
    stage_id: str
    day: int
    start: int


@dataclass(frozen=True, slots=True)
class PlanStep:
    """One kept move as it was priced on the timetable the earlier moves left."""

    act_id: str
    act: str
    move: str
    stage_id: str
    stage: str
    day: int
    start: int
    end: int
    budget_after: float | None


@dataclass(frozen=True, slots=True)
class PlanResult:
    festival: Festival
    budget_before: float | None
    steps: tuple[PlanStep, ...]
    report: ScoreReport


class IllegalStep(Exception):
    """A kept move is not a legal place for its set on the timetable the earlier moves left (1-based)."""

    def __init__(self, step: int) -> None:
        super().__init__(f"step {step} is not a legal place")
        self.step = step


def apply_plan(
    festival: Festival, matrix: OverlapMatrix, config: ScoringConfig, moves: Sequence[PlanMove]
) -> PlanResult:
    """The timetable with the moves taken in order, each priced, and the final score. Nothing is stored.

    Each move must be a place ``compute_move_options`` would list for that set on the timetable as the earlier
    moves left it: a stage and start the set may use, on its grid, breaking no rule that timetable did not
    already break; locked and tied-up sets cannot move. Only the requested place is scored, never every
    candidate. Raises ``IllegalStep`` with the move's 1-based number otherwise.
    """
    current = festival
    before = score_festival(current, matrix, config)
    budget_before = before.metrics.clash_budget_index
    steps: list[PlanStep] = []
    for number, step in enumerate(moves, start=1):
        layout = Layout.from_festival(current)
        rules = layout.rules
        if step.act_id not in rules.act_ids or step.stage_id not in rules.stage_ids:
            raise IllegalStep(number)
        i = rules.act_ids.index(step.act_id)
        if layout.frozen[i]:
            raise IllegalStep(number)
        place = (step.day, rules.stage_ids.index(step.stage_id), step.start)
        move = next((m for m in grid_moves(layout, i, step=MOVE_GRID_MINUTES) if m.to[0] == place), None)
        if move is None or not layout.is_feasible(move):
            raise IllegalStep(number)
        old = {s.act_id: s for s in current.timetable}[step.act_id]
        known = {v.message for v in before.violations}
        evaluated = _evaluate_place(current, matrix, config, old, place, rules.stage_ids, known)
        if evaluated is None:
            raise IllegalStep(number)
        trial, moved, after = evaluated
        name = current.act_by_id()[step.act_id].name
        steps.append(
            PlanStep(
                act_id=step.act_id,
                act=name,
                move=f"{name}: {_slot_text(current, old)} -> {_slot_text(trial, moved)}",
                stage_id=moved.stage_id,
                stage=trial.stage_by_id()[moved.stage_id].name,
                day=moved.day,
                start=moved.start,
                end=moved.end,
                budget_after=after.metrics.clash_budget_index,
            )
        )
        current, before = trial, after
    return PlanResult(festival=current, budget_before=budget_before, steps=tuple(steps), report=before)


def _find_moves(
    festival: Festival, matrix: OverlapMatrix, config: ScoringConfig, act_id: str, limit: int
) -> ToolOutput:
    data = compute_move_options(festival, matrix, config, act_id, limit)
    name = data["act"]
    if not data["movable"]:
        return ToolOutput(
            content=_compact(data),
            summary=f"{name} cannot move: {data['why']}",
            data={"kind": "move_options", **data},
        )
    view = {
        **data,
        "clash_budget_before": _budget(data["clash_budget_before"]),
        "options": [{**o, "clash_budget_after": _budget(o["clash_budget_after"])} for o in data["options"]],
    }
    summary = (
        f"{name}: {data['legal_places']} legal places, best {view['clash_budget_before']} -> "
        f"{view['options'][0]['clash_budget_after']}"
        if data["options"]
        else f"{name}: no legal place to move"
    )
    return ToolOutput(content=_compact(view), summary=summary, data={"kind": "move_options", **data})


FIND_MOVES = Tool(
    name="find_moves",
    description=(
        "Where could one set go? Checks every start on a 5-minute grid in the free time it may use (a "
        "stage it may play, inside its start window; it keeps its length) and lists the places that break "
        "no rule, each priced with the Clash Budget after the move, best first. Use it before try_move "
        "instead of guessing times. Does not change the timetable."
    ),
    input_schema={
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "act": {"type": "string", "description": "Act id or name."},
            "limit": {"type": "integer", "description": "Most places to return, 1-8 (default 5)."},
        },
        "required": ["act"],
    },
    handler=find_moves,
    provenance="derived",
)


# ------------------------------------------------------------------------------------- constraints


async def add_constraint(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
    festival, matrix, config = _state(ctx)
    kind = args.get("kind")
    if kind not in CONSTRAINT_KINDS:
        raise ToolInputError(f"kind must be one of {CONSTRAINT_KINDS}.")
    act_id = _act_id(festival, args.get("act"))
    name = festival.act_by_id()[act_id].name
    slots = list(festival.timetable)
    index = next(i for i, s in enumerate(slots) if s.act_id == act_id)
    slot = slots[index]
    constraints = festival.constraints
    kept = None
    if kind == "lock":
        slots[index] = slot.model_copy(update={"locked": True})
        text = f"{name} stays exactly where it is"
    elif kind == "keep_stage":
        # The set's own stage is in any stage list it already has, so this only ever narrows that list
        slots[index] = slot.model_copy(update={"stages": [slot.stage_id]})
        text = f"{name} stays on {festival.stage_by_id()[slot.stage_id].name}"
    elif kind in ("not_before", "not_after"):
        asked = _minutes(args.get("time"), "time")
        bound = "no earlier" if kind == "not_before" else "no later"
        # A rule only tightens the published day: a looser bound than the set already has changes nothing
        existing = getattr(slot, kind)
        time = asked if existing is None else (max if kind == "not_before" else min)(existing, asked)
        if time != asked:
            kept = (
                f"{name} already starts {bound} than {format_minutes(time)}, which is stricter, so that stays"
            )
        slots[index] = slot.model_copy(update={kind: time})
        text = f"{name} starts {bound} than {format_minutes(time)}"
    else:
        other = _act_id(festival, args.get("other_act"))
        if other == act_id:
            raise ToolInputError("keep_apart needs two different acts.")
        pairs = [*constraints.no_clash_with, (act_id, other)]
        constraints = constraints.model_copy(update={"no_clash_with": pairs})
        text = f"{name} and {festival.act_by_id()[other].name} must not overlap"
    updated = _rebuild(festival, timetable=slots, constraints=constraints)
    ctx.state["festival"] = updated
    ctx.state.setdefault("constraints", []).append(text)
    report = score_festival(updated, matrix, config)
    broken = [v.message for v in report.violations if act_id in v.act_ids]
    content: dict[str, Any] = {"added": text, "all_constraints": ctx.state["constraints"]}
    if kept:
        content["kept_stricter_bound"] = kept
    if broken:
        content["note"] = "The current timetable breaks this rule; a re-slot must fix it: " + "; ".join(
            broken
        )
    return ToolOutput(content=_compact(content), summary=f"Rule added: {text}")


ADD_CONSTRAINT = Tool(
    name="add_constraint",
    description=(
        "Record a programming rule the user states, for every later what-if and re-slot. kinds: 'lock' (the "
        "set "
        "may not move at all), 'keep_stage' (may change time, not stage), 'not_before' / 'not_after' "
        "(earliest / "
        "latest start, needs time 'HH:MM'), 'keep_apart' (the act and other_act must never overlap). Use '' "
        "for "
        "fields a kind does not need."
    ),
    input_schema={
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "kind": {"type": "string", "enum": CONSTRAINT_KINDS},
            "act": {"type": "string", "description": "Act id or name."},
            "time": {"type": "string", "description": "'HH:MM' for not_before / not_after, else ''."},
            "other_act": {"type": "string", "description": "Second act for keep_apart, else ''."},
        },
        "required": ["kind", "act", "time", "other_act"],
    },
    handler=add_constraint,
    provenance="derived",
)


# ------------------------------------------------------------------------------------------ re-slot


async def reslot(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
    festival, matrix, config = _state(ctx)
    weight = args.get("objective")
    budget = args.get("move_budget")
    if not isinstance(weight, (int, float)) or not 0 <= weight <= 1:
        raise ToolInputError(
            "objective must be between 0 (set popular acts with unlike audiences against each other on "
            "purpose) and 1 (lowest clash cost)."
        )
    if not isinstance(budget, int) or not 1 <= budget <= MAX_MOVE_BUDGET:
        raise ToolInputError(f"move_budget must be 1-{MAX_MOVE_BUDGET}.")
    ctx.take_reslot()
    report = await ctx.engine(optimize, festival, matrix, float(weight), budget, config)
    option = next((o for o in report.options if o.kind == "balanced"), None)
    data: dict[str, Any] = {"status": report.status, "message": report.message}
    if option is not None and option.improved:
        data |= {
            "clash_budget_before": report.before.clash_budget_index,
            "clash_budget_after": option.metrics.clash_budget_index,
            "moves": [
                {"act": m.name, "from": m.from_slot.label, "to": m.to_slot.label, "why": m.reason}
                for m in option.moves
            ],
        }
    view = {key: _budget(value) if key.startswith("clash_budget") else value for key, value in data.items()}
    moved = len(data.get("moves", []))
    if moved:
        # What the model reads describes the plan it was handed, not the optimizer's best unconstrained option
        sets = "1 set" if moved == 1 else f"{moved} sets"
        view["message"] = (
            f"This plan moves {sets} and takes the Clash Budget from {view['clash_budget_before']:.1f} "
            f"to {view['clash_budget_after']:.1f}."
        )
    return ToolOutput(
        content=_compact(view),
        summary=f"Re-slot: {moved} moves"
        + (f", Clash Budget -> {view['clash_budget_after']}" if moved else ""),
        data={"kind": "reslot", "report": report.model_dump(mode="json"), "summary": data},
    )


RESLOT = Tool(
    name="reslot",
    description=(
        "Re-slot the movable sets under every rule. objective: 1 = lowest clash cost, 0 = set popular acts "
        "with unlike audiences against each other on purpose, in between = balance. move_budget = most sets "
        "that may move (a swap counts two). Returns the moves with reasons and the Clash Budget before and "
        "after."
    ),
    input_schema={
        "type": "object",
        "additionalProperties": False,
        "properties": {"objective": {"type": "number"}, "move_budget": {"type": "integer"}},
        "required": ["objective", "move_budget"],
    },
    handler=reslot,
    provenance="derived",
)

CLASH_TOOLS = [LIST_TIMETABLE, CLASH_REPORT, EXPLAIN_CLASH, FIND_MOVES, TRY_MOVE, ADD_CONSTRAINT, RESLOT]
