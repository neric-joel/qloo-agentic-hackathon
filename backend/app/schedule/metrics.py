"""Clash metrics: concurrency, regret, crowd-split quality and the Clash Budget Index.

Two sets are *concurrent* when they overlap in time on different stages of the same day. For a pair of
acts ``a`` and ``b`` with audience overlap ``o`` taken from the overlap matrix:

    concurrency   = shared minutes / minutes of the shorter set                          (0..1)
    draw          = popularity, or a billing-tier prior when popularity is unknown
    pair draw     = sqrt(draw_a * draw_b)
    regret        = o * concurrency * pair draw * (0.5 + mean rarity)
    split quality = (1 - o) * min(draw)/max(draw) * concurrency, for pairs where both acts are in the
                    top draw tier (a clash that cleanly divides a big crowd)

A timetable's regret and split quality are the sums over its concurrent pairs. Acts with no overlap signal
are left out of every sum; their clashes are never scored as zero overlap.

    Clash Budget Index = 100 * regret / mean regret of N random valid timetables of the same lineup

so 100 means "as bad as a random legal arrangement" and lower is better.
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from statistics import fmean, pstdev

from .constraints import describe_issue
from .layout import Layout
from .models import (
    Act,
    BaselineStats,
    Coverage,
    Festival,
    OverlapMatrix,
    ScheduleInputError,
    ScoringConfig,
    SetSlot,
)
from .reports import (
    ClashAct,
    ClashLabel,
    CoverageSummary,
    Movability,
    PairClash,
    ScheduleMetrics,
    ScoreReport,
    StageFitFlag,
    Thresholds,
    UnscoredAct,
    Violation,
)
from .sampling import sample_pair_sums

EPSILON = 1e-9
DRAW_PRIOR = {1: 0.9, 2: 0.7, 3: 0.5, 4: 0.3}
RARITY_FLOOR = 0.5
SPLIT_NORMALISER_FLOOR = 0.02


def shared_minutes(a: SetSlot, b: SetSlot) -> int:
    """Minutes two sets overlap; zero when they are on different days."""
    if a.day != b.day:
        return 0
    return max(0, min(a.end, b.end) - max(a.start, b.start))


def concurrency(a: SetSlot, b: SetSlot) -> float:
    """Shared minutes over the shorter set's minutes, for sets on the same day and different stages."""
    if a.stage_id == b.stage_id:
        return 0.0
    return shared_minutes(a, b) / min(a.duration, b.duration)


def draw_of(act: Act) -> float:
    return act.popularity if act.popularity is not None else DRAW_PRIOR[act.billing_tier]


def pair_draw(draw_a: float, draw_b: float) -> float:
    return math.sqrt(draw_a * draw_b)


def draw_balance(draw_a: float, draw_b: float) -> float:
    high = max(draw_a, draw_b)
    return min(draw_a, draw_b) / high if high > 0 else 0.0


def regret_weight(overlap: float, draw_a: float, draw_b: float, rarity_a: float, rarity_b: float) -> float:
    """Regret of a pair if the two sets were fully concurrent."""
    rarity_term = RARITY_FLOOR + (rarity_a + rarity_b) / 2
    return overlap * pair_draw(draw_a, draw_b) * rarity_term


def split_weight(overlap: float, draw_a: float, draw_b: float) -> float:
    """Split quality of a pair if the two sets were fully concurrent (top-draw pairs only)."""
    return (1.0 - overlap) * draw_balance(draw_a, draw_b)


def pair_regret(a: SetSlot, b: SetSlot, overlap: float, act_a: Act, act_b: Act) -> float:
    return concurrency(a, b) * regret_weight(
        overlap, draw_of(act_a), draw_of(act_b), act_a.rarity, act_b.rarity
    )


def pair_split(a: SetSlot, b: SetSlot, overlap: float, act_a: Act, act_b: Act) -> float:
    return concurrency(a, b) * split_weight(overlap, draw_of(act_a), draw_of(act_b))


def clash_budget_index(regret: float, baseline_mean_regret: float | None) -> float | None:
    if baseline_mean_regret is None or baseline_mean_regret <= EPSILON:
        return None
    return 100.0 * regret / baseline_mean_regret


