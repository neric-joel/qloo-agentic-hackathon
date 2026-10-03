"""Domain models for festival timetables, scheduling constraints and audience-overlap data.

Time convention: every time is an integer number of minutes from the start (00:00) of the festival day it
belongs to. Values past 1440 describe after-midnight sets that still belong to that festival day (for
example ``"25:30"`` or ``1530``). Inputs may also be written as ``"HH:MM"`` strings. Days are referenced by
their 0-based index into ``Festival.days``.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from itertools import pairwise
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    WithJsonSchema,
    model_validator,
)

MINUTES_PER_DAY = 1440
MAX_MINUTES = 2 * MINUTES_PER_DAY - 1
MAX_DAYS = 14
MAX_ACTS = 200
MAX_STAGES = 20

_CLOCK = re.compile(r"^(\d{1,2}):([0-5]\d)$")
_MATRIX_TOLERANCE = 1e-6


class ScheduleInputError(ValueError):
    """The festival, matrix or options cannot be scored or optimized as given."""


def parse_minutes(value: object) -> object:
    """Accept ``"HH:MM"`` strings; pass everything else on to the integer validator."""
    if isinstance(value, str):
        match = _CLOCK.match(value.strip())
        if match is None:
            raise ValueError(f"time must be minutes from day start or 'HH:MM', got {value!r}")
        return int(match[1]) * 60 + int(match[2])
    return value


def format_minutes(minutes: int) -> str:
    """Render minutes from day start as ``HH:MM`` (hours may exceed 23 for after-midnight sets)."""
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


Minutes = Annotated[
    int,
    BeforeValidator(parse_minutes),
    Field(ge=0, le=MAX_MINUTES),
    WithJsonSchema(
        {
            "anyOf": [
                {"type": "integer", "minimum": 0, "maximum": MAX_MINUTES},
                {"type": "string", "pattern": r"^\d{1,2}:[0-5]\d$"},
            ],
            "description": "Minutes from the start of the festival day, or an 'HH:MM' string.",
        },
        mode="validation",
    ),
]

Coverage = Literal["strong", "weak", "none"]
MatrixSource = Literal["qloo", "derived", "synthetic"]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StageHours(_Model):
    day: int = Field(ge=0)
    open: Minutes
    close: Minutes

    @model_validator(mode="after")
    def _opens_before_closing(self) -> StageHours:
        if self.close <= self.open:
            raise ValueError("close must be after open")
        return self


class Stage(_Model):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    tier: int = Field(default=1, ge=1, le=9, description="1 = main stage, larger numbers = smaller stages.")
    capacity: int | None = Field(default=None, gt=0)
    hours: list[StageHours] = Field(
        default_factory=list,
        description="Optional opening hours per day. Days without an entry may use the day's program window.",
    )

    @model_validator(mode="after")
    def _one_entry_per_day(self) -> Stage:
        days = [h.day for h in self.hours]
        if len(days) != len(set(days)):
            raise ValueError(f"stage {self.id!r} lists hours twice for the same day")
        return self


class Act(_Model):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=160)
    qloo_id: str | None = None
    popularity: float | None = Field(default=None, ge=0, le=1)
    genre: str | None = Field(default=None, max_length=80)
    billing_tier: int = Field(default=3, ge=1, le=4, description="1 = headliner ... 4 = early undercard.")
    rarity: float = Field(
        default=0.5,
        ge=0,
        le=1,
        description="How hard this act is to catch elsewhere soon (1 = rarely seen). 0.5 is neutral.",
    )


class SetSlot(_Model):
    act_id: str
    day: int = Field(ge=0, description="0-based index into Festival.days.")
    stage_id: str
    start: Minutes
    end: Minutes
    locked: bool = Field(default=False, description="The set may not move at all.")
    stage_locked: bool = Field(default=False, description="The set may change time but not stage.")
    not_before: Minutes | None = Field(default=None, description="The set may not start earlier than this.")
    not_after: Minutes | None = Field(default=None, description="The set may not start later than this.")
    stages: Annotated[list[str], Field(min_length=1, max_length=MAX_STAGES)] | None = Field(
        default=None,
        description="Ids of the stages the set may play on, including its current one. None means any stage.",
    )

    @model_validator(mode="after")
    def _ends_after_start(self) -> SetSlot:
        if self.end <= self.start:
            raise ValueError(f"set for {self.act_id!r} must end after it starts")
        return self

    @model_validator(mode="after")
    def _start_window_in_order(self) -> SetSlot:
        """An empty start window is an input error; a published start outside the window is not."""
        if self.not_before is not None and self.not_after is not None and self.not_before > self.not_after:
            raise ValueError(
                f"set for {self.act_id!r} has not_before {format_minutes(self.not_before)} "
                f"later than not_after {format_minutes(self.not_after)}"
            )
        return self

    @property
    def duration(self) -> int:
        return self.end - self.start


class BillingRule(_Model):
    """Acts of one billing tier may only play on certain stages and, optionally, in the closing slots."""

    billing_tier: int = Field(ge=1, le=4)
    max_stage_tier: int | None = Field(default=1, ge=1, description="Must play on a stage with tier <= this.")
    last_slots: int | None = Field(
        default=2, ge=1, description="Must be among the last N sets of that stage's day."
    )

    @model_validator(mode="after")
    def _restricts_something(self) -> BillingRule:
        if self.max_stage_tier is None and self.last_slots is None:
            raise ValueError("a billing rule needs max_stage_tier, last_slots or both")
        return self


class Constraints(_Model):
    changeover_minutes: int = Field(
        default=15, ge=0, le=240, description="Minimum gap between sets on a stage."
    )
    curfew: dict[int, Minutes] = Field(
        default_factory=dict, description="Day index -> minute by which every set must have ended."
    )
    no_clash_with: list[tuple[str, str]] = Field(
        default_factory=list,
        description="Pairs of act ids (from riders) that may never play at the same time.",
    )
    billing_rules: list[BillingRule] = Field(default_factory=list)
    allow_day_moves: bool = Field(
        default=False, description="Allow the optimizer to move sets to a different festival day."
    )


def _expand_days(value: object) -> object:
    if isinstance(value, int) and not isinstance(value, bool):
        if not 1 <= value <= MAX_DAYS:
            raise ValueError(f"days must be between 1 and {MAX_DAYS}")
        return [f"Day {n}" for n in range(1, value + 1)]
    return value


class Festival(_Model):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=160)
    city: str | None = None
    days: Annotated[
        list[str],
        BeforeValidator(_expand_days),
        Field(min_length=1, max_length=MAX_DAYS, description="Day labels, or a number of days."),
    ]
    stages: list[Stage] = Field(min_length=1, max_length=MAX_STAGES)
    acts: list[Act] = Field(min_length=1, max_length=MAX_ACTS)
    timetable: list[SetSlot] = Field(max_length=MAX_ACTS)
    constraints: Constraints = Field(default_factory=Constraints)

    @model_validator(mode="after")
    def _consistent(self) -> Festival:
        problems = [
            *self._duplicate_ids(),
            *self._unknown_references(),
            *self._same_stage_overlaps(),
        ]
        if problems:
            shown = "; ".join(problems[:8])
            more = f" (+{len(problems) - 8} more)" if len(problems) > 8 else ""
            raise ValueError(shown + more)
        return self

    def _duplicate_ids(self) -> list[str]:
        problems = []
        for label, ids in (("stage", [s.id for s in self.stages]), ("act", [a.id for a in self.acts])):
            dupes = sorted({x for x in ids if ids.count(x) > 1})
            problems += [f"duplicate {label} id {x!r}" for x in dupes]
        scheduled = [s.act_id for s in self.timetable]
        problems += [
            f"act {x!r} has more than one set"
            for x in sorted({x for x in scheduled if scheduled.count(x) > 1})
        ]
        return problems

    def _unknown_references(self) -> list[str]:
        acts = {a.id for a in self.acts}
        stages = {s.id for s in self.stages}
        problems = []
        for slot in self.timetable:
            if slot.act_id not in acts:
                problems.append(f"timetable references unknown act {slot.act_id!r}")
            if slot.stage_id not in stages:
                problems.append(f"set for {slot.act_id!r} is on unknown stage {slot.stage_id!r}")
            if slot.stages is not None:
                problems += [
                    f"set for {slot.act_id!r} lists unknown stage {stage_id!r}"
                    for stage_id in slot.stages
                    if stage_id not in stages
                ]
                if slot.stage_id not in slot.stages:
                    problems.append(
                        f"set for {slot.act_id!r} is on stage {slot.stage_id!r}, "
                        "which is not one of its allowed stages"
                    )
            if slot.day >= len(self.days):
                problems.append(
                    f"set for {slot.act_id!r} is on day {slot.day} but there are {len(self.days)} days"
                )
        for stage in self.stages:
            problems += [
                f"stage {stage.id!r} has hours for unknown day {h.day}"
                for h in stage.hours
                if h.day >= len(self.days)
            ]
        problems += [
            f"curfew set for unknown day {d}" for d in self.constraints.curfew if d >= len(self.days)
        ]
        for pair in self.constraints.no_clash_with:
            problems += [f"no_clash_with references unknown act {a!r}" for a in pair if a not in acts]
            if pair[0] == pair[1]:
                problems.append(f"no_clash_with pairs act {pair[0]!r} with itself")
        return problems

    def _same_stage_overlaps(self) -> list[str]:
        names = {a.id: a.name for a in self.acts}
        by_stage_day: dict[tuple[int, str], list[SetSlot]] = defaultdict(list)
        for slot in self.timetable:
            by_stage_day[(slot.day, slot.stage_id)].append(slot)
        problems = []
        for (day, stage_id), slots in sorted(by_stage_day.items()):
            slots = sorted(slots, key=lambda s: (s.start, s.end))
            for first, second in pairwise(slots):
                if second.start < first.end:
                    problems.append(
                        f"{names.get(first.act_id, first.act_id)!r} and "
                        f"{names.get(second.act_id, second.act_id)!r} "
                        f"overlap on stage {stage_id!r}, day {day} "
                        f"({format_minutes(first.start)}-{format_minutes(first.end)} vs "
                        f"{format_minutes(second.start)}-{format_minutes(second.end)})"
                    )
        return problems

    def act_by_id(self) -> dict[str, Act]:
        return {a.id: a for a in self.acts}

    def stage_by_id(self) -> dict[str, Stage]:
        return {s.id: s for s in self.stages}


class OverlapMatrix(_Model):
    """Pairwise audience overlap between acts: 0 = no shared audience, 1 = identical audience."""

    act_ids: list[str] = Field(max_length=MAX_ACTS)
    values: list[list[float]]
    coverage: dict[str, Coverage] = Field(
        default_factory=dict,
        description=(
            'Per-act signal strength. "none" excludes the act from scoring; '
            'acts without an entry count as "strong".'
        ),
    )
    source: MatrixSource

    @model_validator(mode="after")
    def _well_formed(self) -> OverlapMatrix:
        n = len(self.act_ids)
        if len(set(self.act_ids)) != n:
            raise ValueError("matrix act_ids must be unique")
        if len(self.values) != n or any(len(row) != n for row in self.values):
            raise ValueError(f"matrix values must be {n}x{n} to match act_ids")
        unknown = sorted(set(self.coverage) - set(self.act_ids))
        if unknown:
            raise ValueError(f"coverage lists acts that are not in the matrix: {unknown[:5]}")
        self._check_cells()
        return self

    def _check_cells(self) -> None:
        for i, row in enumerate(self.values):
            for j, value in enumerate(row):
                if not math.isfinite(value) or not 0.0 <= value <= 1.0:
                    raise ValueError(f"matrix value [{i}][{j}]={value} must be a number between 0 and 1")
            if abs(row[i]) > _MATRIX_TOLERANCE:
                raise ValueError(f"matrix diagonal [{i}][{i}]={row[i]} must be 0")
            for j in range(i + 1, len(row)):
                if abs(row[j] - self.values[j][i]) > _MATRIX_TOLERANCE:
                    raise ValueError(
                        f"matrix is not symmetric: [{i}][{j}]={row[j]} but [{j}][{i}]={self.values[j][i]}"
                    )

    def index(self) -> dict[str, int]:
        return {act_id: i for i, act_id in enumerate(self.act_ids)}

    def value(self, a: str, b: str) -> float:
        index = self.index()
        return self.values[index[a]][index[b]]

    def coverage_of(self, act_id: str) -> Coverage:
        return self.coverage.get(act_id, "strong")


class BaselineStats(_Model):
    """Summary of the random valid timetables a Clash Budget Index is measured against."""

    samples: int
    mean_regret: float
    std_regret: float = 0.0
    mean_split: float = 0.0
    p10_index: float | None = Field(
        default=None, description="Index of the 10th-percentile random timetable."
    )
    p90_index: float | None = Field(
        default=None, description="Index of the 90th-percentile random timetable."
    )
    degenerate: bool = Field(
        default=False, description="True when nothing could be re-shuffled, so the baseline equals the input."
    )


class ScoringConfig(_Model):
    baseline_samples: int = Field(
        default=300, ge=0, le=2000, description="Random timetables in the baseline."
    )
    seed: int = Field(default=7, description="Seed for the baseline sampler and the optimizer.")
    top_draw_share: float = Field(
        default=0.3, gt=0, le=1, description="Share of the lineup (by draw) that counts as the top draw tier."
    )
    hidden_quantile: float = Field(
        default=0.9,
        gt=0,
        lt=1,
        description="Overlap quantile above which differing genres make a hidden clash.",
    )
    false_quantile: float = Field(
        default=0.25,
        gt=0,
        lt=1,
        description="Overlap quantile below which matching genres make a false clash.",
    )
    top_clashes: int = Field(default=15, ge=1, le=200)
    stage_fit_tolerance: float = Field(
        default=0.1,
        ge=0,
        le=0.5,
        description="Rank slack (share of the lineup) before a stage-fit flag is raised.",
    )
    baseline: BaselineStats | None = Field(
        default=None,
        description="Reuse a baseline from an earlier response instead of sampling again.",
    )
