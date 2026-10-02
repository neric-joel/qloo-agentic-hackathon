"""Mutable working copy of a timetable that supports fast moves, feasibility checks and pair sums."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from .constraints import (
    Issue,
    Item,
    Rules,
    build_rules,
    involved_sets,
    placement_issues,
    stage_day_issues,
)
from .models import Festival

Placement = tuple[int, int, int]  # (day, stage, start)


@dataclass(frozen=True, slots=True)
class Move:
    """Relocate one set, or exchange two, to the given places."""

    sets: tuple[int, ...]
    to: tuple[Placement, ...]


class Layout:
    """Where every set currently sits, plus the indexes needed to evaluate changes quickly.

    Constraint violations that already exist in the starting timetable are tolerated, and the sets they
    involve are frozen: a move is feasible when it creates no violation the start did not have.

    ``by_day`` and ``by_slot`` list sets by start time, ties by set index, so they depend only on where
    the sets are and not on the moves that put them there.
    """

    __slots__ = ("rules", "day", "stage", "start", "by_day", "by_slot", "tolerated", "frozen")

    def __init__(
        self,
        rules: Rules,
        day: list[int],
        stage: list[int],
        start: list[int],
        tolerated: frozenset[Issue] | None = None,
        frozen: tuple[bool, ...] | None = None,
    ) -> None:
        self.rules = rules
        self.day = day
        self.stage = stage
        self.start = start
        self.by_day: list[list[int]] = [[] for _ in range(rules.n_days)]
        self.by_slot: dict[tuple[int, int], list[int]] = {
            (d, s): [] for d in range(rules.n_days) for s in range(rules.n_stages)
        }
        for i in range(rules.n_sets):
            self.by_day[day[i]].append(i)
            self.by_slot[(day[i], stage[i])].append(i)
        for members in [*self.by_day, *self.by_slot.values()]:
            members.sort(key=self._order)
        if tolerated is None:
            tolerated = frozenset(self.issues())
            tied_up = involved_sets(list(tolerated))
            frozen = tuple(rules.locked[i] or i in tied_up for i in range(rules.n_sets))
        self.tolerated = tolerated
        self.frozen = frozen or tuple(rules.locked)

    @classmethod
    def from_festival(cls, festival: Festival) -> Layout:
        rules = build_rules(festival)
        stage_index = {stage_id: s for s, stage_id in enumerate(rules.stage_ids)}
        slots = festival.timetable
        return cls(
            rules,
            [slot.day for slot in slots],
            [stage_index[slot.stage_id] for slot in slots],
            [slot.start for slot in slots],
        )

    def copy(self) -> Layout:
        return Layout(
            self.rules, list(self.day), list(self.stage), list(self.start), self.tolerated, self.frozen
        )

    def _order(self, i: int) -> tuple[int, int]:
        """Sort key of the indexes: start time, then set index."""
        return self.start[i], i

    def end(self, i: int) -> int:
        return self.start[i] + self.rules.dur[i]

    def placement(self, i: int) -> Placement:
        return self.day[i], self.stage[i], self.start[i]

    def snapshot(self) -> tuple[Placement, ...]:
        return tuple(zip(self.day, self.stage, self.start, strict=True))

    def with_placements(self, placements: Sequence[Placement]) -> Layout:
        """A new layout with every set at the given place (same rules, same tolerated issues)."""
        return Layout(
            self.rules,
            [p[0] for p in placements],
            [p[1] for p in placements],
            [p[2] for p in placements],
            self.tolerated,
            self.frozen,
        )

    def apply(self, move: Move) -> None:
        moving = set(move.sets)
        touched = {(self.day[i], self.stage[i]) for i in moving}
        days = {day for day, _ in touched}
        for i, (day, stage, start) in zip(move.sets, move.to, strict=True):
            if day != self.day[i]:
                self.by_day[self.day[i]].remove(i)
                self.by_day[day].append(i)
            self.day[i], self.stage[i], self.start[i] = day, stage, start
            touched.add((day, stage))
            days.add(day)
        for key in touched:
            members = [k for k in self.by_slot[key] if k not in moving]
            members += [i for i in move.sets if (self.day[i], self.stage[i]) == key]
            members.sort(key=self._order)
            self.by_slot[key] = members
        for day in days:
            self.by_day[day].sort(key=self._order)

    def issues(self) -> list[Issue]:
        """Every constraint violation in the current timetable."""
        rules = self.rules
        found: list[Issue] = []
        for i in range(rules.n_sets):
            found += placement_issues(rules, i, self.day[i], self.stage[i], self.start[i])
        for (_, stage), members in self.by_slot.items():
            items = [(self.start[k], self.end(k), k) for k in members]
            found += stage_day_issues(rules, stage, items)
        for i, partners in enumerate(rules.no_clash):
            found += [("no_clash", i, p) for p in partners if p > i and self.shared_minutes(i, p) > 0]
        return found

    def shared_minutes(self, i: int, k: int) -> int:
        if self.day[i] != self.day[k]:
            return 0
        return max(0, min(self.end(i), self.end(k)) - max(self.start[i], self.start[k]))

    def issues_after(self, move: Move) -> set[Issue]:
        """Violations that would exist if ``move`` were applied, without applying it."""
        rules = self.rules
        moved = dict(zip(move.sets, move.to, strict=True))
        found: set[Issue] = set()
        touched: set[tuple[int, int]] = set()
        for i, (day, stage, start) in moved.items():
            touched.add((self.day[i], self.stage[i]))
            touched.add((day, stage))
            found.update(placement_issues(rules, i, day, stage, start))
        for day, stage in touched:
            items: list[Item] = [
                (self.start[k], self.end(k), k) for k in self.by_slot[(day, stage)] if k not in moved
            ]
            items += [(t, t + rules.dur[i], i) for i, (d, s, t) in moved.items() if (d, s) == (day, stage)]
            items.sort()
            found.update(stage_day_issues(rules, stage, items))
        found.update(self._rider_clashes_after(moved))
        return found

    def _rider_clashes_after(self, moved: dict[int, Placement]) -> set[Issue]:
        rules = self.rules
        found: set[Issue] = set()
        for i, (day, _, start) in moved.items():
            end = start + rules.dur[i]
            for p in rules.no_clash[i]:
                p_day, _, p_start = moved.get(p) or self.placement(p)
                if p_day == day and start < p_start + rules.dur[p] and p_start < end:
                    found.add(("no_clash", min(i, p), max(i, p)))
        return found

    def is_feasible(self, move: Move) -> bool:
        rules = self.rules
        for i, (day, stage, _) in zip(move.sets, move.to, strict=True):
            if self.frozen[i] or (rules.stage_locked[i] and stage != self.stage[i]):
                return False
            if not rules.allow_day_moves and day != rules.home_day[i]:
                return False
        return self.issues_after(move) <= self.tolerated

    def pair_sums(self, matrices: Sequence[Sequence[Sequence[float]]]) -> list[float]:
        """Sum of ``matrix[i][k] * concurrency(i, k)`` over concurrent pairs, for each matrix."""
        sums = [0.0] * len(matrices)
        for i, k, shared in self.concurrent_pairs():
            c = shared / min(self.rules.dur[i], self.rules.dur[k])
            for m, matrix in enumerate(matrices):
                sums[m] += matrix[i][k] * c
        return sums

    def concurrent_pairs(self) -> list[tuple[int, int, int]]:
        """Pairs of sets that overlap in time, as ``(i, k, shared minutes)`` with ``i`` starting first.

        On a tied start, ``i`` is the set with the lower index.
        """
        start, dur = self.start, self.rules.dur
        pairs: list[tuple[int, int, int]] = []
        for order in self.by_day:
            for position, i in enumerate(order):
                end_i = start[i] + dur[i]
                for k in order[position + 1 :]:
                    if start[k] >= end_i:
                        break
                    pairs.append((i, k, min(end_i, start[k] + dur[k]) - start[k]))
        return pairs
