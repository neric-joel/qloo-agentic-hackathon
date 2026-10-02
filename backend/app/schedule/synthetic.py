"""Seeded synthetic festival and audience-overlap matrix for development, tests and the demo endpoint.

Everything here is invented: act names, popularity, genres and overlaps. The overlap matrix has genre
and scene clusters, a few cross-genre "hidden" overlaps and a few same-genre "false clash" pairs, and is
labeled ``source="synthetic"``. With ``showcase=True`` (the default) the generator keeps drawing timetables
until the result contains hidden clashes, a false clash and a good crowd split worth looking at.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from functools import lru_cache

from .layout import Layout
from .metrics import build_scorer, clash_label
from .models import (
    Act,
    BillingRule,
    Constraints,
    Festival,
    OverlapMatrix,
    ScoringConfig,
    SetSlot,
    Stage,
    StageHours,
)

GENRES = ("Indie", "Electronic", "Hip-hop", "Pop", "Folk", "Rock")
ADJACENT_GENRES = frozenset(
    frozenset(pair)
    for pair in (
        ("Indie", "Folk"),
        ("Indie", "Rock"),
        ("Indie", "Pop"),
        ("Electronic", "Pop"),
        ("Pop", "Hip-hop"),
    )
)
FIRST_WORDS = (
    "Velvet", "Copper", "Marble", "Hollow", "Neon", "Amber", "Glass", "Orchid", "Static", "Ember",
    "Tidal", "Cedar", "Lunar", "Quiet", "Brass", "Violet", "Fable", "Meridian", "Saffron", "Cobalt",
    "Willow", "Echo", "Harbor", "Juniper", "Sable", "Ivory", "Rustic", "Solar", "Mosaic", "Crimson",
)  # fmt: skip
SECOND_WORDS = (
    "Orchard", "Parade", "Lantern", "Choir", "Signal", "Meadow", "Circuit", "Atlas", "Weather", "Bloom",
    "Machine", "Garden", "Lights", "Syndicate", "Roads", "Season", "Ghosts", "Compass", "Anthem", "Engine",
    "Fields", "Radio", "Mirror", "Hours", "Sparrows", "Pilots", "Harvest", "Tides", "Voltage", "Harbour",
)  # fmt: skip
STAGE_PRESETS = (
    ("main", "Main Stage", 1, 1380),
    ("river", "Riverside Stage", 2, 1350),
    ("grove", "Grove Stage", 2, 1320),
    ("tent", "Night Tent", 3, 1410),
)
DAY_LABELS = ("Friday", "Saturday", "Sunday", "Monday")
TIER_SHARE = (0.11, 0.22, 0.33)
DURATIONS = {1: (90, 100), 2: (70, 75, 80), 3: (55, 60), 4: (40, 45)}
POPULARITY = {1: (0.86, 0.99), 2: (0.66, 0.85), 3: (0.42, 0.65), 4: (0.16, 0.40)}
STAGE_SHARES = (0.28, 0.26, 0.24, 0.22)
MAIN_STAGE_PULL = {2: 3.0, 3: 2.0, 4: 1.0}  # how readily a billing tier fills the main stage's spare slots
STAGE_AFFINITY = {  # billing tier -> stage tier (capped at 3) -> how readily the act is booked there
    2: {1: 0.6, 2: 1.0, 3: 0.05},
    3: {1: 0.1, 2: 0.8, 3: 0.6},
    4: {1: 0.12, 2: 0.5, 3: 1.0},
}
CURFEW = 1425
OPENING = 720
SHOWCASE_ATTEMPTS = 300


@dataclass(frozen=True)
class _ActPlan:
    id: str
    name: str
    tier: int
    genre: str
    scene: int
    popularity: float
    rarity: float
    duration: int


def synthetic_festival(
    seed: int = 7, *, days: int = 2, stages: int = 4, acts: int = 36, showcase: bool = True
) -> tuple[Festival, OverlapMatrix]:
    """A reproducible synthetic festival and matching overlap matrix.

    ``acts`` is the number of acts, spread over ``days`` days and ``stages`` stages (2 to 4 use the named
    presets, more are generated as small stages).
    """
    if not (1 <= days <= len(DAY_LABELS) and 2 <= stages <= 8 and 4 <= acts <= 120):
        raise ValueError("synthetic festivals need 1-4 days, 2-8 stages and 4-120 acts")
    if showcase:
        return _showcase(seed, days, stages, acts)
    return _draw(random.Random(seed), days, stages, acts)


@lru_cache(maxsize=16)
def _showcase(seed: int, days: int, stages: int, acts: int) -> tuple[Festival, OverlapMatrix]:
    fallback = None
    for attempt in range(SHOWCASE_ATTEMPTS):
        festival, matrix = _draw(random.Random(seed * 10_000 + attempt), days, stages, acts)
        fallback = fallback or (festival, matrix)
        if _is_showcase(festival, matrix):
            return festival, matrix
    assert fallback is not None
    return fallback


def _is_showcase(festival: Festival, matrix: OverlapMatrix) -> bool:
    """At least two concurrent hidden clashes, one false clash and one crowd split, and nothing invalid."""
    layout = Layout.from_festival(festival)
    scorer = build_scorer(festival, matrix, ScoringConfig(), layout)
    labels = [
        clash_label(scorer, i, k)
        for i, k, _ in layout.concurrent_pairs()
        if scorer.scored[i] and scorer.scored[k]
    ]
    splits = sum(
        1
        for i, k, _ in layout.concurrent_pairs()
        if scorer.top_tier[i] and scorer.top_tier[k] and scorer.overlap[i][k] < 0.2
    )
    return not layout.issues() and labels.count("hidden") >= 2 and labels.count("false") >= 1 and splits >= 1


def _draw(rng: random.Random, days: int, stage_count: int, act_count: int) -> tuple[Festival, OverlapMatrix]:
    plans = _plan_acts(rng, act_count, days)
    stages = _make_stages(stage_count)
    timetable = _place_sets(rng, plans, days, stages)
    festival = Festival(
        id="synthetic-lanternfield",
        name="Lanternfield Festival (synthetic)",
        city="Lanternfield",
        days=list(DAY_LABELS[:days]) if days <= len(DAY_LABELS) else days,
        stages=_with_hours(stages, timetable, days),
        acts=[
            Act(
                id=p.id,
                name=p.name,
                popularity=p.popularity,
                genre=p.genre,
                billing_tier=p.tier,
                rarity=p.rarity,
            )
            for p in plans
        ],
        timetable=timetable,
        constraints=_constraints(rng, plans, timetable, days),
    )
    return festival, _make_matrix(rng, plans)


def _tier_counts(acts: int, days: int) -> list[int]:
    top = min(acts, max(days, round(acts * TIER_SHARE[0])))
    second = min(acts - top, round(acts * TIER_SHARE[1]))
    third = min(acts - top - second, round(acts * TIER_SHARE[2]))
    return [top, second, third, acts - top - second - third]


def _plan_acts(rng: random.Random, act_count: int, days: int) -> list[_ActPlan]:
    names = [f"{a} {b}" for a in FIRST_WORDS for b in SECOND_WORDS]
    chosen = rng.sample(names, act_count)
    tiers = [tier for tier, count in enumerate(_tier_counts(act_count, days), start=1) for _ in range(count)]
    genres = [GENRES[i % len(GENRES)] for i in range(act_count)]
    rng.shuffle(genres)
    plans = []
    for index, (name, tier, genre) in enumerate(zip(chosen, tiers, genres, strict=True)):
        low, high = POPULARITY[tier]
        rare = rng.random() < 0.35
        plans.append(
            _ActPlan(
                id=f"act-{index + 1:02d}",
                name=name,
                tier=tier,
                genre=genre,
                scene=rng.randint(0, 1),
                popularity=round(rng.uniform(low, high), 3),
                rarity=rng.choice((0.1, 0.2, 0.8, 0.9)) if rare else 0.5,
                duration=rng.choice(DURATIONS[tier]),
            )
        )
    return plans


def _make_stages(count: int) -> list[Stage]:
    stages = [Stage(id=sid, name=name, tier=tier) for sid, name, tier, _ in STAGE_PRESETS[:count]]
    for n in range(len(stages) + 1, count + 1):
        stages.append(Stage(id=f"stage-{n}", name=f"Stage {n}", tier=3))
    return stages


def _closing_time(stage_index: int) -> int:
    return STAGE_PRESETS[stage_index][3] if stage_index < len(STAGE_PRESETS) else 1350


def _place_sets(rng: random.Random, plans: list[_ActPlan], days: int, stages: list[Stage]) -> list[SetSlot]:
    by_day = _split_by_day(rng, plans, days)
    slots: list[SetSlot] = []
    for day, day_plans in enumerate(by_day):
        stage_acts = _assign_stages(rng, day_plans, stages)
        for stage_index, members in enumerate(stage_acts):
            slots += _pack_stage(rng, day, stages[stage_index], stage_index, members)
    return slots


def _split_by_day(rng: random.Random, plans: list[_ActPlan], days: int) -> list[list[_ActPlan]]:
    by_day: list[list[_ActPlan]] = [[] for _ in range(days)]
    for tier in range(1, 5):
        group = [p for p in plans if p.tier == tier]
        rng.shuffle(group)
        for position, plan in enumerate(group):
            by_day[position % days].append(plan)
    return by_day


def _assign_stages(
    rng: random.Random, day_plans: list[_ActPlan], stages: list[Stage]
) -> list[list[_ActPlan]]:
    """Headliners and a few supporting acts fill the main stage; the rest prefer a stage of their tier."""
    shares = [STAGE_SHARES[min(s, len(STAGE_SHARES) - 1)] for s in range(len(stages))]
    targets = [max(1, round(len(day_plans) * share / sum(shares))) for share in shares]
    stage_acts: list[list[_ActPlan]] = [[] for _ in stages]
    stage_acts[0].extend(p for p in day_plans if p.tier == 1)
    others = [p for p in day_plans if p.tier != 1]
    rng.shuffle(others)
    for _ in range(max(0, targets[0] - len(stage_acts[0]))):
        if not others:
            break
        pick = rng.choices(range(len(others)), weights=[MAIN_STAGE_PULL[p.tier] for p in others])[0]
        stage_acts[0].append(others.pop(pick))
    for plan in sorted(others, key=lambda p: p.tier):
        room = [max(targets[s] - len(stage_acts[s]), 0) + 0.1 for s in range(len(stages))]
        fit = [STAGE_AFFINITY[plan.tier][min(stage.tier, 3)] for stage in stages]
        weights = [r * f for r, f in zip(room, fit, strict=True)]
        stage_acts[rng.choices(range(len(stages)), weights=weights)[0]].append(plan)
    return stage_acts


def _pack_stage(
    rng: random.Random, day: int, stage: Stage, stage_index: int, members: list[_ActPlan]
) -> list[SetSlot]:
    """Order a stage's acts from early undercard to headliner and pack them back from closing time."""
    ordered = sorted(members, key=lambda p: (-p.tier, rng.random()))
    base_gap = 30 if stage.tier == 1 else 20
    gaps = [base_gap + 5 * rng.randint(0, 3) for _ in ordered[1:]]
    end = _closing_time(stage_index)
    slots = []
    for position in range(len(ordered) - 1, -1, -1):
        plan = ordered[position]
        slots.append(
            SetSlot(
                act_id=plan.id,
                day=day,
                stage_id=stage.id,
                start=end - plan.duration,
                end=end,
                locked=plan.tier == 1,
                stage_locked=plan.tier == 2 and stage.tier == 1,
            )
        )
        if position > 0:
            end -= plan.duration + gaps[position - 1]
    return slots[::-1]


