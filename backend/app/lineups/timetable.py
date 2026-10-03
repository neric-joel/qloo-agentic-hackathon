"""Published festival timetables -> scheduling models.

A published timetable is what a festival prints (or the press copies) before the event: stages and
sets with start and end times. Converting one day of it gives a ``Festival`` the scheduler can score:
headliners are inferred from the closing slots of the main stages and locked in place, each stage keeps
its published opening hours, and the day's curfew is the latest published end.

Stages are ranked by prominence in the order the festival lists them (tier 1 = the biggest stage). By
default every other set may only move a limited distance (``Reach``): within two hours of its published
start and onto its own stage or one ranked next to it, so an early undercard act is never proposed for a
prime evening slot on the main stage.
"""

from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ..schedule.models import (
    Act,
    BillingRule,
    Constraints,
    Festival,
    SetSlot,
    Stage,
    StageHours,
    parse_minutes,
)

SKIP_FLAGS = frozenset({"cancelled", "replacement", "talk"})
STAGE_TIERS = {"main": 1, "secondary": 2, "minor": 3}
EVENING = 17 * 60
DEFAULT_CHANGEOVER = 15


@dataclass(frozen=True)
class Reach:
    """How far a movable set may go from its published slot. ``None`` means no limit."""

    minutes: int | None = 120
    stages: int | None = 1  # stage ranks away from its own


DEFAULT_REACH = Reach()


class PublishedStage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    tier: Literal["main", "secondary", "minor"] = "main"


class PublishedSet(BaseModel):
    model_config = ConfigDict(extra="ignore")

    act: str
    stage: str
    day: str
    start: str
    end: str
    flags: list[str] = Field(default_factory=list)


class PublishedTimetable(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    city: str | None = None
    days: list[str]
    stages: list[PublishedStage]
    sets: list[PublishedSet]


def slugify(name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.casefold()).strip("-")
    return slug[:60] or "act"


def to_festival(
    timetable: PublishedTimetable,
    day: str,
    *,
    stage_ids: Iterable[str] | None = None,
    start_after: str | None = None,
    reach: Reach = DEFAULT_REACH,
) -> Festival:
    """One day of a published timetable as a single-day ``Festival``.

    ``stage_ids`` limits the stages (default: every stage that is not ``minor``); ``start_after`` drops
    sets that start before that time; ``reach`` limits how far movable sets may go. Cancelled,
    replacement and talk sets are left out.
    """
    if day not in timetable.days:
        raise ValueError(f"{timetable.name} has no day {day!r}; days are {timetable.days}")
    by_id = {s.id: s for s in timetable.stages}
    wanted = (
        set(stage_ids) if stage_ids is not None else {s.id for s in timetable.stages if s.tier != "minor"}
    )
    unknown = wanted - set(by_id)
    if unknown:
        raise ValueError(f"unknown stage ids: {sorted(unknown)}")
    earliest = parse_minutes(start_after) if start_after else 0

    sets = [
        s
        for s in timetable.sets
        if s.day == day
        and s.stage in wanted
        and not SKIP_FLAGS & set(s.flags)
        and parse_minutes(s.start) >= earliest
    ]
    if not sets:
        raise ValueError(f"no sets on {day} for the chosen stages")

    stage_order = [s.id for s in timetable.stages if s.id in {x.stage for x in sets}]
    stage_order.sort(key=lambda sid: STAGE_TIERS[by_id[sid].tier])  # stable: keeps listed order within a tier
    rank = {sid: i for i, sid in enumerate(stage_order)}
    stages = [Stage(id=sid, name=by_id[sid].name, tier=min(rank[sid] + 1, 9)) for sid in stage_order]
    stage_tier = {sid: STAGE_TIERS[by_id[sid].tier] for sid in stage_order}

    per_stage: dict[str, list[PublishedSet]] = defaultdict(list)
    for s in sets:
        per_stage[s.stage].append(s)
    for items in per_stage.values():
        items.sort(key=lambda s: parse_minutes(s.start))

    acts: list[Act] = []
    slots: list[SetSlot] = []
    used: set[str] = set()
    for stage_id in stage_order:
        items = per_stage[stage_id]
        for position, s in enumerate(items):
            from_end = len(items) - 1 - position
            tier = _billing_tier(stage_tier[stage_id], from_end, parse_minutes(s.start))
            act_id, name = _unique(slugify(s.act), s.act, used)
            acts.append(Act(id=act_id, name=name, billing_tier=tier))
            start = parse_minutes(s.start)
            slots.append(
                SetSlot(
                    act_id=act_id,
                    day=0,
                    stage_id=stage_id,
                    start=s.start,
                    end=s.end,
                    locked=tier == 1,
                    not_before=None if reach.minutes is None else max(0, start - reach.minutes),
                    not_after=None if reach.minutes is None else start + reach.minutes,
                    stages=None
                    if reach.stages is None
                    else [sid for sid in stage_order if abs(rank[sid] - rank[stage_id]) <= reach.stages],
                )
            )

    stages = [
        stage.model_copy(
            update={
                "hours": [
                    StageHours(
                        day=0,
                        open=min(x.start for x in slots if x.stage_id == stage.id),
                        close=max(x.end for x in slots if x.stage_id == stage.id),
                    )
                ]
            }
        )
        for stage in stages
    ]
    return Festival(
        id=slugify(f"{timetable.id}-{day}"),
        name=f"{timetable.name}, {day}",
        city=timetable.city,
        days=[day],
        stages=stages,
        acts=acts,
        timetable=slots,
        constraints=Constraints(
            changeover_minutes=min(DEFAULT_CHANGEOVER, _tightest_gap(per_stage.values())),
            curfew={0: max(x.end for x in slots)},
            billing_rules=[BillingRule(billing_tier=1, max_stage_tier=None, last_slots=1)],
        ),
    )


def _billing_tier(stage_tier: int, from_end: int, start: int) -> int:
    """Closing set of a main stage = headliner; the slot before it and other stages' closers = 2."""
    if from_end == 0:
        return 1 if stage_tier == 1 else 2
    if from_end == 1 and stage_tier == 1:
        return 2
    return 3 if start >= EVENING else 4


def _unique(act_id: str, name: str, used: set[str]) -> tuple[str, str]:
    if act_id not in used:
        used.add(act_id)
        return act_id, name
    n = 2
    while f"{act_id}-{n}" in used:
        n += 1
    used.add(f"{act_id}-{n}")
    return f"{act_id}-{n}", f"{name} (set {n})"


def _tightest_gap(stage_sets: Iterable[list[PublishedSet]]) -> int:
    gaps = [
        parse_minutes(b.start) - parse_minutes(a.end)
        for items in stage_sets
        for a, b in zip(items, items[1:], strict=False)
    ]
    return max(0, min(gaps)) if gaps else DEFAULT_CHANGEOVER
