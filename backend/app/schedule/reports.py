"""Response models returned by scoring and optimization."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .models import BaselineStats, SetSlot

ClashLabel = Literal["hidden", "false"]
OptionKind = Literal["least_regret", "balanced", "fewest_moves"]


class ScheduleMetrics(BaseModel):
    regret: float = Field(description="Sum of pair regret over scored concurrent pairs.")
    clash_budget_index: float | None = Field(
        description="100 x regret / mean regret of random valid timetables; lower is better."
    )
    split_quality: float = Field(description="Sum of crowd-split quality over top-draw concurrent pairs.")
    split_index: float | None = Field(
        description="Split quality relative to the random baseline (100 = average)."
    )
    objective: float | None = Field(
        default=None, description="Optimizer objective at the requested weight (lower is better)."
    )
    scored_concurrent_pairs: int
    unscored_concurrent_pairs: int = Field(
        description="Concurrent pairs skipped because an act has no signal."
    )


class ClashAct(BaseModel):
    act_id: str
    name: str
    stage_id: str
    genre: str | None


class PairClash(BaseModel):
    rank: int
    a: ClashAct
    b: ClashAct
    day: int
    overlap_minutes: int
    concurrency: float
    audience_overlap: float
    draw: float
    regret: float
    regret_share: float
    split_quality: float | None = Field(description="Set only when both acts are in the top draw tier.")
    label: ClashLabel | None = Field(
        description=(
            '"hidden": genres differ but audiences overlap a lot. '
            '"false": genres match but audiences barely overlap.'
        )
    )
    confidence: Literal["strong", "weak"]


class StageFitFlag(BaseModel):
    act_id: str
    name: str
    stage_id: str
    stage_name: str
    stage_tier: int
    draw_rank: int
    lineup_size: int
    expected_tier_min: int
    expected_tier_max: int
    direction: Literal["bigger_stage_suggested", "smaller_stage_suggested"]
    message: str


class UnscoredAct(BaseModel):
    act_id: str
    name: str
    reason: Literal["no_signal", "not_in_matrix"]


class CoverageSummary(BaseModel):
    strong: int
    weak: int
    none: int
    scored_acts: int
    scored_share: float
    unscored: list[UnscoredAct]
    weak_act_ids: list[str]


class Movability(BaseModel):
    total_sets: int
    locked: int
    frozen_by_existing_violations: int
    unscored: int = Field(description="Sets the optimizer will not move because they have no overlap signal.")
    movable: int
    movable_share: float
    with_feasible_move: int | None = Field(
        default=None, description="Sets that have at least one feasible move (filled in by the optimizer)."
    )


class Violation(BaseModel):
    kind: Literal["gap", "hours", "curfew", "not_before", "not_after", "stage", "billing", "no_clash"]
    act_ids: list[str]
    message: str


class Thresholds(BaseModel):
    hidden_overlap: float | None
    false_overlap: float | None
    top_draw_cutoff: float | None


class ScoreReport(BaseModel):
    festival_id: str
    metrics: ScheduleMetrics
    baseline: BaselineStats | None
    clashes: list[PairClash] = Field(description="Concurrent pairs ranked by regret.")
    false_clashes: list[PairClash] = Field(
        description="Concurrent same-genre pairs with little shared audience."
    )
    splits: list[PairClash] = Field(description="Concurrent top-draw pairs ranked by split quality.")
    hidden_clash_count: int
    false_clash_count: int
    regret_by_act: dict[str, float]
    top_draw_acts: list[str]
    thresholds: Thresholds
    stage_fit: list[StageFitFlag]
    coverage: CoverageSummary
    movability: Movability
    violations: list[Violation]


class SlotRef(BaseModel):
    day: int
    stage_id: str
    start: int
    end: int
    label: str


class MoveReport(BaseModel):
    act_id: str
    name: str
    from_slot: SlotRef
    to_slot: SlotRef
    regret_delta: float = Field(description="Change in regret attributed to this move; negative is better.")
    swap_with: str | None = Field(
        description="Act id of the set that took the vacated slot, if it was a swap."
    )
    reason: str


class OptionReport(BaseModel):
    kind: OptionKind
    title: str
    improved: bool
    note: str | None
    same_as: OptionKind | None = Field(description="Set when this option is identical to an earlier one.")
    move_count: int
    moves: list[MoveReport]
    metrics: ScheduleMetrics
    regret_change: float
    regret_change_pct: float | None
    timetable: list[SetSlot]


class OptimizeReport(BaseModel):
    festival_id: str
    status: Literal["improved", "no_improvement"]
    message: str
    weight: float
    move_budget: int
    baseline: BaselineStats
    before: ScheduleMetrics
    options: list[OptionReport]
    movability: Movability
    elapsed_ms: int
