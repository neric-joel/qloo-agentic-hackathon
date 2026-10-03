"""Local-search re-slotting of the movable sets under every hard constraint.

The objective minimized is

    J = weight * regret / baseline regret  -  (1 - weight) * split quality / split normaliser

so ``weight = 1`` is pure clash cost and ``weight = 0`` rewards clashes between popular acts with unlike
audiences.
Both terms are pair-weighted concurrency sums, so one weight matrix drives the search and each candidate
move is priced from the few sets it overlaps instead of re-scoring the whole timetable.

Searches (all deterministic for a given seed) record every arrangement they pass through, and three
options are picked from that shared pool:

* least regret  - lowest regret reached, any number of moves
* balanced      - lowest J within the move budget
* fewest moves  - best improvement of J per re-slotted set, at most three sets

A "move" is one set leaving its slot, so a swap counts as two. Sets with no overlap signal are never
moved: their clashes cannot be priced, and pretending they are free would hide real ones.
"""

from __future__ import annotations

import random
import time
from collections.abc import Sequence
from dataclasses import dataclass

from .explain import describe_moves
from .layout import Layout, Move, Placement
from .metrics import (
    EPSILON,
    Scorer,
    build_scorer,
    estimate_baseline,
    measure,
    movability,
    split_normaliser,
)
from .models import BaselineStats, Festival, OverlapMatrix, ScheduleInputError, ScoringConfig, SetSlot
from .moves import Objective, candidate_moves, random_move
from .reports import Movability, OptimizeReport, OptionKind, OptionReport, ScheduleMetrics

FEWEST_MOVES_CAP = 3
BEAM_WIDTH = 12
KICK_ROUNDS = 10
KICK_MOVES = 2
REFERENCE_SETS = 40
MAX_STEPS = 400
TITLES: dict[OptionKind, str] = {
    "least_regret": "Least regret",
    "balanced": "Balanced",
    "fewest_moves": "Fewest moves",
}

Candidate = tuple[float, int, Move]  # (gain, newly displaced sets, move)


@dataclass(frozen=True, slots=True)
class Visited:
    """One arrangement reached during search."""

    placements: tuple[Placement, ...]
    displaced: int
    regret: float
    split: float


class Pricing:
    """The objective at a given weight: turns regret and split quality into one number to minimize."""

    def __init__(self, scorer: Scorer, baseline: BaselineStats, weight: float) -> None:
        self.scorer = scorer
        self.weight = weight
        self.regret_scale = baseline.mean_regret
        self.split_scale = split_normaliser(scorer, baseline) if weight < 1.0 else None

    def value(self, regret: float, split: float) -> float:
        total = self.weight * regret / self.regret_scale
        if self.split_scale is not None:
            total -= (1.0 - self.weight) * split / self.split_scale
        return total

    def matrix(self) -> list[list[float]]:
        """Pair weights whose weighted concurrency sum is :meth:`value`."""
        regret_factor = self.weight / self.regret_scale
        split_factor = (1.0 - self.weight) / self.split_scale if self.split_scale is not None else 0.0
        return [
            [regret_factor * r - split_factor * s for r, s in zip(regret_row, split_row, strict=True)]
            for regret_row, split_row in zip(self.scorer.regret_w, self.scorer.split_w, strict=True)
        ]