def quantile(sorted_values: Sequence[float], q: float) -> float | None:
    """Linear-interpolation quantile of an ascending list."""
    if not sorted_values:
        return None
    position = q * (len(sorted_values) - 1)
    low, high = math.floor(position), math.ceil(position)
    return sorted_values[low] + (sorted_values[high] - sorted_values[low]) * (position - low)


@dataclass(frozen=True)
class Scorer:
    """Per-set scoring inputs prepared once for a festival and overlap matrix (indexed like the layout)."""

    config: ScoringConfig
    genre: list[str | None]
    coverage: list[Coverage]
    in_matrix: list[bool]
    scored: list[bool]
    draw: list[float]
    rarity: list[float]
    popularity: list[float | None]
    top_tier: list[bool]
    overlap: list[list[float]]
    regret_w: list[list[float]]
    split_w: list[list[float]]
    split_mass: float
    hidden_threshold: float | None
    false_threshold: float | None
    draw_cutoff: float | None


def build_scorer(festival: Festival, matrix: OverlapMatrix, config: ScoringConfig, layout: Layout) -> Scorer:
    acts = festival.act_by_id()
    rules = layout.rules
    n = rules.n_sets
    matrix_index = matrix.index()
    if not any(act_id in matrix_index for act_id in rules.act_ids):
        raise ScheduleInputError("the overlap matrix has none of the scheduled acts; check the act ids")
    ordered = [acts[act_id] for act_id in rules.act_ids]
    in_matrix = [act.id in matrix_index for act in ordered]
    coverage: list[Coverage] = [
        matrix.coverage_of(act.id) if ok else "none" for act, ok in zip(ordered, in_matrix, strict=True)
    ]
    scored = [ok and level != "none" for ok, level in zip(in_matrix, coverage, strict=True)]
    draw = [draw_of(act) for act in ordered]
    rarity = [act.rarity for act in ordered]
    top_tier, draw_cutoff = top_draw_tier(draw, scored, config.top_draw_share)
    overlap = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for k in range(i + 1, n):
            if scored[i] and scored[k]:
                overlap[i][k] = overlap[k][i] = matrix.values[matrix_index[ordered[i].id]][
                    matrix_index[ordered[k].id]
                ]
    regret_w = [[0.0] * n for _ in range(n)]
    split_w = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for k in range(i + 1, n):
            if not (scored[i] and scored[k]):
                continue
            regret_w[i][k] = regret_w[k][i] = regret_weight(
                overlap[i][k], draw[i], draw[k], rarity[i], rarity[k]
            )
            if top_tier[i] and top_tier[k]:
                split_w[i][k] = split_w[k][i] = split_weight(overlap[i][k], draw[i], draw[k])
    pair_overlaps = sorted(
        overlap[i][k] for i in range(n) for k in range(i + 1, n) if scored[i] and scored[k]
    )
    return Scorer(
        config=config,
        genre=[_normalise_genre(act.genre) for act in ordered],
        coverage=coverage,
        in_matrix=in_matrix,
        scored=scored,
        draw=draw,
        rarity=rarity,
        popularity=[act.popularity for act in ordered],
        top_tier=top_tier,
        overlap=overlap,
        regret_w=regret_w,
        split_w=split_w,
        split_mass=sum(split_w[i][k] for i in range(n) for k in range(i + 1, n)),
        hidden_threshold=quantile(pair_overlaps, config.hidden_quantile),
        false_threshold=quantile(pair_overlaps, config.false_quantile),
        draw_cutoff=draw_cutoff,
    )


def _normalise_genre(genre: str | None) -> str | None:
    cleaned = (genre or "").strip().casefold()
    return cleaned or None


def top_draw_tier(
    draw: Sequence[float], scored: Sequence[bool], share: float
) -> tuple[list[bool], float | None]:
    """Flag the scored acts in the top ``share`` of the lineup by draw (ties at the cut-off are kept)."""
    ranked = sorted((i for i, ok in enumerate(scored) if ok), key=lambda i: -draw[i])
    if len(ranked) < 2:
        return [False] * len(draw), None
    keep = min(len(ranked), max(2, math.ceil(share * len(ranked))))
    cutoff = draw[ranked[keep - 1]]
    return [scored[i] and draw[i] >= cutoff for i in range(len(draw))], cutoff


