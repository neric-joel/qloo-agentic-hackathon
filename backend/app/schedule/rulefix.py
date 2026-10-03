"""The smallest change this search found that ends an overlap between two sets.

``rule_fixes`` takes a published timetable and two sets and looks for changes after which the pair shares no
minute. It covers three kinds of change: one of the two sets placed anywhere on the 5-minute grid that it may
use (``grid_moves``); one of the two swapped with one other set at start- or end-aligned places
(``swap_moves``); and the wider two-set changes of ``_wide_swaps``, where one of the two sets takes any
start on the 5-minute grid in the free window around one other set's slot and that set goes to any start on
the 5-minute grid in the window around the vacated slot, or in a free window of its own stage. The wider
kind is bounded (``WIDE_CHECKS`` candidates for one pair; the answer's ``searched`` says when the bound
cut it off). It does not look for longer chains of moves.

A change is listed only when all of the following hold:

* the layout's own feasibility check passes on a copy of the day that holds the pair as a rule it must not
  break (``constraints.no_clash_with``), with the sets the day already ties up thawed;
* the two sets share 0 minutes after it;
* ``Layout.issues()`` of the moved timetable, both moved sets of a swap included, is a subset of the
  published day's issues: the change adds no rule break the day did not already have. This is not a claim
  that the day passes every rule: a break the published day already has is tolerated, as everywhere in the
  engine.

The Clash Budget Index of a changed timetable is read from the same scorer ``score_festival`` uses (the
published day's baseline, no resampling), so a one-set change gives the number ``apply_plan`` gives. It is
information and never ranks the list.
"""

from __future__ import annotations

from collections.abc import Iterator
from itertools import chain
from typing import Any

from .constraints import Issue
from .layout import Layout, Move, Placement
from .metrics import EPSILON, Scorer, build_scorer, stage_fit_flags
from .models import Festival, OverlapMatrix, ScoringConfig, SetSlot, format_minutes
from .moves import Window, free_windows, grid_moves, slot_window, swap_moves

GRID_MINUTES = 5  # the 5-minute grid ``compute_move_options`` uses (a test pins the two together)
KEPT_FIXES = 5  # the most a caller can ask for; the rest are counted, not kept
WIDE_CHECKS = (
    4000  # the wider two-set changes tried for one pair at most (the local days need 2,700 or fewer)
)
SEARCHED = (
    "single places on the 5-minute grid for either set, and two-set changes where one other set makes room "
    "and moves to a free place; each checked for a new rule break; longer chains were not searched"
)


def _slot_text(festival: Festival, slot: SetSlot) -> str:
    stage = festival.stage_by_id()[slot.stage_id].name
    return f"{stage} {format_minutes(slot.start)}-{format_minutes(slot.end)}"


def _side(festival: Festival, slot: SetSlot) -> dict[str, Any]:
    return {
        "act_id": slot.act_id,
        "act": festival.act_by_id()[slot.act_id].name,
        "locked": slot.locked,
        "place": _slot_text(festival, slot),
    }


def published_shared(festival: Festival, a_id: str, b_id: str) -> int:
    """Minutes the two sets share on the published timetable (no search, no scoring)."""
    slots = {slot.act_id: slot for slot in festival.timetable}
    a, b = slots[a_id], slots[b_id]
    if a.day != b.day:
        return 0
    return max(0, min(a.end, b.end) - max(a.start, b.start))


def searches(festival: Festival, a_id: str, b_id: str) -> bool:
    """True when ``rule_fixes`` would run its search for the pair: the two sets share a minute and at least
    one of them is free to move. Every other answer (a pair that holds, two locked sets) is read off the
    published day and costs nothing."""
    slots = {slot.act_id: slot for slot in festival.timetable}
    both_locked = slots[a_id].locked and slots[b_id].locked
    return not both_locked and published_shared(festival, a_id, b_id) > 0


