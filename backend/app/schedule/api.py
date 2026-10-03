"""HTTP routes for scoring festival timetables (mounted under ``/api/schedule``).

Re-slotting is not a public route: it is only reachable through the agent's ``reslot`` tool, which
labels its results as suggestions.
"""

from __future__ import annotations

from collections.abc import Callable
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field

from .metrics import score_festival
from .models import Festival, OverlapMatrix, ScheduleInputError, ScoringConfig
from .reports import ScoreReport
from .synthetic import synthetic_festival

MAX_SCHEDULED_SETS = 80
MAX_BASELINE_SAMPLES = 300  # cap for this public route; ScoringConfig itself allows more for offline scoring
MAX_DEMO_SEED = 99
DEMO_CACHE_CONTROL = "public, s-maxage=3600"

router = APIRouter(prefix="/api/schedule", tags=["schedule"])


class ScoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    festival: Festival
    matrix: OverlapMatrix
    config: ScoringConfig = Field(default_factory=ScoringConfig)


class DemoResponse(BaseModel):
    festival: Festival
    matrix: OverlapMatrix
    report: ScoreReport


def _unprocessable(message: str) -> HTTPException:
    return HTTPException(status_code=422, detail=[{"loc": ["body"], "msg": message, "type": "value_error"}])


def _check_limits(request: ScoreRequest) -> None:
    sets = len(request.festival.timetable)
    if sets > MAX_SCHEDULED_SETS:
        raise _unprocessable(f"at most {MAX_SCHEDULED_SETS} scheduled sets are supported, got {sets}")
    samples = request.config.baseline_samples
    if samples > MAX_BASELINE_SAMPLES:
        raise _unprocessable(f"at most {MAX_BASELINE_SAMPLES} baseline samples are supported, got {samples}")


def _run[T](work: Callable[[], T]) -> T:
    try:
        return work()
    except ScheduleInputError as error:
        raise _unprocessable(str(error)) from error


@router.post("/score", response_model=ScoreReport)
def score(request: ScoreRequest) -> ScoreReport:
    """Score a timetable: Clash Budget Index, ranked clashes with hidden/false labels, stage-fit flags."""
    _check_limits(request)
    return _run(lambda: score_festival(request.festival, request.matrix, request.config))


@lru_cache(maxsize=8)
def _demo(seed: int) -> DemoResponse:
    festival, matrix = synthetic_festival(seed)
    return DemoResponse(festival=festival, matrix=matrix, report=score_festival(festival, matrix))


@router.get("/demo", response_model=DemoResponse)
def demo(
    response: Response,
    seed: Annotated[int, Query(ge=0, le=MAX_DEMO_SEED, description="Seed of the synthetic festival.")] = 7,
) -> DemoResponse:
    """A synthetic festival and overlap matrix (source "synthetic") together with its score."""
    response.headers["Cache-Control"] = DEMO_CACHE_CONTROL
    return _demo(seed)
