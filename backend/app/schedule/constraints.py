"""Hard scheduling constraints, compiled to index form so they can be checked thousands of times per second.

A timetable is described by three parallel lists (day, stage and start per set). Sets are numbered in
timetable order; stages are numbered in ``Festival.stages`` order. A violation is reported as an *issue*:
a tuple whose first item names the kind, followed by the set indices involved.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from itertools import pairwise

from .models import MAX_MINUTES, Festival

NO_LIMIT = 10**6

Issue = tuple[str | int, ...]
Item = tuple[int, int, int]  # (start, end, set index) of one set on a stage-day
Grid = tuple[tuple[int, ...], ...]  # [day][stage]


@dataclass(frozen=True, slots=True)
class Rules:
    """Everything about a festival that does not change while sets are being moved."""

    act_ids: tuple[str, ...]
    names: tuple[str, ...]
    stage_ids: tuple[str, ...]
    stage_tier: tuple[int, ...]
    dur: tuple[int, ...]
    locked: tuple[bool, ...]
    stage_locked: tuple[bool, ...]
    not_before: tuple[int, ...]
    home_day: tuple[int, ...]
    billing: tuple[tuple[int | None, int | None] | None, ...]
    no_clash: tuple[tuple[int, ...], ...]
    open: Grid
    close: Grid
    curfew: tuple[int, ...]
    changeover: int
    allow_day_moves: bool

    @property
    def n_sets(self) -> int:
        return len(self.act_ids)

    @property
    def n_days(self) -> int:
        return len(self.curfew)

    @property
    def n_stages(self) -> int:
        return len(self.stage_ids)

    def latest_end(self, day: int, stage: int) -> int:
        return min(self.close[day][stage], self.curfew[day])


def build_rules(festival: Festival) -> Rules:
    """Compile a festival's constraints. Sets keep the order of ``festival.timetable``."""
    slots = festival.timetable
    act_index = {slot.act_id: i for i, slot in enumerate(slots)}
    acts = festival.act_by_id()
    constraints = festival.constraints
    n_days = len(festival.days)
    opens, closes = _stage_windows(festival, n_days)
    return Rules(
        act_ids=tuple(slot.act_id for slot in slots),
        names=tuple(acts[slot.act_id].name for slot in slots),
        stage_ids=tuple(stage.id for stage in festival.stages),
        stage_tier=tuple(stage.tier for stage in festival.stages),
        dur=tuple(slot.duration for slot in slots),
        locked=tuple(slot.locked for slot in slots),
        stage_locked=tuple(slot.stage_locked for slot in slots),
        not_before=tuple(slot.not_before or 0 for slot in slots),
        home_day=tuple(slot.day for slot in slots),
        billing=tuple(_billing_limits(festival, acts[slot.act_id].billing_tier) for slot in slots),
        no_clash=_no_clash_partners(festival, act_index),
        open=opens,
        close=closes,
        curfew=tuple(constraints.curfew.get(day, NO_LIMIT) for day in range(n_days)),
        changeover=constraints.changeover_minutes,
        allow_day_moves=constraints.allow_day_moves,
    )


def _stage_windows(festival: Festival, n_days: int) -> tuple[Grid, Grid]:
    """Opening and closing minute per day and stage.

    Stages without published hours may use the whole program window of the day, from the first set's
    start to the last set's end, so re-slotting never stretches the day.
    """
    program: dict[int, tuple[int, int]] = {}
    for slot in festival.timetable:
        lo, hi = program.get(slot.day, (MAX_MINUTES, 0))
        program[slot.day] = (min(lo, slot.start), max(hi, slot.end))
    opens, closes = [], []
    for day in range(n_days):
        default = program.get(day, (0, MAX_MINUTES))
        row_open, row_close = [], []
        for stage in festival.stages:
            hours = {h.day: (h.open, h.close) for h in stage.hours}.get(day, default)
            row_open.append(hours[0])
            row_close.append(hours[1])
        opens.append(tuple(row_open))
        closes.append(tuple(row_close))
    return tuple(opens), tuple(closes)


def _billing_limits(festival: Festival, billing_tier: int) -> tuple[int | None, int | None] | None:
    """Strictest (max stage tier, last-slots) limits that apply to an act of this billing tier."""
    rules = [r for r in festival.constraints.billing_rules if r.billing_tier == billing_tier]
    if not rules:
        return None
    tiers = [r.max_stage_tier for r in rules if r.max_stage_tier is not None]
    slots = [r.last_slots for r in rules if r.last_slots is not None]
    return (min(tiers) if tiers else None, min(slots) if slots else None)


def _no_clash_partners(festival: Festival, act_index: dict[str, int]) -> tuple[tuple[int, ...], ...]:
    partners: list[set[int]] = [set() for _ in act_index]
    for a, b in festival.constraints.no_clash_with:
        if a in act_index and b in act_index:
            partners[act_index[a]].add(act_index[b])
            partners[act_index[b]].add(act_index[a])
    return tuple(tuple(sorted(p)) for p in partners)


def placement_issues(rules: Rules, i: int, day: int, stage: int, start: int) -> list[Issue]:
    """Problems with set ``i`` sitting at this place, judged on its own."""
    end = start + rules.dur[i]
    found: list[Issue] = []
    if start < rules.open[day][stage] or end > rules.close[day][stage]:
        found.append(("hours", i))
    if end > rules.curfew[day]:
        found.append(("curfew", i))
    if start < rules.not_before[i]:
        found.append(("not_before", i))
    return found


def stage_day_issues(rules: Rules, stage: int, items: Sequence[Item]) -> list[Issue]:
    """Changeover and billing problems on one stage-day; ``items`` must be sorted by start."""
    found: list[Issue] = []
    for (_, end, first), (start, _, second) in pairwise(items):
        if start - end < rules.changeover:
            found.append(("gap", first, second))
    last_position = len(items)
    for position, (_, _, i) in enumerate(items):
        limits = rules.billing[i]
        if limits is None:
            continue
        max_tier, last_slots = limits
        too_small_stage = max_tier is not None and rules.stage_tier[stage] > max_tier
        too_early = last_slots is not None and last_position - position > last_slots
        if too_small_stage or too_early:
            found.append(("billing", i))
    return found


def involved_sets(issues: Sequence[Issue]) -> set[int]:
    return {i for issue in issues for i in issue[1:] if isinstance(i, int)}


def describe_issue(issue: Issue, rules: Rules) -> str:
    """Plain-English description of an issue."""
    kind = issue[0]
    names = [rules.names[i] for i in issue[1:] if isinstance(i, int)]
    if kind == "gap":
        return f"{names[0]} and {names[1]} are closer than the {rules.changeover}-minute changeover"
    if kind == "no_clash":
        return f"{names[0]} and {names[1]} play at the same time, which their riders forbid"
    messages = {
        "hours": "is scheduled outside its stage's opening hours",
        "curfew": "runs past the curfew",
        "not_before": "starts before its earliest allowed time",
        "billing": "breaks its billing-tier rule",
    }
    return f"{names[0]} {messages[str(kind)]}"
