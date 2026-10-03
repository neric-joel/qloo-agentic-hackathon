"""The human what-if: where one set could go on a preset day, and a plan of kept moves priced stacked on the
published day. No model, no session, no rules input and no Qloo request; nothing on the preset changes.

``GET /api/presets/{preset_id}/moves?act=<act_id>&limit=8`` runs the same search as the agent's ``find_moves``
on the published timetable and its locks, and adds what the page shows beside each place: whether the act is
priced, and the set's clashes now and after the move among all the day's pairs, in Clash Budget Index points.

``POST /api/presets/{preset_id}/whatif`` takes up to 8 kept moves, in order. Each must be a place that search
lists for its set on the timetable the earlier moves left. It answers the Clash Budget Index after each move,
the moved timetable's 5 costliest clashes and, for one set, its places on the moved timetable.

Answers are kept in small in-process caches, since a preset only changes on redeploy. These two routes are the
public compute, so computed answers (not cache hits, not refusals) are capped per visitor and per day, per
server instance. A plan takes its slot before it is priced, so an illegal plan costs one too; the step it
failed on is remembered, and the same illegal plan again is answered from that with no slot and no work.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from .agent.clash_tools import IllegalStep, PlanMove, PlanResult, apply_plan, compute_move_options
from .config import Settings, get_settings
from .limits import LimitMessages, RunLimiter, visitor_key
from .presets import CACHE_CONTROL, Preset, Presets
from .runs import published_state
from .schedule.models import format_minutes, parse_minutes

router = APIRouter(prefix="/api/presets", tags=["presets"])

MAX_LIMIT = 12
MAX_PLAN_MOVES = 8
MAX_DAY = 13
PLAN_CLASHES = 5
CACHE_SIZE = 512
PLAN_CACHE_SIZE = 256
NO_STORE = {"Cache-Control": "no-store"}
NOT_ON_THIS_DAY = "That set is not on this festival day."
PICK_ONCE = "Pick each set once."
ILLEGAL_STEP = "Step {n} is not a legal place for that set after the steps before it."

ILLEGAL_CACHE_SIZE = 256

# Caps on computed answers of both routes, per server instance, come from the settings (``whatif_per_*``). If
# every visitor shares one address behind the proxy, set the per-visitor numbers equal to the global one.
WHATIF_MESSAGES = LimitMessages(
    hour="Too many what-if requests this hour. Please try again later.",
    day="You have reached today's limit of what-if requests. Please try again tomorrow.",
    global_day="What-if requests have reached today's limit. Please try again tomorrow.",
)

ID_PATTERN = r"^[A-Za-z0-9_.-]{1,80}$"
CLOCK_PATTERN = r"^\d{1,2}:[0-5]\d$"

PlanKey = tuple[str, tuple[PlanMove, ...], str | None, int | None]

_cache: OrderedDict[tuple[str, str, int], tuple[Preset, dict[str, Any]]] = OrderedDict()
_plans: OrderedDict[PlanKey, tuple[Preset, dict[str, Any]]] = OrderedDict()
_illegal: OrderedDict[PlanKey, tuple[Preset, int]] = OrderedDict()  # the plan's failing step
_cache_lock = threading.Lock()
_limiter: RunLimiter | None = None
_limiter_lock = threading.Lock()


def get_whatif_limiter() -> RunLimiter:
    """Caps on computed what-if answers, per visitor and for the whole instance (created on first use)."""
    global _limiter
    with _limiter_lock:
        if _limiter is None:
            settings = get_settings()
            _limiter = RunLimiter(
                settings.whatif_per_visitor_hour,
                settings.whatif_per_visitor_day,
                settings.whatif_per_day,
                messages=WHATIF_MESSAGES,
            )
        return _limiter


Limiter = Annotated[RunLimiter, Depends(get_whatif_limiter)]
AppSettings = Annotated[Settings, Depends(get_settings)]


def _refuse(status: int, detail: str) -> HTTPException:
    return HTTPException(status_code=status, detail=detail, headers=NO_STORE)


def _take_slot(request: Request, limiter: RunLimiter, settings: Settings) -> None:
    """Count one computed answer for this visitor, or refuse with 429 (a refusal stores nothing)."""
    host = request.client.host if request.client else None
    key = visitor_key(dict(request.headers), host, settings.visitor_stamp_secret)
    with _limiter_lock:  # these routes run in the thread pool; the limiter's counts are plain deques
        refusal = limiter.try_acquire(key)
    if refusal:
        raise _refuse(429, refusal)


def cached_move_options(preset: Preset, act_id: str, limit: int) -> dict[str, Any] | None:
    with _cache_lock:
        hit = _cache.get((preset.id, act_id, limit))
    return hit[1] if hit is not None and hit[0] is preset else None


def move_options(preset: Preset, act_id: str, limit: int) -> dict[str, Any]:
    """The priced places for one set, from the cache when this preset already answered them."""
    hit = cached_move_options(preset, act_id, limit)
    if hit is not None:
        return hit
    state = published_state(preset)
    found = compute_move_options(
        state["festival"], state["matrix"], state["config"], act_id, limit, partners=True
    )
    options = {"kind": "move_options", **found}
    key = (preset.id, act_id, limit)
    with _cache_lock:
        _cache[key] = (preset, options)
        _cache.move_to_end(key)
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)  # the oldest entry goes first
    return options


@router.get("/{preset_id}/moves")
def get_moves(
    preset_id: str,
    presets: Presets,
    request: Request,
    response: Response,
    limiter: Limiter,
    settings: AppSettings,
    act: Annotated[str, Query(max_length=80)],
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = 8,
) -> dict[str, Any]:
    """Every legal place a set could go on the published timetable, checking every start on a 5-minute grid,
    each priced with the Clash Budget after the move, best first. Tested only: nothing changes."""
    preset = presets.get(preset_id)
    if preset is None:
        raise HTTPException(status_code=404, detail=f"No preset {preset_id!r}.")
    if act not in {slot.act_id for slot in preset.festival.timetable}:
        raise HTTPException(status_code=404, detail=NOT_ON_THIS_DAY)
    options = cached_move_options(preset, act, limit)
    if options is None:
        _take_slot(request, limiter, settings)
        options = move_options(preset, act, limit)
    response.headers["Cache-Control"] = CACHE_CONTROL
    return options


# ------------------------------------------------------------------------------------------- plans


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class KeptMove(_Body):
    act: str = Field(max_length=80, pattern=ID_PATTERN)
    stage_id: str = Field(max_length=80, pattern=ID_PATTERN)
    day: int = Field(ge=0, le=MAX_DAY, strict=True)
    start: str = Field(max_length=5, pattern=CLOCK_PATTERN, description="'HH:MM' from the start of the day.")


class WhatIfRequest(_Body):
    moves: list[KeptMove] = Field(default_factory=list, max_length=MAX_PLAN_MOVES)
    act: str | None = Field(default=None, max_length=80, pattern=ID_PATTERN)
    limit: int = Field(default=8, ge=1, le=MAX_LIMIT, strict=True)


def _cached_plan(preset: Preset, key: PlanKey) -> dict[str, Any] | None:
    with _cache_lock:
        hit = _plans.get(key)
    return hit[1] if hit is not None and hit[0] is preset else None


def _store_plan(preset: Preset, key: PlanKey, answer: dict[str, Any]) -> None:
    with _cache_lock:
        _plans[key] = (preset, answer)
        _plans.move_to_end(key)
        while len(_plans) > PLAN_CACHE_SIZE:
            _plans.popitem(last=False)


def _known_illegal(preset: Preset, key: PlanKey) -> int | None:
    """The step a plan already failed on for this preset, or None."""
    with _cache_lock:
        hit = _illegal.get(key)
    return hit[1] if hit is not None and hit[0] is preset else None


def _store_illegal(preset: Preset, key: PlanKey, step: int) -> None:
    with _cache_lock:
        _illegal[key] = (preset, step)
        _illegal.move_to_end(key)
        while len(_illegal) > ILLEGAL_CACHE_SIZE:
            _illegal.popitem(last=False)


def plan_answer(
    preset: Preset, state: dict[str, Any], plan: PlanResult, act: str | None, limit: int
) -> dict[str, Any]:
    """The 200 body: the plan's budget, its steps, the moved timetable's costliest clashes, and the places
    for ``act`` on the moved timetable (the same object ``GET /moves`` gives) or None."""
    report = plan.report
    index = report.metrics.clash_budget_index
    options: dict[str, Any] | None = None
    if act is not None and not plan.steps:
        options = move_options(preset, act, limit)  # the published day: the places ``GET /moves`` lists
    elif act is not None:
        found = compute_move_options(
            plan.festival, state["matrix"], state["config"], act, limit, partners=True
        )
        options = {"kind": "move_options", **found}
    return {
        "kind": "whatif",
        "published_budget": plan.budget_before,
        "plan": {
            "budget": index,
            "steps": [
                {
                    "act": step.act,
                    "act_id": step.act_id,
                    "move": step.move,
                    "stage": step.stage,
                    "stage_id": step.stage_id,
                    "day": step.day,
                    "start": format_minutes(step.start),
                    "end": format_minutes(step.end),
                    "budget_after": step.budget_after,
                }
                for step in plan.steps
            ],
            "clashes": [
                {"a": c.a.name, "b": c.b.name, "points": round(c.regret_share * (index or 0.0), 1)}
                for c in report.clashes[:PLAN_CLASHES]
            ],
        },
        "options": options,
    }


@router.post("/{preset_id}/whatif")
def post_whatif(
    preset_id: Annotated[str, Path(max_length=80)],
    body: WhatIfRequest,
    presets: Presets,
    request: Request,
    response: Response,
    limiter: Limiter,
    settings: AppSettings,
) -> dict[str, Any]:
    """Price a plan of kept moves stacked on the published timetable, in order, and optionally the places for
    one set on the moved timetable. Tested only: nothing changes."""
    preset = presets.get(preset_id)
    if preset is None:
        raise _refuse(404, f"No preset {preset_id!r}.")
    on_day = {slot.act_id for slot in preset.festival.timetable}
    named = [move.act for move in body.moves]
    if any(act not in on_day for act in [*named, *([body.act] if body.act is not None else [])]):
        raise _refuse(404, NOT_ON_THIS_DAY)
    if len(set(named)) != len(named):
        raise _refuse(422, PICK_ONCE)
    moves = tuple(
        PlanMove(act_id=m.act, stage_id=m.stage_id, day=m.day, start=cast(int, parse_minutes(m.start)))
        for m in body.moves
    )
    key: PlanKey = (preset.id, moves, body.act, body.limit if body.act is not None else None)
    answer = _cached_plan(preset, key)
    if answer is None:
        if (step := _known_illegal(preset, key)) is not None:
            raise _refuse(422, ILLEGAL_STEP.format(n=step))
        _take_slot(request, limiter, settings)  # before any engine work: an illegal plan costs a slot too
        state = published_state(preset)
        try:
            plan = apply_plan(state["festival"], state["matrix"], state["config"], moves)
        except IllegalStep as exc:
            _store_illegal(preset, key, exc.step)
            raise _refuse(422, ILLEGAL_STEP.format(n=exc.step)) from None
        answer = plan_answer(preset, state, plan, body.act, body.limit)
        _store_plan(preset, key, answer)
    response.headers.update(NO_STORE)
    return answer
