"""Derived views of a preset day that read the engine's own prices: what taste overlap changes in the ranking.

``GET /api/presets/{preset_id}/lenses?day=<n>`` ranks the day's priced concurrent pairs twice with the
engine's own scorer: once as the page prices them ("with taste"), and once with every priced pair given the
same taste overlap and every act the same neutral rarity ("without taste": draw times shared time only; draw
is also a Qloo field). It lists the 15 costliest pairs of each view with the pair's rank in the other view,
counts the pairs that only one view puts in its 15, gives the number of pairs ranked in each view (the rank
denominators), runs a shuffled-overlap null (``only_with_taste`` again with the day's taste overlaps dealt
out over the priced acts at random), and names up to 3 pairs whose taste overlap is in the top tenth of the
day's priced pairs but that share no minute. Ranks and counts only: no taste overlap value, no matrix cell,
no price.

Ranks run over every priced concurrent pair of the day, not over the page's list: ``score_festival`` keeps
only the festival's costliest ``top_clashes`` pairs (at most 200, across all days), which could cut a day
short, so the pairs are priced here from the scorer directly. Both views use the same timetable, so a pair
is concurrent in both. A pair is *ranked* in a view when its cost there is above zero; cost zero is how the
engine leaves a pair out of its own clash list. Ties in cost are broken by the two act ids (first-starting
act first), so the order is the same on every call.

No Qloo request and no limiter slot: the answer depends only on the preset, so it is cached per preset and day
(at most presets x days entries) and served with the presets' CDN header.
"""

from __future__ import annotations

import math
import random
import threading
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Response

from .presets import CACHE_CONTROL, Preset, Presets
from .schedule import metrics  # called as metrics.shared_minutes / metrics.build_scorer
from .schedule.layout import Layout
from .schedule.models import Festival, OverlapMatrix, ScoringConfig

router = APIRouter(prefix="/api/presets", tags=["presets"])

RANKED = 15  # pairs listed per view, as the page's own clash list
APART_SHOWN = 3
APART_QUANTILE = 0.9  # taste overlap in the top tenth of the day's priced pairs
NO_SETS = "That day has no sets."
NEUTRAL_RARITY = 0.5  # the "without taste" view gives every act this rarity: the rarity term is then constant
SHUFFLE_RUNS = 200
SHUFFLE_SEED = 20261003  # fixed: the same preset and day always give the same shuffled counts
SHUFFLE_LOW, SHUFFLE_HIGH = 10, 90  # percentiles reported, nearest rank
MAX_ID_ECHO = 80  # characters of a caller's preset id repeated in an error

PairKey = tuple[str, str]

_lenses: dict[tuple[str, int], tuple[Preset, dict[str, Any]]] = {}
_lock = threading.Lock()


def _priced(matrix: OverlapMatrix, act_id: str) -> bool:
    """Whether the scorer prices the act's clashes: it is in the matrix with a usable signal."""
    return act_id in matrix.act_ids and matrix.coverage_of(act_id) != "none"


def without_taste(matrix: OverlapMatrix) -> OverlapMatrix:
    """The same matrix with every cell set to the same taste overlap (1.0, diagonal 0); coverage unchanged,
    so the acts the page leaves unpriced stay unpriced."""
    n = len(matrix.act_ids)
    flat = [[0.0 if i == k else 1.0 for k in range(n)] for i in range(n)]
    return matrix.model_copy(update={"values": flat})


def neutral_rarity(festival: Festival) -> Festival:
    """The same festival with every act's rarity set to the neutral value, so the rarity term of the price
    is the same for every pair (both presets already hold 0.5 for every act, so nothing changes for them)."""
    acts = [act.model_copy(update={"rarity": NEUTRAL_RARITY}) for act in festival.acts]
    return festival.model_copy(update={"acts": acts})


