"""One worked decision on a preset day, and the rule search behind it.

``GET /api/presets/{preset_id}/decision?day=<n>`` picks the day's costliest clash that has a set able to move
and a legal place that lowers the Clash Budget Index, and answers with that clash, the single move with the
lowest index after it (priced as ``POST /whatif`` prices it) and, for the same pair, the answer of the rule
search below. ``GET /api/presets/{preset_id}/rule-fixes?a=<act_id>&b=<act_id>&limit=<1..5>`` is that search on
its own: the smallest changes this search found that leave the two sets with no shared minute and no new rule
break. Both read only the preset: no Qloo request, no model, nothing on the preset changes.

The search is the public compute of these routes, so it is bounded:

* a computed rule search takes one slot of the what-if limiter; a cache hit and a ``holds`` answer (the two
  sets already share no minute, nothing is searched) take none;
* it runs once per preset object and unordered pair. The first ``KEPT`` changes are kept, ``limit`` slices
  them, and ``fixes_found`` always counts the full list;
* ``/decision`` never runs the search in the request path more than once per preset object and day: the
  hero result, its embedded rule answer included, is computed on the first request under a lock and served
  from the cache afterwards (at most presets x days entries). A reloaded preset object replaces its entries.

Selection skips a clash whose sets cannot move (both locked, counted in ``skipped_locked``) and a clash for
which no unlocked set has a legal place that lowers the index (counted in ``skipped_no_place``), looking at
the day's first ``RANKED`` clashes at most.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Annotated, Any, NamedTuple

from fastapi import APIRouter, HTTPException, Path, Query, Request, Response

from .agent.clash_tools import PlanMove, PlanResult, apply_plan, compute_move_options
from .audit import NO_SETS, RANKED, _priced_pairs
from .presets import CACHE_CONTROL, Preset, Presets
from .runs import published_state
from .schedule import rulefix
from .schedule.layout import Layout
from .schedule.metrics import score_festival, shared_minutes
from .schedule.models import Festival, ScoringConfig, SetSlot, parse_minutes
from .whatif import ID_PATTERN, NO_STORE, NOT_ON_THIS_DAY, AppSettings, Limiter, _refuse, _take_slot

router = APIRouter(prefix="/api/presets", tags=["presets"])

DEFAULT_LIMIT = 3
MAX_LIMIT = rulefix.KEPT_FIXES
HERO_LIMIT = 3  # changes embedded in the decision's rule answer
SAME_INDEX = 0.05  # the other set's first place is named when its index is within this of the chosen one
CACHE_SIZE = 256
PICK_TWO = "Pick two different sets."

PairKey = tuple[str, str]

_rules: OrderedDict[tuple[str, PairKey], tuple[Preset, dict[str, Any]]] = OrderedDict()
_decisions: dict[tuple[str, int], tuple[Preset, dict[str, Any]]] = {}
_lock = threading.Lock()  # guards the two caches only
_compute = threading.RLock()  # one search at a time; the decision's computation calls the rule search too


def _pair_key(a_id: str, b_id: str) -> PairKey:
    return (a_id, b_id) if a_id <= b_id else (b_id, a_id)


# -------------------------------------------------------------------------------------- rule search


def cached_rule_search(preset: Preset, a_id: str, b_id: str) -> dict[str, Any] | None:
    """The search answer for this unordered pair, when this preset object already computed it."""
    with _lock:
        hit = _rules.get((preset.id, _pair_key(a_id, b_id)))
    return hit[1] if hit is not None and hit[0] is preset else None


def rule_search(preset: Preset, a_id: str, b_id: str) -> dict[str, Any]:
    """The search answer for an unordered pair: computed once per preset object, then served from the cache.

    The stored answer keeps the sides in the order of the first caller; ``in_order`` puts them in the order
    of any later one.
    """
    hit = cached_rule_search(preset, a_id, b_id)
    if hit is not None:
        return hit
    with _compute:
        hit = cached_rule_search(preset, a_id, b_id)
        if hit is not None:
            return hit
        state = published_state(preset)
        answer = rulefix.rule_fixes(state["festival"], state["matrix"], state["config"], a_id, b_id)
        key = (preset.id, _pair_key(a_id, b_id))
        with _lock:
            _rules[key] = (preset, answer)
            _rules.move_to_end(key)
            while len(_rules) > CACHE_SIZE:
                _rules.popitem(last=False)
        return answer


def rule_text(a: dict[str, Any], b: dict[str, Any]) -> str:
    return f"{a['act']} and {b['act']} must not overlap"


def in_order(search: dict[str, Any], a_id: str, limit: int) -> dict[str, Any]:
    """The rule answer as the route returns it: sides in the order asked, ``limit`` changes, the rule text."""
    a, b = (search["a"], search["b"]) if search["a"]["act_id"] == a_id else (search["b"], search["a"])
    return {
        "kind": "rule_fixes",
        "a": a,
        "b": b,
        "rule": rule_text(a, b),
        **{k: v for k, v in search.items() if k not in {"a", "b", "fixes"}},
        "fixes": search["fixes"][:limit],
    }


@router.get("/{preset_id}/rule-fixes")
def get_rule_fixes(
    preset_id: Annotated[str, Path(max_length=80, pattern=ID_PATTERN)],
    presets: Presets,
    request: Request,
    response: Response,
    limiter: Limiter,
    settings: AppSettings,
    a: Annotated[str, Query(max_length=80, pattern=ID_PATTERN)],
    b: Annotated[str, Query(max_length=80, pattern=ID_PATTERN)],
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
) -> dict[str, Any]:
    """The smallest changes this search found that end an overlap between two sets: single places on the
    5-minute grid for either set and swaps of either set with one other set. Tested only: nothing changes."""
    preset = presets.get(preset_id)
    if preset is None:
        raise _refuse(404, f"No preset {preset_id!r}.")
    if a == b:
        raise _refuse(422, PICK_TWO)
    on_day = {slot.act_id for slot in preset.festival.timetable}
    if a not in on_day or b not in on_day:
        raise _refuse(404, NOT_ON_THIS_DAY)
    search = cached_rule_search(preset, a, b)
    if search is None:
        if rulefix.published_shared(preset.festival, a, b) > 0:
            _take_slot(request, limiter, settings)  # a computed answer; a hit or a pair that holds takes none
        search = rule_search(preset, a, b)
    response.headers["Cache-Control"] = CACHE_CONTROL
    return in_order(search, a, limit)


# ----------------------------------------------------------------------------------------- decision


def _clock(value: str) -> int:
    minutes = parse_minutes(value)
    assert isinstance(minutes, int)
    return minutes


def _shift(slot: SetSlot, option: dict[str, Any]) -> int:
    return abs(_clock(option["start"]) - slot.start)


def _place(slot: SetSlot, act: str, option: dict[str, Any], *, text_from: str) -> dict[str, Any]:
    return {
        "act_id": slot.act_id,
        "act": act,
        "from": text_from,
        "stage_id": option["stage_id"],
        "stage": option["stage"],
        "day": option["day"],
        "start": option["start"],
        "end": option["end"],
        "minutes_moved": _shift(slot, option),
    }


class _Candidate(NamedTuple):
    """One set's first place (the lowest index after) as the day's decision considers it."""

    index: float  # the index after, before rounding: the order of the choice and of the tie
    act_id: str
    options: dict[str, Any]  # the set's search answer (``compute_move_options``, limit 1)
    place: dict[str, Any]
    plan: PlanResult  # that one move, priced as ``POST /whatif`` prices it


def _candidates(
    festival: Festival,
    matrix: Any,
    config: ScoringConfig,
    layout: Layout,
    published: float,
    ids: tuple[str, str],
) -> list[_Candidate]:
    """For each of the two sets that may move and has a legal place that lowers the index: its first place.
    Ordered by the index after, unrounded (two places can print the same index to 2 decimals), then act id."""
    assert config.baseline is not None
    found = []
    for act_id in ids:
        if layout.frozen[layout.rules.act_ids.index(act_id)]:
            continue
        options = compute_move_options(festival, matrix, config, act_id, 1, partners=True)
        if not options["options"] or not options["options"][0]["clash_budget_after"] < published:
            continue
        place = options["options"][0]
        step = PlanMove(act_id, place["stage_id"], place["day"], _clock(place["start"]))
        plan = apply_plan(festival, matrix, config, [step])
        index = 100.0 * plan.report.metrics.regret / config.baseline.mean_regret
        found.append(_Candidate(index, act_id, options, place, plan))
    return sorted(found, key=lambda c: (c.index, c.act_id))


def compute_decision(preset: Preset, day: int) -> dict[str, Any]:
    """The decision for one day of a preset (see the module docstring)."""
    state = published_state(preset)
    festival, matrix, config = state["festival"], state["matrix"], state["config"]
    slots = {slot.act_id: slot for slot in festival.timetable}
    names = {act.id: act.name for act in festival.acts}
    layout = Layout.from_festival(festival)
    published = score_festival(festival, matrix, config).metrics.clash_budget_index
    skipped_locked = skipped_no_place = 0
    answer: dict[str, Any] = {
        "kind": "decision",
        "day": day,
        "skipped_locked": 0,
        "skipped_no_place": 0,
        "clash": None,
        "published_budget": published,
        "move": None,
        "rule": None,
    }
    if published is None:
        return answer
    for rank, ((a_id, b_id), _, _) in enumerate(_priced_pairs(festival, matrix, day)[:RANKED], start=1):
        if slots[a_id].locked and slots[b_id].locked:
            skipped_locked += 1
            continue
        places = _candidates(festival, matrix, config, layout, published, (a_id, b_id))
        if not places:
            skipped_no_place += 1
            continue
        chosen = places[0]
        act_id, first, plan = chosen.act_id, chosen.place, chosen.plan
        other_id = b_id if act_id == a_id else a_id
        slot = slots[act_id]
        moved = {s.act_id: s for s in plan.festival.timetable}
        alternative = None
        if len(places) > 1 and places[1].index - chosen.index <= SAME_INDEX:
            alt = places[1]
            alternative = _place(
                slots[alt.act_id], names[alt.act_id], alt.place, text_from=alt.options["from"]
            )
        move = _place(slot, names[act_id], first, text_from=chosen.options["from"]) | {
            "legal_places": chosen.options["legal_places"],
            "stage_changed": first["stage_id"] != slot.stage_id,
            "budget_after": plan.steps[0].budget_after,
            "minutes_shared_after": shared_minutes(moved[act_id], moved[other_id]),
            "same_index_alternative": alternative,
        }
        answer |= {
            "skipped_locked": skipped_locked,
            "skipped_no_place": skipped_no_place,
            "clash": {
                "a_id": a_id,
                "b_id": b_id,
                "rank": rank,
                "minutes": shared_minutes(slots[a_id], slots[b_id]),
            },
            "move": move,
            "rule": in_order(rule_search(preset, a_id, b_id), a_id, HERO_LIMIT),
        }
        return answer
    return answer | {"skipped_locked": skipped_locked, "skipped_no_place": skipped_no_place}


def decision(preset: Preset, day: int) -> dict[str, Any]:
    """The decision, from the cache when this preset object already answered it for the day; otherwise it is
    computed once, under a lock, whatever the number of requests that arrive together."""
    key = (preset.id, day)
    with _lock:
        hit = _decisions.get(key)
    if hit is not None and hit[0] is preset:
        return hit[1]
    with _compute:
        with _lock:
            hit = _decisions.get(key)
        if hit is not None and hit[0] is preset:
            return hit[1]
        answer = compute_decision(preset, day)
        with _lock:
            _decisions[key] = (preset, answer)  # a reloaded preset replaces its own entries
        return answer


@router.get("/{preset_id}/decision")
def get_decision(
    preset_id: Annotated[str, Path(max_length=80, pattern=ID_PATTERN)],
    presets: Presets,
    response: Response,
    day: Annotated[int | None, Query()] = None,
) -> dict[str, Any]:
    """One worked decision on the published day: its costliest clash with a set that can move and a place that
    lowers the index, the one move with the lowest index after it, and the rule search for the pair. Cached
    per preset object and day; no limiter slot."""
    preset = presets.get(preset_id)
    if preset is None:
        raise HTTPException(status_code=404, detail=f"No preset {preset_id!r}.", headers=NO_STORE)
    days = {slot.day for slot in preset.festival.timetable}
    if day is None and days:
        day = min(days)
    if day is None or day not in days:
        raise HTTPException(status_code=422, detail=NO_SETS, headers=NO_STORE)
    response.headers["Cache-Control"] = CACHE_CONTROL
    return decision(preset, day)