class Search:
    """Greedy climbs, beam search and seeded kicks over swaps and gap moves."""

    def __init__(self, layout: Layout, scorer: Scorer) -> None:
        self.start = layout
        self.scorer = scorer
        self.origin = layout.snapshot()
        self.movable = [not layout.frozen[i] and scorer.scored[i] for i in range(layout.rules.n_sets)]
        self.visited: dict[tuple[Placement, ...], Visited] = {}
        self.record(layout)

    def record(self, layout: Layout) -> Visited:
        key = layout.snapshot()
        if key not in self.visited:
            regret, split = layout.pair_sums([self.scorer.regret_w, self.scorer.split_w])
            self.visited[key] = Visited(key, self.displaced(layout), regret, split)
        return self.visited[key]

    def displaced(self, layout: Layout) -> int:
        return sum(1 for here, there in zip(layout.snapshot(), self.origin, strict=True) if here != there)

    def sets_with_feasible_moves(self) -> int:
        free: set[int] = set()
        for move in candidate_moves(self.start, self.movable):
            if not all(i in free for i in move.sets) and self.start.is_feasible(move):
                free.update(move.sets)
        return len(free)

    def _improving(self, layout: Layout, objective: Objective, cap: int) -> list[Candidate]:
        """Improving moves that keep at most ``cap`` sets displaced."""
        displaced = self.displaced(layout)
        found = []
        for move in candidate_moves(layout, self.movable, objective.rewarded):
            gain = -objective.delta(move)
            if gain <= EPSILON:
                continue
            extra = sum(
                (there != self.origin[i]) - (layout.placement(i) != self.origin[i])
                for i, there in zip(move.sets, move.to, strict=True)
            )
            if displaced + extra <= cap:
                found.append((gain, extra, move))
        return found

    def climb(self, layout: Layout, weights: list[list[float]], cap: int) -> Layout:
        """Apply the best improving feasible move until none is left; returns the final layout."""
        layout = layout.copy()
        objective = Objective(layout, weights)
        for _ in range(MAX_STEPS):
            options = sorted(self._improving(layout, objective, cap), key=lambda option: -option[0])
            move = next((move for _, _, move in options if layout.is_feasible(move)), None)
            if move is None:
                break
            layout.apply(move)
            objective.refresh()
            self.record(layout)
        return layout

    def beam(self, weights: list[list[float]], cap: int, width: int) -> None:
        """Beam search over arrangements reachable with at most ``cap`` displaced sets.

        Each level keeps ``width`` arrangements: half with the largest total gain, half with the largest
        gain per displaced set, so cheap re-slots are not crowded out by expensive swaps.
        """
        frontier = [(self.start.copy(), 0.0)]
        seen = {self.start.snapshot()}
        for _ in range(MAX_STEPS):
            children: list[tuple[float, Layout]] = []
            for layout, gained in frontier:
                options = self._improving(layout, Objective(layout, weights), cap)
                for gain, move in _best_feasible(layout, options, max(2, width // 2)):
                    child = layout.copy()
                    child.apply(move)
                    if child.snapshot() not in seen:
                        seen.add(child.snapshot())
                        children.append((gained + gain, child))
            if not children:
                return
            frontier = self._select(children, width)
            for layout, _ in frontier:
                self.record(layout)

    def _select(self, children: list[tuple[float, Layout]], width: int) -> list[tuple[Layout, float]]:
        by_gain = sorted(children, key=lambda child: -child[0])
        by_efficiency = sorted(children, key=lambda child: -child[0] / max(1, self.displaced(child[1])))
        chosen: dict[int, tuple[Layout, float]] = {}
        for ranking, quota in ((by_gain, width - width // 2), (by_efficiency, width // 2)):
            taken = 0
            for gained, layout in ranking:
                if taken == quota:
                    break
                if id(layout) not in chosen:
                    chosen[id(layout)] = (layout, gained)
                    taken += 1
        return list(chosen.values())

    def kick_and_climb(self, weights: list[list[float]], rounds: int, seed: int) -> None:
        """Iterated local search: perturb the best arrangement with random legal moves, climb back down."""
        rng = random.Random(seed)
        ids = [i for i, ok in enumerate(self.movable) if ok]
        cap = self.start.rules.n_sets
        best = self.climb(self.start, weights, cap)
        best_total = Objective(best, weights).total()
        for _ in range(rounds):
            trial = best.copy()
            if not _kick(trial, ids, rng):
                return
            trial = self.climb(trial, weights, cap)
            total = Objective(trial, weights).total()
            if total < best_total - EPSILON:
                best, best_total = trial, total


def _best_feasible(layout: Layout, options: list[Candidate], width: int) -> list[tuple[float, Move]]:
    """The most promising feasible moves: ``width`` by gain, then ``width // 2`` by gain per displaced set."""
    picked: dict[int, tuple[float, Move]] = {}
    rankings = (
        (sorted(options, key=lambda option: -option[0]), width),
        (sorted(options, key=lambda option: -option[0] / max(1, option[1])), width // 2),
    )
    for ranking, quota in rankings:
        taken = 0
        for gain, _, move in ranking:
            if taken == quota:
                break
            if layout.is_feasible(move):
                taken += 1
                picked.setdefault(id(move), (gain, move))
    return list(picked.values())


def _kick(layout: Layout, ids: Sequence[int], rng: random.Random) -> bool:
    applied = 0
    for _ in range(40 * KICK_MOVES):
        move = random_move(layout, ids, rng)
        if move is not None and layout.is_feasible(move):
            layout.apply(move)
            applied += 1
            if applied == KICK_MOVES:
                break
    return applied > 0


def optimize(
    festival: Festival,
    matrix: OverlapMatrix,
    weight: float = 1.0,
    move_budget: int = 6,
    config: ScoringConfig | None = None,
    *,
    thaw: bool = False,
) -> OptimizeReport:
    """Propose re-slotted timetables: least regret, balanced within a move budget, and fewest moves.

    ``thaw`` (the agent's session only) lets the sets tied up in a rule the timetable already breaks move, but
    only to places that end their part in the break (see ``Layout``); the default freezes them, as before.
    """
    started = time.perf_counter()
    if not 0.0 <= weight <= 1.0:
        raise ScheduleInputError("weight must be between 0 and 1")
    if move_budget < 1:
        raise ScheduleInputError("move_budget must be at least 1")
    config = config or ScoringConfig()
    layout = Layout.from_festival(festival, thaw=thaw)
    scorer = build_scorer(festival, matrix, config, layout)
    # The baseline belongs to the published day, so it is sampled on the default layout: thawing sets for the
    # search must not change what "random valid timetables of this lineup" means.
    sampled = Layout.from_festival(festival) if thaw else layout
    baseline = config.baseline or estimate_baseline(sampled, scorer, _with_samples(config))
    run = _Run(festival, layout, scorer, baseline, Pricing(scorer, baseline, weight), move_budget, started)
    before = measure(scorer, layout, baseline)
    mov = movability(scorer, layout)
    if baseline.mean_regret <= EPSILON:
        return run.nothing(before, mov, "No audience overlap signal to optimize.")
    search = Search(layout, scorer)
    mov = mov.model_copy(update={"with_feasible_move": search.sets_with_feasible_moves()})
    if mov.with_feasible_move == 0:
        return run.nothing(before, mov, _stuck_message(mov))
    run.search(search, config.seed)
    return run.report(search, before, mov)


def _with_samples(config: ScoringConfig) -> ScoringConfig:
    """The optimizer always needs a baseline, so a request for zero samples falls back to the default."""
    if config.baseline_samples > 0:
        return config
    return config.model_copy(update={"baseline_samples": ScoringConfig().baseline_samples})


def _stuck_message(mov: Movability) -> str:
    return (
        f"No set can move: {mov.locked} locked, {mov.frozen_by_existing_violations} tied to existing "
        f"violations, {mov.unscored} without overlap signal, and no feasible swap or gap move exists "
        "for the rest."
    )


@dataclass
class _Run:
    festival: Festival
    layout: Layout
    scorer: Scorer
    baseline: BaselineStats
    pricing: Pricing
    move_budget: int
    started: float

    def elapsed_ms(self) -> int:
        return round((time.perf_counter() - self.started) * 1000)

    def search(self, search: Search, seed: int) -> None:
        """Run the searches. Effort shrinks with the square of the lineup size to keep run time steady."""
        movable = max(1, sum(search.movable))
        effort = min(1.0, (REFERENCE_SETS / movable) ** 2)
        regret_only = Pricing(self.scorer, self.baseline, 1.0).matrix()
        search.kick_and_climb(regret_only, max(2, round(KICK_ROUNDS * effort)), seed)
        search.beam(self.pricing.matrix(), self.move_budget, max(4, round(BEAM_WIDTH * effort)))

    def nothing(self, before: ScheduleMetrics, mov: Movability, message: str) -> OptimizeReport:
        return OptimizeReport(
            festival_id=self.festival.id,
            status="no_improvement",
            message=message,
            weight=self.pricing.weight,
            move_budget=self.move_budget,
            baseline=self.baseline,
            before=before,
            options=[],
            movability=mov,
            elapsed_ms=self.elapsed_ms(),
        )

    def report(self, search: Search, before: ScheduleMetrics, mov: Movability) -> OptimizeReport:
        start = search.visited[self.layout.snapshot()]
        picks = _pick_options(list(search.visited.values()), start, self.pricing, self.move_budget)
        options: list[OptionReport] = []
        first_seen: dict[tuple[Placement, ...], OptionKind] = {}
        for kind, state in picks.items():
            same_as = first_seen.get(state.placements) if state else None
            if state is not None:
                first_seen.setdefault(state.placements, kind)
            options.append(self.option(kind, state, same_as, before))
        improved = any(option.improved for option in options)
        before_value = self.pricing.value(start.regret, start.split)
        return OptimizeReport(
            festival_id=self.festival.id,
            status="improved" if improved else "no_improvement",
            message=_summary(options, mov) if improved else _no_gain_message(mov),
            weight=self.pricing.weight,
            move_budget=self.move_budget,
            baseline=self.baseline,
            before=before.model_copy(update={"objective": round(before_value, 6)}),
            options=options if improved else [],
            movability=mov,
            elapsed_ms=self.elapsed_ms(),
        )

    def option(
        self, kind: OptionKind, state: Visited | None, same_as: OptionKind | None, before: ScheduleMetrics
    ) -> OptionReport:
        if state is None:
            return OptionReport(
                kind=kind,
                title=TITLES[kind],
                improved=False,
                note=_no_option_note(kind, self.move_budget),
                same_as=None,
                move_count=0,
                moves=[],
                metrics=before,
                regret_change=0.0,
                regret_change_pct=0.0,
                timetable=list(self.festival.timetable),
            )
        after = self.layout.with_placements(state.placements)
        metrics = measure(self.scorer, after, self.baseline).model_copy(
            update={"objective": round(self.pricing.value(state.regret, state.split), 6)}
        )
        moves = describe_moves(self.festival, self.layout, after, self.scorer)
        change = metrics.regret - before.regret
        change_pct = round(100 * change / before.regret, 2) if before.regret > EPSILON else None
        return OptionReport(
            kind=kind,
            title=TITLES[kind],
            improved=True,
            note=_note(kind, same_as, self.pricing, change_pct),
            same_as=same_as,
            move_count=len(moves),
            moves=moves,
            metrics=metrics,
            regret_change=round(change, 6),
            regret_change_pct=change_pct,
            timetable=_timetable(self.festival, after),
        )


def _pick_options(
    states: list[Visited], start: Visited, pricing: Pricing, move_budget: int
) -> dict[OptionKind, Visited | None]:
    """Choose each option from the shared pool; an option is only offered if it beats the input."""
    base = pricing.value(start.regret, start.split)
    better = [s for s in states if pricing.value(s.regret, s.split) < base - EPSILON]
    return {
        "least_regret": min(
            (s for s in states if s.regret < start.regret - EPSILON),
            key=lambda s: (s.regret, s.displaced),
            default=None,
        ),
        "balanced": min(
            (s for s in better if s.displaced <= move_budget),
            key=lambda s: (pricing.value(s.regret, s.split), s.displaced),
            default=None,
        ),
        "fewest_moves": max(
            (s for s in better if 1 <= s.displaced <= FEWEST_MOVES_CAP),
            key=lambda s: ((base - pricing.value(s.regret, s.split)) / s.displaced, -s.displaced),
            default=None,
        ),
    }


def _summary(options: Sequence[OptionReport], mov: Movability) -> str:
    improving = [option for option in options if option.improved]
    best = min(improving, key=lambda option: option.metrics.regret)
    cut = -(best.regret_change_pct or 0.0)
    text = f"{len(improving)} of {len(options)} options lower this day's Clash Budget, by the same measure"
    if cut > 0:
        text += f"; the largest clash-cost drop is {cut:.0f}% with {best.move_count} sets re-slotted"
    return f"{text} ({mov.movable} of {mov.total_sets} sets are movable)."


def _no_gain_message(mov: Movability) -> str:
    return (
        "No re-slot lowers this day's Clash Budget under its locks and constraints "
        f"({mov.movable} of {mov.total_sets} sets are movable)."
    )


def _no_option_note(kind: OptionKind, move_budget: int) -> str:
    return {
        "least_regret": "No arrangement has lower regret than the current one.",
        "balanced": f"No improvement fits within {move_budget} re-slotted sets.",
        "fewest_moves": f"No improvement fits within {FEWEST_MOVES_CAP} re-slotted sets.",
    }[kind]


def _note(
    kind: OptionKind, same_as: OptionKind | None, pricing: Pricing, change_pct: float | None
) -> str | None:
    if same_as is not None:
        return f"Same arrangement as the {TITLES[same_as].lower()} option."
    if kind != "least_regret" and change_pct is not None and change_pct > 0:
        return (
            f"Clash cost rises {change_pct:.1f}% in exchange for more big acts with unlike audiences "
            f"clashing (weight {pricing.weight:.2f})."
        )
    return None


def _timetable(festival: Festival, after: Layout) -> list[SetSlot]:
    rules = after.rules
    return [
        slot.model_copy(
            update={
                "day": after.day[i],
                "stage_id": rules.stage_ids[after.stage[i]],
                "start": after.start[i],
                "end": after.end(i),
            }
        )
        for i, slot in enumerate(festival.timetable)
    ]