def _priced_pairs(festival: Festival, matrix: OverlapMatrix, day: int) -> list[tuple[PairKey, str, str]]:
    """Every priced concurrent pair of the day with a cost above zero, costliest first, as (key, name a,
    name b). Same price and same order as the page's clash list (``score_festival``), but without its cut to
    the festival's top pairs; ties by act ids."""
    layout = Layout.from_festival(festival)
    scorer = metrics.build_scorer(festival, matrix, ScoringConfig(baseline_samples=0), layout)
    rules = layout.rules
    priced = []
    for i, k, shared in layout.concurrent_pairs():
        if layout.day[i] != day or not (scorer.scored[i] and scorer.scored[k]):
            continue
        cost = scorer.regret_w[i][k] * (shared / min(rules.dur[i], rules.dur[k]))
        if cost > 0:
            priced.append((-cost, rules.act_ids[i], rules.act_ids[k], rules.names[i], rules.names[k]))
    priced.sort(key=lambda p: p[:3])
    return [((a_id, b_id), a, b) for _, a_id, b_id, a, b in priced]


def _ranks(ordered: list[tuple[PairKey, str, str]]) -> dict[PairKey, int]:
    return {key: position for position, (key, _, _) in enumerate(ordered, start=1)}


def _entry(key: PairKey, a: str, b: str, rank: int, other: str, other_rank: int | None) -> dict[str, Any]:
    return {"a": a, "b": b, "a_id": key[0], "b_id": key[1], "rank": rank, other: other_rank}


def _apart(festival: Festival, matrix: OverlapMatrix, day: int) -> list[dict[str, str]]:
    """Up to 3 priced pairs of the day that share no minute and whose taste overlap is in the top tenth of
    the day's priced pairs, highest first (names and ids only)."""
    names = {act.id: act.name for act in festival.acts}
    slots = [s for s in festival.timetable if s.day == day and _priced(matrix, s.act_id)]
    slots.sort(key=lambda s: s.act_id)
    index = matrix.index()
    pairs = [
        (matrix.values[index[a.act_id]][index[b.act_id]], a, b)
        for n, a in enumerate(slots)
        for b in slots[n + 1 :]
    ]
    if len(pairs) < 2:
        return []
    values = sorted(value for value, _, _ in pairs)
    lower = {}
    for position, value in enumerate(values):
        lower.setdefault(value, position)  # pairs with a strictly lower value
    top = [
        (value, a, b)
        for value, a, b in pairs
        if lower[value] / (len(pairs) - 1) >= APART_QUANTILE and metrics.shared_minutes(a, b) == 0
    ]
    top.sort(key=lambda item: (-item[0], item[1].act_id, item[2].act_id))
    return [
        {"a": names[a.act_id], "b": names[b.act_id], "a_id": a.act_id, "b_id": b.act_id}
        for _, a, b in top[:APART_SHOWN]
    ]


def _nearest_rank(ordered: list[int], percent: int) -> int:
    """Nearest-rank percentile of an ascending list of integers."""
    return ordered[max(1, math.ceil(percent / 100 * len(ordered))) - 1]


def shuffled_null(
    festival: Festival, matrix: OverlapMatrix, day: int, outside: set[PairKey], runs: int = SHUFFLE_RUNS
) -> dict[str, int]:
    """``only_with_taste`` again, ``runs`` times, with the taste overlaps dealt out at random.

    Each run permutes the matrix over act labels among the bill's priced acts (those on the timetable that the
    scorer prices), so every pair keeps a taste overlap the lineup really has but usually not its own; the
    timetable, draw, rarity, the matrix's structure and the unpriced acts are untouched. It counts the day's
    15 costliest pairs of the shuffled view that are not in the 15 costliest of the draw-and-time view
    (``outside`` holds the keys of that view's 15). The seed is fixed, so the answer is the same on every
    call. Returns the number of runs and the median and 10th/90th percentile of the counts (nearest rank), as
    integers."""
    layout = Layout.from_festival(festival)
    scorer = metrics.build_scorer(festival, matrix, ScoringConfig(baseline_samples=0), layout)
    rules = layout.rules
    index = matrix.index()
    pairs = [
        (i, k, shared)
        for i, k, shared in layout.concurrent_pairs()
        if layout.day[i] == day and scorer.scored[i] and scorer.scored[k]
    ]
    keys = {i: rules.act_ids[i] for pair in pairs for i in pair[:2]}
    acts = sorted({act_id for act_id in rules.act_ids if _priced(matrix, act_id)})
    rng = random.Random(SHUFFLE_SEED)
    counts = []
    for _ in range(runs):
        dealt = acts[:]
        rng.shuffle(dealt)
        swap = dict(zip(acts, dealt, strict=True))
        priced = []
        for i, k, shared in pairs:
            a_id, b_id = keys[i], keys[k]
            overlap = matrix.values[index[swap[a_id]]][index[swap[b_id]]]
            cost = metrics.regret_weight(
                overlap, scorer.draw[i], scorer.draw[k], scorer.rarity[i], scorer.rarity[k]
            ) * (shared / min(rules.dur[i], rules.dur[k]))
            if cost > 0:
                priced.append((-cost, a_id, b_id))
        priced.sort()
        counts.append(sum((a_id, b_id) not in outside for _, a_id, b_id in priced[:RANKED]))
    counts.sort()
    return {
        "runs": runs,
        "median": _nearest_rank(counts, 50),
        "low": _nearest_rank(counts, SHUFFLE_LOW),
        "high": _nearest_rank(counts, SHUFFLE_HIGH),
    }


