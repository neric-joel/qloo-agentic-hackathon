"""The smallest change this search found that ends an overlap between two sets.

``rule_fixes`` takes a published timetable and two sets and looks for changes after which the pair shares no
minute. It covers two kinds of change: one of the two sets placed anywhere on the 5-minute grid that it may
use (``grid_moves``), and one of the two swapped with one other set (``swap_moves``). It does not look for
longer chains of moves.

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

from typing import Any

from .constraints import Issue
from .layout import Layout, Move, Placement
from .metrics import EPSILON, Scorer, build_scorer, stage_fit_flags
from .models import Festival, OverlapMatrix, ScoringConfig, SetSlot, format_minutes
from .moves import Window, grid_moves, slot_window, swap_moves

GRID_MINUTES = 5  # the 5-minute grid ``compute_move_options`` uses (a test pins the two together)
KEPT_FIXES = 5  # the most a caller can ask for; the rest are counted, not kept
SEARCHED = (
    "single places on the 5-minute grid for either set, and swaps of either set with one other set; "
    "each checked for a new rule break; longer chains were not searched"
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
    if shared_now == 0 or (side_a["locked"] and side_b["locked"]):
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

    def moved_layout(move: Move) -> Layout | None:
        """The timetable after the move, or None when the pair still shares a minute, the layout's own
        check refuses it, or it holds any issue the published day did not."""
        if _shared_after(layout, move, p, q) > 0 or not layout.is_feasible(move):
            return None
        moved = layout.copy()
        moved.apply(move)
        if moved.shared_minutes(p, q) > 0 or not set(moved.issues()) <= published_issues:
            return None
        return moved

    found: list[tuple[Move, Layout]] = []
    singles = 0
    seen_places: set[tuple[int, Placement]] = set()
    seen_swaps: set[tuple[tuple[int, Placement], ...]] = set()
    for mover in (p, q):
        if layout.frozen[mover]:
            continue
        for move in grid_moves(layout, mover, step=GRID_MINUTES):
            key = (mover, move.to[0])
            if key in seen_places:
                continue
            seen_places.add(key)
            if (moved := moved_layout(move)) is not None:
                singles += 1
                found.append((move, moved))
        for other in range(rules.n_sets):
            if other == mover or layout.frozen[other] or (mover == q and other == p):
                continue
            for move in swap_moves(layout, mover, other, window(mover), window(other)):
                swap_key = tuple(sorted(zip(move.sets, move.to, strict=True)))
                if swap_key in seen_swaps:
                    continue
                seen_swaps.add(swap_key)
                if (moved := moved_layout(move)) is not None:
                    found.append((move, moved))

    fixes = [_fix(festival, layout, scorer, flags_now, move, moved, (p, q)) for move, moved in found]
    fixes.sort(key=_order)
    answer["single_set_places"] = singles
    answer["fixes_found"] = len(fixes)
    answer["fixes"] = [fix[1] for fix in fixes[:KEPT_FIXES]]
    return answer


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