def _with_hours(stages: list[Stage], timetable: list[SetSlot], days: int) -> list[Stage]:
    result = []
    for stage in stages:
        hours = []
        for day in range(days):
            mine = [s for s in timetable if s.stage_id == stage.id and s.day == day]
            if mine:
                first_start = min(s.start for s in mine)
                opening = min(first_start, max(OPENING, (first_start - 60) // 30 * 30))
                closing = min(CURFEW, max(s.end for s in mine) + 30)
                hours.append(StageHours(day=day, open=opening, close=closing))
        result.append(stage.model_copy(update={"hours": hours}))
    return result


def _constraints(
    rng: random.Random, plans: list[_ActPlan], timetable: list[SetSlot], days: int
) -> Constraints:
    by_act = {slot.act_id: slot for slot in timetable}
    rider_pairs = _rider_pairs(rng, plans, by_act)
    headliners_per_day = [sum(1 for s in timetable if s.day == day and s.locked) for day in range(days)]
    return Constraints(
        changeover_minutes=15,
        curfew={day: CURFEW for day in range(days)},
        no_clash_with=rider_pairs,
        billing_rules=[BillingRule(billing_tier=1, max_stage_tier=1, last_slots=max(2, *headliners_per_day))],
    )


def _rider_pairs(
    rng: random.Random, plans: list[_ActPlan], by_act: dict[str, SetSlot]
) -> list[tuple[str, str]]:
    """One rider: two mid-bill acts that are not on at the same time today and must stay that way."""
    candidates = [p for p in plans if p.tier in (2, 3)]
    rng.shuffle(candidates)
    for a in candidates:
        for b in candidates:
            slot_a, slot_b = by_act[a.id], by_act[b.id]
            apart = slot_a.day != slot_b.day or slot_a.end <= slot_b.start or slot_b.end <= slot_a.start
            if a.id < b.id and apart and a.genre == b.genre:
                return [(a.id, b.id)]
    return []


def _make_matrix(rng: random.Random, plans: list[_ActPlan]) -> OverlapMatrix:
    n = len(plans)
    values = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for k in range(i + 1, n):
            values[i][k] = values[k][i] = _base_overlap(rng, plans[i], plans[k])
    _plant_special_pairs(rng, plans, values)
    coverage = _pick_coverage(rng, plans)
    for index, plan in enumerate(plans):
        if coverage.get(plan.id) == "none":
            for k in range(n):
                values[index][k] = values[k][index] = 0.0
    return OverlapMatrix(
        act_ids=[p.id for p in plans],
        values=[[round(v, 4) for v in row] for row in values],
        coverage=coverage,
        source="synthetic",
    )


def _base_overlap(rng: random.Random, a: _ActPlan, b: _ActPlan) -> float:
    if a.genre == b.genre:
        low, high = (0.60, 0.85) if a.scene == b.scene else (0.28, 0.48)
    elif frozenset((a.genre, b.genre)) in ADJACENT_GENRES:
        low, high = 0.14, 0.30
    else:
        low, high = 0.02, 0.12
    return min(1.0, max(0.0, rng.uniform(low, high) + rng.gauss(0, 0.015)))


def _plant_special_pairs(rng: random.Random, plans: list[_ActPlan], values: list[list[float]]) -> None:
    """Cross-genre hidden overlaps and same-genre pairs whose audiences barely meet."""
    notable = [i for i, p in enumerate(plans) if p.tier <= 3]
    hidden = [
        (i, k)
        for i in notable
        for k in notable
        if i < k
        and plans[i].genre != plans[k].genre
        and frozenset((plans[i].genre, plans[k].genre)) not in ADJACENT_GENRES
    ]
    false = [(i, k) for i in notable for k in notable if i < k and plans[i].genre == plans[k].genre]
    rng.shuffle(hidden)
    rng.shuffle(false)
    for i, k in hidden[:4]:
        values[i][k] = values[k][i] = rng.uniform(0.66, 0.86)
    for i, k in false[:4]:
        values[i][k] = values[k][i] = rng.uniform(0.01, 0.035)


def _pick_coverage(rng: random.Random, plans: list[_ActPlan]) -> dict[str, str]:
    """Weak signal for a few long-tail acts and none for one or two of the smallest."""
    tail = [p for p in plans if p.tier == 4]
    rng.shuffle(tail)
    coverage: dict[str, str] = {}
    none_count = 2 if len(plans) >= 30 else (1 if len(plans) >= 12 else 0)
    for plan in tail[:none_count]:
        coverage[plan.id] = "none"
    weak_count = max(0, round(len(plans) * 0.08))
    for plan in tail[none_count : none_count + weak_count]:
        coverage[plan.id] = "weak"
    return coverage