def _pair_rank(pair: tuple[int, int], i: int) -> int:
    return pair.index(i) if i in pair else len(pair)


def _index(scorer: Scorer, layout: Layout) -> float | None:
    """The Clash Budget Index of a layout, as ``score_festival`` reports it (2 decimals)."""
    baseline = scorer.config.baseline
    if baseline is None or baseline.mean_regret <= EPSILON:
        return None
    (regret,) = layout.pair_sums([scorer.regret_w])
    return round(100.0 * regret / baseline.mean_regret, 2)


def _with_rule(festival: Festival, a_id: str, b_id: str) -> Festival:
    """A copy of the day that also holds the pair as a rule it must not break."""
    held = festival.constraints.no_clash_with
    if any({a_id, b_id} == set(pair) for pair in held):
        return festival
    constraints = festival.constraints.model_copy(update={"no_clash_with": [*held, (a_id, b_id)]})
    return festival.model_copy(update={"constraints": constraints})


def _shared_after(layout: Layout, move: Move, p: int, q: int) -> int:
    """Minutes the two sets would share after the move, without applying it."""
    places = dict(zip(move.sets, move.to, strict=True))
    (day_p, _, start_p) = places.get(p) or layout.placement(p)
    (day_q, _, start_q) = places.get(q) or layout.placement(q)
    if day_p != day_q:
        return 0
    dur = layout.rules.dur
    return max(0, min(start_p + dur[p], start_q + dur[q]) - max(start_p, start_q))