def clash_label(scorer: Scorer, i: int, k: int) -> ClashLabel | None:
    """Label a concurrent pair.

    "hidden": genres differ yet the audiences overlap heavily (top decile of the lineup).
    "false": the genres match but the audiences barely meet (bottom quartile).
    """
    genre_i, genre_k = scorer.genre[i], scorer.genre[k]
    if genre_i is None or genre_k is None:
        return None
    overlap = scorer.overlap[i][k]
    hidden, false = scorer.hidden_threshold, scorer.false_threshold
    if genre_i != genre_k and hidden is not None and overlap > 0 and overlap >= hidden:
        return "hidden"
    if genre_i == genre_k and false is not None and overlap <= false:
        return "false"
    return None


def split_normaliser(scorer: Scorer, baseline: BaselineStats | None) -> float | None:
    """Scale that turns split quality into an index.

    The baseline mean, floored at a small share of the total split weight so that a baseline with very few
    top-draw clashes cannot make the split term dominate the objective.
    """
    if baseline is None or scorer.split_mass <= EPSILON:
        return None
    return max(baseline.mean_split, SPLIT_NORMALISER_FLOOR * scorer.split_mass)


def estimate_baseline(layout: Layout, scorer: Scorer, config: ScoringConfig) -> BaselineStats:
    samples = sample_pair_sums(
        layout, [scorer.regret_w, scorer.split_w], config.baseline_samples, config.seed
    )
    regrets = sorted(s[0] for s in samples.sums)
    mean_regret = fmean(regrets)
    return BaselineStats(
        samples=len(regrets),
        mean_regret=mean_regret,
        std_regret=pstdev(regrets),
        mean_split=fmean(s[1] for s in samples.sums),
        p10_index=clash_budget_index(quantile(regrets, 0.1) or 0.0, mean_regret),
        p90_index=clash_budget_index(quantile(regrets, 0.9) or 0.0, mean_regret),
        degenerate=samples.degenerate,
    )


def resolve_baseline(layout: Layout, scorer: Scorer, config: ScoringConfig) -> BaselineStats | None:
    if config.baseline is not None:
        return config.baseline
    if config.baseline_samples == 0:
        return None
    return estimate_baseline(layout, scorer, config)


def measure(scorer: Scorer, layout: Layout, baseline: BaselineStats | None) -> ScheduleMetrics:
    regret, split = layout.pair_sums([scorer.regret_w, scorer.split_w])
    pairs = layout.concurrent_pairs()
    scored_pairs = sum(1 for i, k, _ in pairs if scorer.scored[i] and scorer.scored[k])
    normaliser = split_normaliser(scorer, baseline)
    return ScheduleMetrics(
        regret=round(regret, 6),
        clash_budget_index=_rounded(clash_budget_index(regret, baseline.mean_regret if baseline else None)),
        split_quality=round(split, 6),
        split_index=_rounded(100.0 * split / normaliser if normaliser else None),
        scored_concurrent_pairs=scored_pairs,
        unscored_concurrent_pairs=len(pairs) - scored_pairs,
    )


def _rounded(value: float | None, digits: int = 2) -> float | None:
    return None if value is None else round(value, digits)


def _pair_details(scorer: Scorer, layout: Layout, festival: Festival) -> list[PairClash]:
    rules = layout.rules
    acts = festival.act_by_id()
    details = []
    for i, k, shared in layout.concurrent_pairs():
        if not (scorer.scored[i] and scorer.scored[k]):
            continue
        conc = shared / min(rules.dur[i], rules.dur[k])
        both_top = scorer.top_tier[i] and scorer.top_tier[k]
        weak = "weak" in (scorer.coverage[i], scorer.coverage[k])
        details.append(
            PairClash(
                rank=0,
                a=_clash_act(rules.act_ids[i], rules.stage_ids[layout.stage[i]], acts[rules.act_ids[i]]),
                b=_clash_act(rules.act_ids[k], rules.stage_ids[layout.stage[k]], acts[rules.act_ids[k]]),
                day=layout.day[i],
                overlap_minutes=shared,
                concurrency=round(conc, 4),
                audience_overlap=round(scorer.overlap[i][k], 4),
                draw=round(pair_draw(scorer.draw[i], scorer.draw[k]), 4),
                regret=scorer.regret_w[i][k] * conc,
                regret_share=0.0,
                split_quality=scorer.split_w[i][k] * conc if both_top else None,
                label=clash_label(scorer, i, k),
                confidence="weak" if weak else "strong",
            )
        )
    return details


