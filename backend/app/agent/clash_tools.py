"""Tools the agent uses to inspect, question and re-slot one festival day.

The session state (``ctx.state``) holds the working ``festival``, its Qloo ``matrix`` and a scoring ``config``
with a fixed random-timetable baseline, so every number the agent quotes is on the same scale. Constraint
tools change the working festival; ``try_move`` never does.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from typing import Any

from pydantic import ValidationError

from ..qloo.overlap import shared_taste
from ..schedule.metrics import score_festival
from ..schedule.models import Festival, OverlapMatrix, ScoringConfig, SetSlot, format_minutes, parse_minutes
from ..schedule.optimizer import optimize
from ..schedule.reports import ScoreReport
from .tools import Tool, ToolContext, ToolInputError, ToolOutput

MAX_MOVE_BUDGET = 12
CONSTRAINT_KINDS = ["lock", "keep_stage", "not_before", "not_after", "keep_apart"]


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


def _clash_rows(report: ScoreReport, limit: int) -> list[dict[str, Any]]:
    return [
        {
            "a": c.a.name,
            "b": c.b.name,
            "shared_audience": round(c.audience_overlap, 2),
            "draw": round(c.draw, 2),
            "minutes_overlapping": c.overlap_minutes,
            "share_of_total_cost": round(c.regret_share, 3),
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
            "draw": round(act.popularity, 2) if act.popularity is not None else None,
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
        "The working timetable: every set with its act id, stage and time, draw (Qloo popularity, 0-1), "
        "whether "
        "Qloo has a usable audience signal for the act, locks and allowed start windows."
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
        "clash_budget_index": report.metrics.clash_budget_index,
        "index_meaning": "100 = average of random legal timetables for this lineup; lower is better",
        "top_clashes": _clash_rows(report, min(int(limit), 20)),
        "acts_without_qloo_signal": [u.name for u in report.coverage.unscored],
        "problems": [v.message for v in report.violations],
    }
    return ToolOutput(
        content=_compact(data),
        summary=f"Clash Budget {report.metrics.clash_budget_index}, {len(report.clashes)} scored clashes",
        data={"kind": "score", "report": report.model_dump(mode="json")},
    )


CLASH_REPORT = Tool(
    name="clash_report",
    description=(
        "Score the working timetable: the Clash Budget Index (100 = average random legal timetable, lower is "
        "better) and the costliest clashes. Cost of a clash = shared audience (Qloo) x draw x minutes "
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
    if matrix.coverage_of(a_id) == "none" or matrix.coverage_of(b_id) == "none":
        data["shared_audience"] = None
        data["note"] = "Qloo has no usable audience signal for one of these acts, so the clash is not priced."
        return ToolOutput(content=_compact(data), summary="No Qloo signal for one act")
    data["shared_audience"] = round(matrix.value(a_id, b_id), 2)
    if a.qloo_id and b.qloo_id:
        tags = await shared_taste(ctx.qloo, a.qloo_id, b.qloo_id, take=6)
        data["fans_of_both_lean_toward"] = [t.name for t in tags]
        data["tags"] = [asdict(t) for t in tags]
    return ToolOutput(
        content=_compact(data),
        summary=f"{a.name} / {b.name}: shared audience {data['shared_audience']}",
        data={"kind": "clash", **data},
    )


EXPLAIN_CLASH = Tool(
    name="explain_clash",
    description=(
        "Explain one pair of acts: their slots, minutes overlapping, shared audience by Qloo's measure (0-1, "
        "relative to this lineup), each act's draw, and the taste Qloo finds both audiences share (genres, "
        "themes). Accepts act ids or names."
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
    before = score_festival(festival, matrix, config)
    try:
        trial = _rebuild(festival, timetable=[moved if s.act_id == act_id else s for s in festival.timetable])
    except ToolInputError as exc:  # the slot is already taken on that stage
        data = {
            "move": f"{name} -> {stage.name} {format_minutes(start)}",
            "allowed": False,
            "problems": [str(exc)],
        }
        return ToolOutput(content=_compact(data), summary=f"What if {name} moves: slot taken")
    after = score_festival(trial, matrix, config)
    new_problems = sorted({v.message for v in after.violations} - {v.message for v in before.violations})

    def involving(report: ScoreReport) -> dict[str, float]:
        return {
            (c.b.name if c.a.act_id == act_id else c.a.name): round(c.regret_share * report.metrics.regret, 4)
            for c in report.clashes
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
    verdict = (
        "breaks a rule"
        if new_problems
        else f"{before.metrics.clash_budget_index} -> {after.metrics.clash_budget_index}"
    )
    return ToolOutput(
        content=_compact(data), summary=f"What if {name} moves: {verdict}", data={"kind": "what_if", **data}
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
    if kind == "lock":
        slots[index] = slot.model_copy(update={"locked": True})
        text = f"{name} stays exactly where it is"
    elif kind == "keep_stage":
        slots[index] = slot.model_copy(update={"stages": [slot.stage_id]})
        text = f"{name} stays on {festival.stage_by_id()[slot.stage_id].name}"
    elif kind in ("not_before", "not_after"):
        time = _minutes(args.get("time"), "time")
        slots[index] = slot.model_copy(update={kind: time})
        bound = "no earlier" if kind == "not_before" else "no later"
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


def _flat(matrix: OverlapMatrix) -> OverlapMatrix:
    n = len(matrix.act_ids)
    values = [[0.0 if i == j else 0.5 for j in range(n)] for i in range(n)]
    return matrix.model_copy(update={"values": values, "source": "derived"})


async def reslot(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
    festival, matrix, config = _state(ctx)
    weight = args.get("objective")
    budget = args.get("move_budget")
    if not isinstance(weight, (int, float)) or not 0 <= weight <= 1:
        raise ToolInputError(
            "objective must be between 0 (split big crowds on purpose) and 1 (least fan regret)."
        )
    if not isinstance(budget, int) or not 1 <= budget <= MAX_MOVE_BUDGET:
        raise ToolInputError(f"move_budget must be 1-{MAX_MOVE_BUDGET}.")
    report = optimize(festival, matrix, float(weight), budget, config)
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
    if args.get("compare_without_qloo") and option is not None:
        plain = optimize(festival, _flat(matrix), float(weight), budget, config)
        plain_option = next((o for o in plain.options if o.kind == "balanced"), None)
        if plain_option is not None:
            graded = score_festival(_rebuild(festival, timetable=plain_option.timetable), matrix, config)
            mine = {(m.act_id, m.to_slot.stage_id, m.to_slot.start) for m in option.moves}
            theirs = {(m.act_id, m.to_slot.stage_id, m.to_slot.start) for m in plain_option.moves}
            data["without_qloo"] = {
                "how": "same rules, every pair treated as equally shared audience (draw only)",
                "clash_budget_by_qloo_measure": graded.metrics.clash_budget_index,
                "moves": [f"{m.name}: {m.from_slot.label} -> {m.to_slot.label}" for m in plain_option.moves],
                "moves_that_differ": len(mine - theirs),
            }
    moved = len(data.get("moves", []))
    return ToolOutput(
        content=_compact(data),
        summary=f"Re-slot: {moved} moves"
        + (f", Clash Budget -> {data['clash_budget_after']}" if moved else ""),
        data={"kind": "reslot", "report": report.model_dump(mode="json"), "summary": data},
    )


RESLOT = Tool(
    name="reslot",
    description=(
        "Re-slot the movable sets under every rule. objective: 1 = least fan regret, 0 = split the biggest "
        "crowds "
        "on purpose, in between = balance. move_budget = most sets that may move (a swap counts two). "
        "Returns the "
        "moves with reasons and the Clash Budget before and after. compare_without_qloo also runs the same "
        "re-slot "
        "with no audience data (draw only) and reports how its moves differ."
    ),
    input_schema={
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "objective": {"type": "number"},
            "move_budget": {"type": "integer"},
            "compare_without_qloo": {"type": "boolean"},
        },
        "required": ["objective", "move_budget", "compare_without_qloo"],
    },
    handler=reslot,
    provenance="derived",
)

CLASH_TOOLS = [LIST_TIMETABLE, CLASH_REPORT, EXPLAIN_CLASH, TRY_MOVE, ADD_CONSTRAINT, RESLOT]
