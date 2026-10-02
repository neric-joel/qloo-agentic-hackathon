"""HTTP routes for scoring and re-slotting festival timetables (mounted under ``/api/schedule``)."""

from __future__ import annotations

from collections.abc import Callable
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from .metrics import score_festival
from .models import Festival, OverlapMatrix, ScheduleInputError, ScoringConfig
from .optimizer import optimize
from .reports import OptimizeReport, ScoreReport
from .synthetic import synthetic_festival

MAX_SCHEDULED_SETS = 80

router = APIRouter(prefix="/api/schedule", tags=["schedule"])


class ScoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    festival: Festival
    matrix: OverlapMatrix
    config: ScoringConfig = Field(default_factory=ScoringConfig)


class OptimizeRequest(ScoreRequest):
    weight: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="1 = minimize fan regret, 0 = maximize clashes that split big crowds cleanly.",
    )
    move_budget: int = Field(
        default=6,
        ge=1,
        le=30,
        description="Most sets the balanced option may re-slot (a swap counts as two).",
    )


class DemoResponse(BaseModel):
    festival: Festival
    matrix: OverlapMatrix
    report: ScoreReport


def _unprocessable(message: str) -> HTTPException:
    return HTTPException(status_code=422, detail=[{"loc": ["body"], "msg": message, "type": "value_error"}])


def _check_size(request: ScoreRequest) -> None:
    sets = len(request.festival.timetable)
    if sets > MAX_SCHEDULED_SETS:
        raise _unprocessable(f"at most {MAX_SCHEDULED_SETS} scheduled sets are supported, got {sets}")


def _run[T](work: Callable[[], T]) -> T:
    try:
        return work()
    except ScheduleInputError as error:
        raise _unprocessable(str(error)) from error


@router.post("/score", response_model=ScoreReport)
def score(request: ScoreRequest) -> ScoreReport:
    """Score a timetable: Clash Budget Index, ranked clashes with hidden/false labels, stage-fit flags."""
    _check_size(request)
    return _run(lambda: score_festival(request.festival, request.matrix, request.config))


@router.post("/optimize", response_model=OptimizeReport)
def optimize_timetable(request: OptimizeRequest) -> OptimizeReport:
    """Re-slot the movable sets: least regret, balanced within a move budget, and fewest moves."""
    _check_size(request)
    return _run(
        lambda: optimize(
            request.festival, request.matrix, request.weight, request.move_budget, request.config
        )
    )


@lru_cache(maxsize=8)
def _demo(seed: int) -> DemoResponse:
    festival, matrix = synthetic_festival(seed)
    return DemoResponse(festival=festival, matrix=matrix, report=score_festival(festival, matrix))


@router.get("/demo", response_model=DemoResponse)
def demo(
    seed: Annotated[int, Query(ge=0, le=9999, description="Seed of the synthetic festival.")] = 7,
) -> DemoResponse:
    """A synthetic festival and overlap matrix (source "synthetic") together with its score."""
    return _demo(seed)