def _clash_act(act_id: str, stage_id: str, act: Act) -> ClashAct:
    return ClashAct(act_id=act_id, name=act.name, stage_id=stage_id, genre=act.genre)


def _ranked(clashes: list[PairClash], key, limit: int) -> list[PairClash]:
    ordered = sorted(clashes, key=key)[:limit]
    return [c.model_copy(update={"rank": position}) for position, c in enumerate(ordered, start=1)]


def stage_fit_flags(festival: Festival, scorer: Scorer, layout: Layout) -> list[StageFitFlag]:
    """Flag acts whose draw rank does not match the tier of the stage they play.

    Stage tiers get seats in proportion to the sets they host; the draw ranking is laid over those seats.
    An act is flagged only when it is out of place even after the rank slack in ``stage_fit_tolerance``.
    """
    rules = layout.rules
    rated = sorted(
        (i for i in range(rules.n_sets) if scorer.popularity[i] is not None),
        key=lambda i: (-(scorer.popularity[i] or 0.0), rules.act_ids[i]),
    )
    tiers = sorted(set(rules.stage_tier[layout.stage[i]] for i in range(rules.n_sets)))
    if len(rated) < 3 or len(tiers) < 2:
        return []
    boundaries = _tier_boundaries(layout, tiers, len(rated))
    slack = max(1, round(scorer.config.stage_fit_tolerance * len(rated)))
    stages = festival.stage_by_id()
    flags = []
    for rank, i in enumerate(rated, start=1):
        actual = rules.stage_tier[layout.stage[i]]
        tier_min = _expected_tier(boundaries, max(1, rank - slack))
        tier_max = _expected_tier(boundaries, min(len(rated), rank + slack))
        if tier_min <= actual <= tier_max:
            continue
        stage = stages[rules.stage_ids[layout.stage[i]]]
        bigger = actual > tier_max
        fit = f"tier {tier_min}" if tier_min == tier_max else f"tiers {tier_min}-{tier_max}"
        flags.append(
            StageFitFlag(
                act_id=rules.act_ids[i],
                name=rules.names[i],
                stage_id=stage.id,
                stage_name=stage.name,
                stage_tier=actual,
                draw_rank=rank,
                lineup_size=len(rated),
                expected_tier_min=tier_min,
                expected_tier_max=tier_max,
                direction="bigger_stage_suggested" if bigger else "smaller_stage_suggested",
                message=(
                    f"{rules.names[i]} ranks {rank} of {len(rated)} by draw but plays {stage.name} "
                    f"(tier {actual}); that draw fits {fit}."
                ),
            )
        )
    return flags


def _tier_boundaries(layout: Layout, tiers: list[int], rated: int) -> list[tuple[int, int]]:
    """(tier, last draw rank that belongs to that tier) in ascending tier order."""
    rules = layout.rules
    counts = defaultdict(int)
    for i in range(rules.n_sets):
        counts[rules.stage_tier[layout.stage[i]]] += 1
    running = 0
    boundaries = []
    for tier in tiers:
        running += counts[tier]
        boundaries.append((tier, round(running / rules.n_sets * rated)))
    return boundaries


def _expected_tier(boundaries: list[tuple[int, int]], rank: int) -> int:
    for tier, last_rank in boundaries:
        if rank <= last_rank:
            return tier
    return boundaries[-1][0]


def coverage_summary(scorer: Scorer, layout: Layout) -> CoverageSummary:
    rules = layout.rules
    unscored = [
        UnscoredAct(
            act_id=rules.act_ids[i],
            name=rules.names[i],
            reason="not_in_matrix" if not scorer.in_matrix[i] else "no_signal",
        )
        for i in range(rules.n_sets)
        if not scorer.scored[i]
    ]
    levels = [scorer.coverage[i] for i in range(rules.n_sets)]
    scored_acts = rules.n_sets - len(unscored)
    return CoverageSummary(
        strong=levels.count("strong"),
        weak=levels.count("weak"),
        none=levels.count("none"),
        scored_acts=scored_acts,
        scored_share=round(scored_acts / rules.n_sets, 4) if rules.n_sets else 0.0,
        unscored=unscored,
        weak_act_ids=[rules.act_ids[i] for i in range(rules.n_sets) if levels[i] == "weak"],
    )


