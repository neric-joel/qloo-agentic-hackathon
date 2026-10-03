"""Candidate moves (swaps and gap moves) and their incremental evaluation.

A *swap* exchanges two sets' slots. Each set takes over the slot's start (or end) time, shifted just enough
to stay inside the free window around that slot, so sets of different lengths can trade places whenever the
room exists. A *gap move* relocates one set into free time on any stage it may use.

Every candidate keeps each set on a stage it may play on and starting inside its own start window
(``not_before`` to ``not_after``); the other constraints are left to :meth:`Layout.is_feasible`.
"""

from __future__ import annotations

import random
from collections.abc import Iterator, Sequence

from .constraints import Rules
from .layout import Layout, Move, Placement

Window = tuple[int, int]  # (earliest start, latest end)


def slot_window(layout: Layout, i: int) -> Window:
    """Free time around set ``i`` on its stage, with its neighbours held fixed."""
    rules = layout.rules
    day, stage = layout.day[i], layout.stage[i]
    members = layout.by_slot[(day, stage)]
    position = members.index(i)
    earliest = (
        rules.open[day][stage] if position == 0 else layout.end(members[position - 1]) + rules.changeover
    )
    latest = (
        rules.latest_end(day, stage)
        if position == len(members) - 1
        else layout.start[members[position + 1]] - rules.changeover
    )
    return earliest, latest


def free_windows(layout: Layout, i: int, day: int, stage: int) -> list[Window]:
    """Free windows on a stage-day, ignoring set ``i``, that are long enough to hold it.

    Windows are trimmed to the set's own start window: none starts before ``not_before`` and none ends
    later than a set starting at ``not_after`` would.
    """
    rules = layout.rules
    need = rules.dur[i]
    earliest = max(rules.open[day][stage], rules.not_before[i])
    cap = rules.not_after[i] + need
    found: list[Window] = []
    for k in layout.by_slot[(day, stage)]:
        if k == i:
            continue
        latest = min(layout.start[k] - rules.changeover, cap)
        if latest - earliest >= need:
            found.append((earliest, latest))
        earliest = max(earliest, layout.end(k) + rules.changeover)
    latest = min(rules.latest_end(day, stage), cap)
    if latest - earliest >= need:
        found.append((earliest, latest))
    return found


def _allowed_places(layout: Layout, i: int) -> Iterator[tuple[int, int]]:
    rules = layout.rules
    days = range(rules.n_days) if rules.allow_day_moves else (rules.home_day[i],)
    stages = (layout.stage[i],) if rules.stage_locked[i] else sorted(rules.allowed_stages[i])
    for day in days:
        for stage in stages:
            yield day, stage


def _may_start(rules: Rules, i: int, start: int) -> bool:
    return rules.not_before[i] <= start <= rules.not_after[i]


def _starts_within(first: int, last: int, snaps: Sequence[int]) -> list[int]:
    starts = {first, last}
    starts.update(s for s in snaps if first <= s <= last)
    return sorted(starts)


def gap_moves(layout: Layout, i: int, rewarded: Sequence[int] = ()) -> Iterator[Move]:
    """Moves of set ``i`` into free time: flush to either end of each window that can hold it.

    ``rewarded`` lists the sets whose concurrency with ``i`` is worth seeking; starts that line ``i`` up
    with their start or end are tried as well.
    """
    rules = layout.rules
    here = layout.placement(i)
    for day, stage in _allowed_places(layout, i):
        snaps = [
            s
            for k in rewarded
            if layout.day[k] == day
            for s in (layout.start[k], layout.end(k) - rules.dur[i])
        ]
        for earliest, latest in free_windows(layout, i, day, stage):
            for start in _starts_within(earliest, latest - rules.dur[i], snaps):
                if (day, stage, start) != here:
                    yield Move((i,), ((day, stage, start),))


def _fit(layout: Layout, i: int, window: Window, preferred_start: int) -> int | None:
    """Start closest to ``preferred_start`` that keeps set ``i`` inside ``window`` and its start window."""
    rules = layout.rules
    first = max(window[0], rules.not_before[i])
    last = min(window[1] - rules.dur[i], rules.not_after[i])
    if last < first:
        return None
    return min(max(preferred_start, first), last)


def swap_moves(layout: Layout, i: int, j: int, window_i: Window, window_j: Window) -> tuple[Move, ...]:
    """Exchange the slots of sets ``i`` and ``j`` (start-aligned and end-aligned variants)."""
    rules = layout.rules
    day, stage = layout.day, layout.stage
    if rules.stage_locked[i] and stage[j] != stage[i]:
        return ()
    if rules.stage_locked[j] and stage[i] != stage[j]:
        return ()
    if stage[j] not in rules.allowed_stages[i] or stage[i] not in rules.allowed_stages[j]:
        return ()
    if not rules.allow_day_moves and day[i] != day[j]:
        return ()
    if day[i] == day[j] and stage[i] == stage[j]:
        return _reorder(layout, i, j)
    found: list[Move] = []
    seen: set[tuple[int, int]] = set()
    for align_end in (False, True):
        into_j = _fit(layout, i, window_j, _aligned(layout, i, j, align_end))
        into_i = _fit(layout, j, window_i, _aligned(layout, j, i, align_end))
        if into_j is None or into_i is None or (into_j, into_i) in seen:
            continue
        seen.add((into_j, into_i))
        found.append(Move((i, j), ((day[j], stage[j], into_j), (day[i], stage[i], into_i))))
    return tuple(found)