def compute_lenses(preset: Preset, day: int) -> dict[str, Any]:
    """The lens answer for one day of a preset (see the module docstring).

    ``rank_without_taste`` (on a ``with_taste`` entry) and ``rank_with_taste`` (on a ``without_taste`` entry)
    are null only when the pair has cost zero in that other view; a pair is never "not concurrent" in a view,
    since both views price the same timetable, and an unpriced pair is listed in neither."""
    festival, matrix = preset.festival, preset.matrix
    with_order = _priced_pairs(festival, matrix, day)
    flat_order = _priced_pairs(neutral_rarity(festival), without_taste(matrix), day)
    with_rank, flat_rank = _ranks(with_order), _ranks(flat_order)
    with_taste = [
        _entry(key, a, b, rank, "rank_without_taste", flat_rank.get(key))
        for rank, (key, a, b) in enumerate(with_order[:RANKED], start=1)
    ]
    plain = [
        _entry(key, a, b, rank, "rank_with_taste", with_rank.get(key))
        for rank, (key, a, b) in enumerate(flat_order[:RANKED], start=1)
    ]

    def outside(rank: int | None) -> bool:
        return rank is None or rank > RANKED

    return {
        "kind": "lenses",
        "day": day,
        "ranked": RANKED,
        "with_taste": with_taste,
        "without_taste": plain,
        "priced_with_taste": len(with_order),
        "priced_without_taste": len(flat_order),
        "only_with_taste": sum(outside(e["rank_without_taste"]) for e in with_taste),
        "only_without_taste": sum(outside(e["rank_with_taste"]) for e in plain),
        "shuffled": shuffled_null(festival, matrix, day, {key for key, _, _ in flat_order[:RANKED]}),
        "apart": _apart(festival, matrix, day),
    }


def lenses(preset: Preset, day: int) -> dict[str, Any]:
    """The lens answer, from the cache when this preset object already answered it."""
    key = (preset.id, day)
    with _lock:
        hit = _lenses.get(key)
    if hit is not None and hit[0] is preset:
        return hit[1]
    answer = compute_lenses(preset, day)
    with _lock:
        _lenses[key] = (preset, answer)  # a reloaded preset replaces its own entries
    return answer


@router.get("/{preset_id}/lenses")
def get_lenses(
    preset_id: str,
    presets: Presets,
    response: Response,
    day: Annotated[int | None, Query()] = None,
) -> dict[str, Any]:
    """The day's 15 costliest clashes priced with taste overlap and with draw and time alone (draw is also a
    Qloo field), each with its rank in the other view. Ranks only; no Qloo request."""
    preset = presets.get(preset_id)
    if preset is None:
        raise HTTPException(status_code=404, detail=f"No preset {preset_id[:MAX_ID_ECHO]!r}.")
    days = {slot.day for slot in preset.festival.timetable}
    if day is None and days:
        day = min(days)
    if day is None or day not in days:
        raise HTTPException(status_code=422, detail=NO_SETS)
    response.headers["Cache-Control"] = CACHE_CONTROL
    return lenses(preset, day)