def movability(scorer: Scorer, layout: Layout) -> Movability:
    rules = layout.rules
    n = rules.n_sets
    locked = sum(rules.locked)
    by_violation = sum(1 for i in range(n) if layout.frozen[i] and not rules.locked[i])
    unscored = sum(1 for i in range(n) if not layout.frozen[i] and not scorer.scored[i])
    movable = n - locked - by_violation - unscored
    return Movability(
        total_sets=n,
        locked=locked,
        frozen_by_existing_violations=by_violation,
        unscored=unscored,
        movable=movable,
        movable_share=round(movable / n, 4) if n else 0.0,
    )


def violations(layout: Layout) -> list[Violation]:
    rules = layout.rules
    found = []
    for issue in sorted(layout.issues(), key=str):
        found.append(
            Violation(
                kind=str(issue[0]),
                act_ids=[rules.act_ids[i] for i in issue[1:] if isinstance(i, int)],
                message=describe_issue(issue, rules),
            )
        )
    return found


def build_report(
    festival: Festival, layout: Layout, scorer: Scorer, baseline: BaselineStats | None
) -> ScoreReport:
    config = scorer.config
    details = _pair_details(scorer, layout, festival)
    total_regret = sum(c.regret for c in details)
    shares = [
        c.model_copy(update={"regret_share": round(c.regret / total_regret, 4) if total_regret > 0 else 0.0})
        for c in details
    ]
    clashes = _ranked(
        [c for c in shares if c.regret > 0], lambda c: (-c.regret, c.a.act_id, c.b.act_id), config.top_clashes
    )
    false_clashes = _ranked(
        [c for c in shares if c.label == "false"],
        lambda c: (-(c.draw * c.concurrency), c.a.act_id, c.b.act_id),
        config.top_clashes,
    )
    splits = _ranked(
        [c for c in shares if c.split_quality],
        lambda c: (-(c.split_quality or 0.0), c.a.act_id, c.b.act_id),
        config.top_clashes,
    )
    by_act: dict[str, float] = defaultdict(float)
    for c in details:
        by_act[c.a.act_id] += c.regret
        by_act[c.b.act_id] += c.regret
    rules = layout.rules
    return ScoreReport(
        festival_id=festival.id,
        metrics=measure(scorer, layout, baseline),
        baseline=baseline,
        clashes=_rounded_regret(clashes),
        false_clashes=_rounded_regret(false_clashes),
        splits=_rounded_regret(splits),
        hidden_clash_count=sum(1 for c in details if c.label == "hidden"),
        false_clash_count=sum(1 for c in details if c.label == "false"),
        regret_by_act={act_id: round(by_act[act_id], 4) for act_id in rules.act_ids if by_act[act_id] > 0},
        top_draw_acts=[rules.act_ids[i] for i in range(rules.n_sets) if scorer.top_tier[i]],
        thresholds=Thresholds(
            hidden_overlap=_rounded(scorer.hidden_threshold, 4),
            false_overlap=_rounded(scorer.false_threshold, 4),
            top_draw_cutoff=_rounded(scorer.draw_cutoff, 4),
        ),
        stage_fit=stage_fit_flags(festival, scorer, layout),
        coverage=coverage_summary(scorer, layout),
        movability=movability(scorer, layout),
        violations=violations(layout),
    )


def _rounded_regret(clashes: list[PairClash]) -> list[PairClash]:
    return [
        c.model_copy(
            update={
                "regret": round(c.regret, 6),
                "split_quality": None if c.split_quality is None else round(c.split_quality, 6),
            }
        )
        for c in clashes
    ]


def score_festival(
    festival: Festival, matrix: OverlapMatrix, config: ScoringConfig | None = None
) -> ScoreReport:
    """Score a timetable: metrics, Clash Budget Index, ranked clashes, labels and stage-fit flags."""
    config = config or ScoringConfig()
    layout = Layout.from_festival(festival)
    scorer = build_scorer(festival, matrix, config, layout)
    return build_report(festival, layout, scorer, resolve_baseline(layout, scorer, config))