def _grid_starts(layout: Layout, i: int, window: Window) -> list[int]:
    """Every start on the 5-minute grid that keeps set ``i`` inside ``window`` and its own start window,
    plus the window's flush ends."""
    rules = layout.rules
    first = max(window[0], rules.not_before[i])
    last = min(window[1] - rules.dur[i], rules.not_after[i])
    if last < first:
        return []
    on_grid = range(-(-first // GRID_MINUTES) * GRID_MINUTES, last + 1, GRID_MINUTES)
    return sorted({first, last, *on_grid})


def _clear_of(layout: Layout, i: int, place: tuple[int, int, int], k: int) -> bool:
    """True when set ``i`` at ``place`` shares no minute with set ``k`` where it stands."""
    day, _, start = place
    if day != layout.day[k]:
        return True
    return min(start + layout.rules.dur[i], layout.end(k)) <= max(start, layout.start[k])


def _wide_swaps(
    layout: Layout, mover: int, other: int, window_mover: Window, window_other: Window, partner: int
) -> Iterator[Move]:
    """Two-set changes that ``swap_moves`` (start- and end-aligned exchanges only) does not reach.

    ``mover`` takes any start on the 5-minute grid inside the free window around ``other``'s slot. ``other``
    then goes to any start on the 5-minute grid inside the window around ``mover``'s vacated slot (an
    exchange of stages), or inside a free window of its own stage. ``partner`` is the other set of the pair:
    a place for ``mover`` that still overlaps it (when ``other`` is not the partner) is dropped here, before
    the product with ``other``'s places. The caller's own checks decide every candidate that is listed.
    """
    rules = layout.rules
    day, stage = layout.day, layout.stage
    if mover == other or not rules.allow_day_moves and day[mover] != day[other]:
        return
    if stage[other] not in rules.allowed_stages[mover]:
        return
    if rules.stage_locked[mover] and stage[other] != stage[mover]:
        return
    mover_to = [(day[other], stage[other], t) for t in _grid_starts(layout, mover, window_other)]
    if other != partner:
        mover_to = [m for m in mover_to if _clear_of(layout, mover, m, partner)]
    if not mover_to:
        return
    here = layout.placement(other)
    other_to: list[tuple[int, int, int]] = []
    if (
        stage[mover] in rules.allowed_stages[other]
        and not (rules.stage_locked[other] and stage[mover] != stage[other])
        and (rules.allow_day_moves or day[mover] == day[other])
    ):
        other_to += [(day[mover], stage[mover], t) for t in _grid_starts(layout, other, window_mover)]
    for earliest, latest in free_windows(layout, other, day[other], stage[other]):
        other_to += [(day[other], stage[other], t) for t in _grid_starts(layout, other, (earliest, latest))]
    for place in dict.fromkeys(other_to):
        if place == here:
            continue
        for target in mover_to:
            yield Move((mover, other), (target, place))


def rule_fixes(
    festival: Festival, matrix: OverlapMatrix, config: ScoringConfig, a_id: str, b_id: str
) -> dict[str, Any]:
    """Every change this search found that ends the overlap of two sets, ordered, and the facts around it.

    The answer holds the two sets, the minutes they share now, ``holds`` (they share none, and no search
    ran), the number of single-set places that qualify, the number of changes found in all, what was
    searched and the first ``KEPT_FIXES`` changes in order: fewest sets moved, then start-time shift in
    minutes, then stage changes, then the Clash Budget Index after, then act ids. The caller adds the rule
    text and trims the list.
    """
    slots = {slot.act_id: slot for slot in festival.timetable}
    side_a, side_b = _side(festival, slots[a_id]), _side(festival, slots[b_id])
    shared_now = published_shared(festival, a_id, b_id)
    answer: dict[str, Any] = {
        "a": side_a,
        "b": side_b,
        "shared_minutes": shared_now,
        "holds": shared_now == 0,
        "single_set_places": 0,
        "fixes_found": 0,
        "searched": SEARCHED,
        "fixes": [],
    }
    if not searches(festival, a_id, b_id):
        return answer

    published_issues: set[Issue] = set(Layout.from_festival(festival).issues())
    layout = Layout.from_festival(_with_rule(festival, a_id, b_id), thaw=True)
    rules = layout.rules
    p, q = rules.act_ids.index(a_id), rules.act_ids.index(b_id)
    scorer = build_scorer(festival, matrix, config, layout)
    flags_now = len(stage_fit_flags(festival, scorer, layout))
    windows: dict[int, Window] = {}

    def window(i: int) -> Window:
        if i not in windows:
            windows[i] = slot_window(layout, i)
        return windows[i]

    def accepted(move: Move) -> bool:
        """True when the pair shares no minute after the move, the layout's own check allows it, and the
        timetable after it holds no issue the published day did not. The move is taken on ``layout`` itself
        and taken back, so the layout is as it was when this returns."""
        if _shared_after(layout, move, p, q) > 0 or not layout.is_feasible(move):
            return False
        back = Move(move.sets, tuple(layout.placement(i) for i in move.sets))
        layout.apply(move)
        try:
            return layout.shared_minutes(p, q) == 0 and set(layout.issues()) <= published_issues
        finally:
            layout.apply(back)

    found: list[Move] = []
    singles = 0
    seen_places: set[tuple[int, Placement]] = set()
    seen_swaps: set[tuple[tuple[int, Placement], ...]] = set()
    wide_left, stopped = WIDE_CHECKS, False
    for mover in (p, q):
        if layout.frozen[mover]:
            continue
        for move in grid_moves(layout, mover, step=GRID_MINUTES):
            key = (mover, move.to[0])
            if key in seen_places:
                continue
            seen_places.add(key)
            if accepted(move):
                singles += 1
                found.append(move)
        for other in range(rules.n_sets):
            if other == mover or layout.frozen[other] or (mover == q and other == p):
                continue
            exchanges = swap_moves(layout, mover, other, window(mover), window(other))
            wide = _wide_swaps(layout, mover, other, window(mover), window(other), q if mover == p else p)
            for move in chain(exchanges, wide):
                swap_key = tuple(sorted(zip(move.sets, move.to, strict=True)))
                if swap_key in seen_swaps:
                    continue
                seen_swaps.add(swap_key)
                if move not in exchanges:
                    if wide_left == 0:  # the bound: no more wider changes are tried; exchanges still are
                        stopped = True
                        break
                    wide_left -= 1
                if accepted(move):
                    found.append(move)

    # The order is sets, minutes, stage changes, then the index after: the index (the costly part) is read
    # only for the changes that could be among the kept ones, every tie at the cutoff included.
    cheap = sorted(((_effort(layout, move), n) for n, move in enumerate(found)), key=lambda c: c[0])
    cutoff = cheap[KEPT_FIXES - 1][0] if len(cheap) >= KEPT_FIXES else None
    fixes = []
    for effort, n in cheap:
        if cutoff is not None and effort > cutoff:
            break
        moved = layout.copy()
        moved.apply(found[n])
        fixes.append(_fix(festival, layout, scorer, flags_now, found[n], moved, (p, q)))
    fixes.sort(key=_order)
    if stopped:
        answer["searched"] = f"{SEARCHED}; the wider two-set changes were cut off after {WIDE_CHECKS} checks"
    answer["single_set_places"] = singles
    answer["fixes_found"] = len(found)
    answer["fixes"] = [fix[1] for fix in fixes[:KEPT_FIXES]]
    return answer


def _effort(layout: Layout, move: Move) -> tuple[int, int, int]:
    """The first three parts of the order: sets moved, minutes moved, stage changes."""
    minutes = sum(abs(t[2] - layout.start[i]) for i, t in zip(move.sets, move.to, strict=True))
    stages = sum(layout.stage[i] != t[1] for i, t in zip(move.sets, move.to, strict=True))
    return len(move.sets), minutes, stages


def _fix(
    festival: Festival,
    layout: Layout,
    scorer: Scorer,
    flags_now: int,
    move: Move,
    moved: Layout,
    pair: tuple[int, int],
) -> tuple[tuple[Any, ...], dict[str, Any]]:
    """One change as the answer lists it, with the key that orders it."""
    rules = layout.rules
    # The pair's own sets come first, in the order asked, then the set that swapped with one of them
    order = sorted(range(len(move.sets)), key=lambda n: _pair_rank(pair, move.sets[n]))
    moves = []
    for n in order:
        i, (day, stage, start) = move.sets[n], move.to[n]
        old_start = layout.start[i]
        end = start + rules.dur[i]
        moves.append(
            {
                "act_id": rules.act_ids[i],
                "act": rules.names[i],
                "from": _place_text(festival, rules.stage_ids[layout.stage[i]], old_start, layout.end(i)),
                "stage_id": rules.stage_ids[stage],
                "stage": festival.stage_by_id()[rules.stage_ids[stage]].name,
                "day": day,
                "start": format_minutes(start),
                "end": format_minutes(end),
                "minutes_moved": abs(start - old_start),
            }
        )
    stage_changes = sum(layout.stage[i] != stage for i, (_, stage, _) in zip(move.sets, move.to, strict=True))
    minutes = sum(m["minutes_moved"] for m in moves)
    budget = _index(scorer, moved)
    fix = {
        "sets_moved": len(moves),
        "minutes_moved": minutes,
        "stage_changes": stage_changes,
        "budget_after": budget,
        "stage_fit_flags_now": flags_now,
        "stage_fit_flags_after": len(stage_fit_flags(festival, scorer, moved)),
        "moves": moves,
    }
    ids = tuple(sorted(m["act_id"] for m in moves))
    starts = tuple(m["start"] for m in moves)
    return (len(moves), minutes, stage_changes, float("inf") if budget is None else budget, ids, starts), fix


def _place_text(festival: Festival, stage_id: str, start: int, end: int) -> str:
    return f"{festival.stage_by_id()[stage_id].name} {format_minutes(start)}-{format_minutes(end)}"


def _order(item: tuple[tuple[Any, ...], dict[str, Any]]) -> tuple[Any, ...]:
    return item[0]