def _aligned(layout: Layout, mover: int, target: int, align_end: bool) -> int:
    """Preferred start for ``mover`` in the slot of ``target``: same start, or same end."""
    if align_end:
        return layout.end(target) - layout.rules.dur[mover]
    return layout.start[target]


def _reorder(layout: Layout, i: int, j: int) -> tuple[Move, ...]:
    """Swap two sets on one stage: the later one opens the block, the earlier one closes it.

    Nothing is offered when either set would leave its start window.
    """
    rules = layout.rules
    first, second = sorted((i, j), key=layout.start.__getitem__)
    day, stage = layout.day[first], layout.stage[first]
    new_second_start = layout.start[first]
    new_first_start = layout.end(second) - rules.dur[first]
    if not (_may_start(rules, second, new_second_start) and _may_start(rules, first, new_first_start)):
        return ()
    return (Move((second, first), ((day, stage, new_second_start), (day, stage, new_first_start))),)


def candidate_moves(
    layout: Layout, movable: Sequence[bool], rewarded: Sequence[Sequence[int]] | None = None
) -> Iterator[Move]:
    """Every swap and gap move of the sets flagged ``movable`` (not yet checked for feasibility)."""
    rules = layout.rules
    ids = [i for i, ok in enumerate(movable) if ok]
    windows = {i: slot_window(layout, i) for i in ids}
    if rules.allow_day_moves:
        groups = [ids]
    else:
        groups = [[i for i in ids if layout.day[i] == day] for day in range(rules.n_days)]
    for group in groups:
        for position, i in enumerate(group):
            yield from gap_moves(layout, i, rewarded[i] if rewarded else ())
            for j in group[position + 1 :]:
                yield from swap_moves(layout, i, j, windows[i], windows[j])


SWAP_SHARE = 0.6


def random_move(layout: Layout, movable_ids: Sequence[int], rng: random.Random) -> Move | None:
    """One random candidate move (not yet checked for feasibility), or ``None`` if the draw has none."""
    i = rng.choice(movable_ids)
    options: list[Move]
    if len(movable_ids) > 1 and rng.random() < SWAP_SHARE:
        j = rng.choice(movable_ids)
        if j == i:
            return None
        options = list(swap_moves(layout, i, j, slot_window(layout, i), slot_window(layout, j)))
    else:
        options = list(gap_moves(layout, i))
    return rng.choice(options) if options else None


class Objective:
    """``J = sum(weight[i][k] * concurrency(i, k))`` over set pairs, with incremental move evaluation.

    ``cost[i]`` is the part of J that involves set ``i``. Weights may be negative (a reward for
    concurrency). Call :meth:`refresh` after the layout changes.
    """

    def __init__(self, layout: Layout, weights: Sequence[Sequence[float]]) -> None:
        self.layout = layout
        self.weights = weights
        n = layout.rules.n_sets
        self.cost = [0.0] * n
        self.rewarded = [tuple(k for k in range(n) if weights[i][k] < 0) for i in range(n)]
        self.refresh()

    def refresh(self) -> None:
        layout = self.layout
        for i in range(layout.rules.n_sets):
            self.cost[i] = self._interval_cost(i, layout.day[i], layout.start[i], layout.end(i), -1)

    def total(self) -> float:
        return sum(self.cost) / 2

    def delta(self, move: Move) -> float:
        """Change in J if ``move`` were applied."""
        dur = self.layout.rules.dur
        if len(move.sets) == 1:
            (i,) = move.sets
            ((day, _, start),) = move.to
            return self._interval_cost(i, day, start, start + dur[i], -1) - self.cost[i]
        i, j = move.sets
        (day_i, _, start_i), (day_j, _, start_j) = move.to
        new_i = self._interval_cost(i, day_i, start_i, start_i + dur[i], j)
        new_j = self._interval_cost(j, day_j, start_j, start_j + dur[j], i)
        together_after = 0.0
        if day_i == day_j:
            shared = min(start_i + dur[i], start_j + dur[j]) - max(start_i, start_j)
            together_after = max(0, shared) / min(dur[i], dur[j])
        together_before = self.layout.shared_minutes(i, j) / min(dur[i], dur[j])
        pair = self.weights[i][j]
        return new_i + new_j + pair * together_after - (self.cost[i] + self.cost[j] - pair * together_before)

    def _interval_cost(self, i: int, day: int, begin: int, finish: int, skip: int) -> float:
        """Part of J contributed by set ``i`` if it occupied ``[begin, finish)`` on ``day``."""
        layout = self.layout
        start, dur = layout.start, layout.rules.dur
        row = self.weights[i]
        size = finish - begin
        total = 0.0
        for k in layout.by_day[day]:
            k_start = start[k]
            if k_start >= finish:
                break
            if k == i or k == skip:
                continue
            k_end = k_start + dur[k]
            if k_end <= begin:
                continue
            weight = row[k]
            if weight == 0.0:
                continue
            shared = (finish if finish < k_end else k_end) - (begin if begin > k_start else k_start)
            total += weight * shared / (size if size < dur[k] else dur[k])
        return total


def displaced_count(layout: Layout, origin: Sequence[Placement]) -> int:
    return sum(1 for i, here in enumerate(layout.snapshot()) if here != origin[i])
