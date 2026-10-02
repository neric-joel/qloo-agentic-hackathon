"""Builders, an independent constraint checker and hypothesis strategies for the schedule tests."""

from __future__ import annotations

import random
from collections import defaultdict
from collections.abc import Sequence
from itertools import pairwise

from hypothesis import HealthCheck, settings
from hypothesis import strategies as st

from app.schedule.models import Act, Constraints, Festival, OverlapMatrix, SetSlot, Stage, StageHours
from app.schedule.synthetic import synthetic_festival

PROPERTY = settings(
    max_examples=20,
    deadline=None,
    derandomize=True,
    database=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large, HealthCheck.filter_too_much],
)

DEFAULT_STAGES = {"main": 1, "side": 2, "tent": 3}


def make_festival(
    sets: Sequence[tuple],
    *,
    days: int = 1,
    stages: dict[str, int] | None = None,
    acts: dict[str, dict] | None = None,
    constraints: Constraints | None = None,
    hours: dict[str, list[tuple[int, int, int]]] | None = None,
) -> Festival:
    """A small festival from ``(act_id, day, stage_id, start, end[, flags])`` tuples.

    Acts are created on demand (popularity 0.5, genre None) and ``acts`` overrides their fields.
    ``hours`` maps a stage id to ``(day, open, close)`` entries.
    """
    stage_tiers = {**DEFAULT_STAGES, **(stages or {})}
    used = {s[2] for s in sets}
    act_ids = [s[0] for s in sets]
    return Festival(
        id="test-festival",
        name="Test Festival",
        days=days,
        stages=[
            Stage(
                id=sid,
                name=sid.title(),
                tier=tier,
                hours=[StageHours(day=d, open=o, close=c) for d, o, c in (hours or {}).get(sid, [])],
            )
            for sid, tier in stage_tiers.items()
            if sid in used
        ],
        acts=[Act(id=a, name=a.upper(), **{"popularity": 0.5, **(acts or {}).get(a, {})}) for a in act_ids],
        timetable=[
            SetSlot(
                act_id=s[0], day=s[1], stage_id=s[2], start=s[3], end=s[4], **(s[5] if len(s) > 5 else {})
            )
            for s in sets
        ],
        constraints=constraints or Constraints(),
    )


def make_matrix(
    ids: Sequence[str],
    pairs: dict[tuple[str, str], float],
    coverage: dict[str, str] | None = None,
    default: float = 0.0,
    source: str = "derived",
) -> OverlapMatrix:
    index = {a: i for i, a in enumerate(ids)}
    values = [[0.0 if i == j else default for j in range(len(ids))] for i in range(len(ids))]
    for (a, b), value in pairs.items():
        values[index[a]][index[b]] = values[index[b]][index[a]] = value
    return OverlapMatrix(act_ids=list(ids), values=values, coverage=coverage or {}, source=source)


def conflicts(festival: Festival, timetable: Sequence[SetSlot] | None = None) -> list[str]:
    """Every hard-constraint violation, found by brute force without using the engine's own checks."""
    slots = list(timetable if timetable is not None else festival.timetable)
    c = festival.constraints
    acts = festival.act_by_id()
    stages = festival.stage_by_id()
    found: list[str] = []
    by_stage_day: dict[tuple[int, str], list[SetSlot]] = defaultdict(list)
    for slot in slots:
        by_stage_day[(slot.day, slot.stage_id)].append(slot)
        if slot.day in c.curfew and slot.end > c.curfew[slot.day]:
            found.append(f"{slot.act_id} ends after the curfew")
        if slot.not_before is not None and slot.start < slot.not_before:
            found.append(f"{slot.act_id} starts before not_before")
        for hours in stages[slot.stage_id].hours:
            if hours.day == slot.day and not (hours.open <= slot.start and slot.end <= hours.close):
                found.append(f"{slot.act_id} is outside stage hours")
    for (_, stage_id), group in by_stage_day.items():
        group.sort(key=lambda s: s.start)
        for a, b in pairwise(group):
            if b.start - a.end < c.changeover_minutes:
                found.append(f"changeover between {a.act_id} and {b.act_id} on {stage_id}")
    by_act = {s.act_id: s for s in slots}
    for a, b in c.no_clash_with:
        x, y = by_act[a], by_act[b]
        if x.day == y.day and x.start < y.end and y.start < x.end:
            found.append(f"rider clash between {a} and {b}")
    for rule in c.billing_rules:
        for slot in slots:
            if acts[slot.act_id].billing_tier != rule.billing_tier:
                continue
            group = by_stage_day[(slot.day, slot.stage_id)]
            if rule.max_stage_tier is not None and stages[slot.stage_id].tier > rule.max_stage_tier:
                found.append(f"{slot.act_id} is on too small a stage")
            if rule.last_slots is not None:
                later = sum(1 for other in group if other.start > slot.start)
                if later >= rule.last_slots:
                    found.append(f"{slot.act_id} is not among the last {rule.last_slots} slots")
    return found


def with_random_constraints(
    festival: Festival,
    seed: int,
    *,
    lock_share: float,
    stage_lock_share: float,
    allow_day_moves: bool,
) -> Festival:
    """Add locks, earliest-start limits, a tighter curfew and a looser changeover; keep the start valid."""
    rng = random.Random(seed)
    data = festival.model_dump()
    for slot in data["timetable"]:
        slot["locked"] = rng.random() < lock_share
        slot["stage_locked"] = not slot["locked"] and rng.random() < stage_lock_share
        slot["not_before"] = max(0, slot["start"] - rng.randint(0, 45)) if rng.random() < 0.2 else None
    for day in range(len(data["days"])):
        ends = [s["end"] for s in data["timetable"] if s["day"] == day]
        if ends:
            data["constraints"]["curfew"][day] = max(ends) + rng.choice((0, 10, 30, 60))
    data["constraints"]["changeover_minutes"] = rng.choice((0, 5, 10, 15))
    data["constraints"]["allow_day_moves"] = allow_day_moves
    return Festival.model_validate(data)


@st.composite
def festival_cases(draw) -> tuple[Festival, OverlapMatrix]:
    """A small random festival (synthetic base plus random locks and limits) with its overlap matrix."""
    seed = draw(st.integers(min_value=0, max_value=5_000))
    base, matrix = synthetic_festival(
        seed,
        days=draw(st.integers(min_value=1, max_value=2)),
        stages=draw(st.integers(min_value=2, max_value=4)),
        acts=draw(st.integers(min_value=6, max_value=16)),
        showcase=False,
    )
    festival = with_random_constraints(
        base,
        seed,
        lock_share=draw(st.sampled_from((0.0, 0.2, 0.5, 0.8))),
        stage_lock_share=draw(st.sampled_from((0.0, 0.3))),
        allow_day_moves=draw(st.booleans()),
    )
    return festival, matrix
