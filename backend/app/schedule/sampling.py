"""Random valid timetables for the same lineup, used as the Clash Budget Index baseline.

The sampler is a random walk over valid arrangements: it starts from the supplied timetable and repeatedly
applies a random swap or gap move that passes every hard constraint (locks, start windows, allowed stages,
changeover, curfew, riders, billing rules). After a burn-in long enough to forget the starting arrangement
it records one sample every few accepted moves, so every sample is a timetable the festival could legally
have published.
"""

from __future__ import annotations

import random
from collections.abc import Sequence
from dataclasses import dataclass

from .layout import Layout
from .moves import random_move

BURN_IN_PER_SET = 3
THINNING_PER_SET = 0.65
MIN_THINNING = 4
MAX_ATTEMPTS_PER_MOVE = 40


@dataclass(frozen=True, slots=True)
class Samples:
    sums: list[tuple[float, ...]]
    degenerate: bool = False


def _walk(layout: Layout, movable: Sequence[int], rng: random.Random, accepted_target: int) -> int:
    accepted = attempts = 0
    limit = accepted_target * MAX_ATTEMPTS_PER_MOVE
    while accepted < accepted_target and attempts < limit:
        attempts += 1
        move = random_move(layout, movable, rng)
        if move is not None and layout.is_feasible(move):
            layout.apply(move)
            accepted += 1
    return accepted


def sample_pair_sums(
    layout: Layout, matrices: Sequence[Sequence[Sequence[float]]], count: int, seed: int
) -> Samples:
    """Pair-weighted concurrency sums (one value per matrix) of ``count`` random valid timetables.

    The input layout is left untouched. If no set can move, every sample equals the input and the result
    is flagged ``degenerate``.
    """
    movable = [i for i in range(layout.rules.n_sets) if not layout.frozen[i]]
    work = layout.copy()
    rng = random.Random(seed)
    if not movable or _walk(work, movable, rng, BURN_IN_PER_SET * len(movable)) == 0:
        return Samples([tuple(layout.pair_sums(matrices))] * count, degenerate=True)
    thinning = max(MIN_THINNING, round(THINNING_PER_SET * len(movable)))
    sums = []
    for _ in range(count):
        _walk(work, movable, rng, thinning)
        sums.append(tuple(work.pair_sums(matrices)))
    return Samples(sums)
