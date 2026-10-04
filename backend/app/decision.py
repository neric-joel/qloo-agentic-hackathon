"""One worked decision on a preset day, and the rule search behind it.

``GET /api/presets/{preset_id}/decision?day=<n>`` picks the day's costliest clash that has a set able to move
and a legal place that lowers the Clash Budget Index, and answers with that clash, the single move with the
lowest index after it (priced as ``POST /whatif`` prices it) and, for the same pair, the answer of the rule
search below. ``GET /api/presets/{preset_id}/rule-fixes?a=<act_id>&b=<act_id>&limit=<1..5>`` is that search on
its own: the smallest changes this search found that leave the two sets with no shared minute and no new rule
break. Both read only the preset: no Qloo request, no model, nothing on the preset changes.

The search is the public compute of these routes, so it is bounded:

* a computed rule search takes exactly one slot of the what-if limiter, inside the pair's lock after the
  cache is checked again; a cache hit, a follower that waited and found the answer cached, a ``holds`` answer
  (the two sets already share no minute) and a pair of two locked sets take none;
* it runs once per preset object and unordered pair. The first ``KEPT`` changes are kept, ``limit`` slices
  them, and ``fixes_found`` always counts the full list. Only searched answers enter the 256-entry cache;
  the answers that cost nothing are never stored;
* ``/decision`` is computed per preset object and day by ``warm`` when the presets are loaded (application
  startup), under that day's own lock; a request that comes first computes it the same way and waits on that
  day's lock only. The hero result, its embedded rule answer included, is served from the cache afterwards
  (at most presets x days entries). A reloaded preset object replaces its entries. There is no global lock.

The answer also carries what each change leaves behind, so a page can set the two side by side without a
second request: ``costliest_after`` (the day's costliest clash on the timetable after the change, read from
the same scorer ``POST /whatif`` uses, with its index points printed as that route's clash list prints them)
and the number of stage-fit flags before and after. They are computed here, once, in the same warm step.

Selection skips a clash whose sets cannot move (both locked, counted in ``skipped_locked``) and a clash for
which no unlocked set has a legal place that lowers the index (counted in ``skipped_no_place``), looking at
the day's first ``RANKED`` clashes at most.
"""

from __future__ import annotations

import sys
import threading
import time
from collections import OrderedDict
from collections.abc import Callable, Mapping
from typing import Annotated, Any, NamedTuple

from fastapi import APIRouter, HTTPException, Path, Query, Request, Response

from .agent.clash_tools import (
    IllegalStep,
    PlanGroup,
    PlanMove,
    PlanResult,
    apply_plan,
    compute_move_options,
)
from .audit import NO_SETS, RANKED, _priced_pairs
from .presets import CACHE_CONTROL, Preset, Presets
from .runs import published_state
from .schedule import rulefix
from .schedule.layout import Layout
from .schedule.metrics import score_festival, shared_minutes
from .schedule.models import Festival, ScoringConfig, SetSlot, parse_minutes
from .schedule.reports import ScoreReport
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
_lock = threading.Lock()  # guards the two caches and the lock table only; nothing is computed under it
_key_locks: dict[tuple[Any, ...], threading.Lock] = {}  # one per answer: a search or a day


def _pair_key(a_id: str, b_id: str) -> PairKey:
    return (a_id, b_id) if a_id <= b_id else (b_id, a_id)


def _lock_for(key: tuple[Any, ...]) -> threading.Lock:
    """The lock of one computed answer. Two answers never share a lock, so a cold request for one never
    waits for the computation of another. There is at most one per pair that can be searched and per day."""
    with _lock:
        return _key_locks.setdefault(key, threading.Lock())


# -------------------------------------------------------------------------------------- rule search


def cached_rule_search(preset: Preset, a_id: str, b_id: str) -> dict[str, Any] | None:
    """The search answer for this unordered pair, when this preset object already computed it."""
    with _lock:
        hit = _rules.get((preset.id, _pair_key(a_id, b_id)))
    return hit[1] if hit is not None and hit[0] is preset else None


def rule_search(
    preset: Preset, a_id: str, b_id: str, *, before_compute: Callable[[], None] | None = None
) -> dict[str, Any]:
    """The search answer for an unordered pair: computed once per preset object, then served from the cache.

    The search is single-flight. The caller that finds no answer takes the pair's lock, looks again, and only
    then (the answer still missing, a search about to run) calls ``before_compute``: the route takes its
    limiter slot there, so a computation costs one slot however many requests arrive together, and a request
    that waited and then found the answer cached takes none. If ``before_compute`` raises, nothing is
    computed or stored. A pair that holds and a pair of two locked sets are read off the published day: they
    take no lock, no slot and no cache entry, so free requests cannot push a computed answer out.

    The stored answer keeps the sides in the order of the first caller; ``in_order`` puts them in the order
    of any later one.
    """
    hit = cached_rule_search(preset, a_id, b_id)
    if hit is not None:
        return hit
    state = published_state(preset)
    festival, matrix, config = state["festival"], state["matrix"], state["config"]
    if not rulefix.searches(festival, a_id, b_id):
        return rulefix.rule_fixes(festival, matrix, config, a_id, b_id)
    key = (preset.id, _pair_key(a_id, b_id))
    with _lock_for(("rule", *key)):
        hit = cached_rule_search(preset, a_id, b_id)
        if hit is not None:
            return hit
        if before_compute is not None:
            before_compute()
        answer = rulefix.rule_fixes(festival, matrix, config, a_id, b_id)
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
    # One slot per computation, taken inside the pair's lock once the cache is known to be empty
    search = rule_search(preset, a, b, before_compute=lambda: _take_slot(request, limiter, settings))
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


def _every_clash(config: ScoringConfig) -> ScoringConfig:
    """The same scoring with no cut to the festival's costliest pairs. ``score_festival`` keeps only the
    ``top_clashes`` costliest pairs across all days (15 by default), so on a multi-day festival a day whose
    clashes all fall below that line would have none in ``report.clashes``. The copy skips the field's
    validation on purpose: its ``le=200`` bound would cut a large festival too. Prices, the index and the
    order of the pairs are unchanged; only the length of the list is."""
    return config.model_copy(update={"top_clashes": sys.maxsize})


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
        plan = apply_plan(festival, matrix, _every_clash(config), [step])
        index = 100.0 * plan.report.metrics.regret / config.baseline.mean_regret
        found.append(_Candidate(index, act_id, options, place, plan))
    return sorted(found, key=lambda c: (c.index, c.act_id))


def _costliest(report: ScoreReport, day: int) -> dict[str, Any] | None:
    """The day's costliest clash on a scored timetable, as ``POST /whatif`` lists a clash (names, and index
    points = the clash's share of the day's price times the index, one decimal), plus the minutes the two sets
    share. None when no clash on the day has a price."""
    index = report.metrics.clash_budget_index
    clash = next((c for c in report.clashes if c.day == day), None)
    if clash is None:
        return None
    return {
        "a": clash.a.name,
        "b": clash.b.name,
        "minutes": clash.overlap_minutes,
        "points": round(clash.regret_share * (index or 0.0), 1),
    }


def _after_rule_change(
    festival: Festival,
    matrix: Any,
    config: ScoringConfig,
    fix: dict[str, Any],
    rule: tuple[str, str],
    day: int,
) -> dict[str, Any]:
    """What one rule change leaves on the day, taken as ``POST /whatif`` takes a kept rule step: the minutes
    the pair shares after it and the day's costliest clash. Both None for a change the plan would refuse (a
    change the search listed is legal by construction; the decision never fails over it)."""
    step = PlanGroup(
        tuple(PlanMove(m["act_id"], m["stage_id"], m["day"], _clock(m["start"])) for m in fix["moves"]),
        rule,
    )
    try:
        plan = apply_plan(festival, matrix, _every_clash(config), [step])
    except IllegalStep:
        return {"minutes_shared_after": None, "costliest_after": None}
    slots = {slot.act_id: slot for slot in plan.festival.timetable}
    return {
        "minutes_shared_after": shared_minutes(slots[rule[0]], slots[rule[1]]),
        "costliest_after": _costliest(plan.report, day),
    }


def compute_decision(preset: Preset, day: int) -> dict[str, Any]:
    """The decision for one day of a preset (see the module docstring)."""
    state = published_state(preset)
    festival, matrix, config = state["festival"], state["matrix"], state["config"]
    slots = {slot.act_id: slot for slot in festival.timetable}
    names = {act.id: act.name for act in festival.acts}
    layout = Layout.from_festival(festival)
    report_now = score_festival(festival, matrix, config)
    published = report_now.metrics.clash_budget_index
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
            "stage_fit_flags_now": len(report_now.stage_fit),
            "stage_fit_flags_after": len(plan.report.stage_fit),
            "costliest_after": _costliest(plan.report, day),
        }
        rule = in_order(rule_search(preset, a_id, b_id), a_id, HERO_LIMIT)
        if rule["fixes"]:  # the first change of the rule answer also says what it leaves behind
            first_fix = rule["fixes"][0] | _after_rule_change(
                festival, matrix, config, rule["fixes"][0], (a_id, b_id), day
            )
            rule = rule | {"fixes": [first_fix, *rule["fixes"][1:]]}
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
            "rule": rule,
        }
        return answer
    return answer | {"skipped_locked": skipped_locked, "skipped_no_place": skipped_no_place}


def decision(preset: Preset, day: int) -> dict[str, Any]:
    """The decision, from the cache when this preset object already answered it for the day; otherwise it is
    computed once, under the lock of that preset day alone, whatever the number of requests that arrive
    together. A request for another day, or for a rule search, never waits for it."""
    key = (preset.id, day)
    with _lock:
        hit = _decisions.get(key)
    if hit is not None and hit[0] is preset:
        return hit[1]
    with _lock_for(("decision", *key)):
        with _lock:
            hit = _decisions.get(key)
        if hit is not None and hit[0] is preset:
            return hit[1]
        answer = compute_decision(preset, day)
        with _lock:
            _decisions[key] = (preset, answer)  # a reloaded preset replaces its own entries
        return answer


def warm(presets: Mapping[str, Preset]) -> dict[str, float]:
    """Compute the decision of every day with sets, for each preset, so that no visitor's first request pays
    for it. Bounded by presets x days, the size of the decision cache. Called when the presets are loaded
    (the application's startup). It takes the same per-day locks as a request, so a request that arrives
    before it finishes waits only on its own day. Returns the seconds each preset took."""
    took: dict[str, float] = {}
    for preset_id, preset in presets.items():
        started = time.perf_counter()
        for day in sorted({slot.day for slot in preset.festival.timetable}):
            decision(preset, day)
        took[preset_id] = time.perf_counter() - started
    return took


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
