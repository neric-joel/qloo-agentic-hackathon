"""Latest-start limits (``not_after``) and allowed-stage lists (``stages``) on individual sets."""

import random
from collections import defaultdict

import pytest
from hypothesis import given, settings
from pydantic import ValidationError
from schedule_support import PROPERTY, conflicts, festival_cases, make_festival, make_matrix, slots_of

from app.schedule.constraints import NO_LIMIT, build_rules
from app.schedule.layout import Layout, Move, Placement
from app.schedule.metrics import score_festival, violations
from app.schedule.models import BaselineStats, Constraints, Festival, OverlapMatrix, ScoringConfig, SetSlot
from app.schedule.moves import candidate_moves, free_windows, gap_moves, random_move, slot_window, swap_moves
from app.schedule.optimizer import optimize
from app.schedule.reports import Violation

NO_BASELINE = ScoringConfig(baseline_samples=0)
HOURS = {"main": [(0, 540, 900)], "side": [(0, 540, 900)], "tent": [(0, 540, 900)]}
A, B, C, D, E = range(5)
MAIN, SIDE, TENT = range(3)


def blocks(a: dict | None = None, c: dict | None = None, d: dict | None = None, *, tent: bool = False):
    """Sets a then d on the main stage and b then c on the side stage, at 10:00 and 12:00 for an hour each.

    With ``tent``, e plays the tent at 10:00. Every stage is open 09:00-15:00 with a 15-minute changeover,
    so the slot windows are a 09:00-11:45, b 09:00-11:45, c 11:15-15:00 and d 11:15-15:00.
    """
    sets = [
        ("a", 0, "main", 600, 660, a or {}),
        ("b", 0, "side", 600, 660),
        ("c", 0, "side", 720, 780, c or {}),
        ("d", 0, "main", 720, 780, d or {}),
    ]
    if tent:
        sets.append(("e", 0, "tent", 600, 660))
    return make_festival(sets, constraints=Constraints(changeover_minutes=15), hours=HOURS)


def slot(**overrides) -> SetSlot:
    fields = {"act_id": "a", "day": 0, "stage_id": "main", "start": 600, "end": 660}
    return SetSlot(**{**fields, **overrides})


def limit_breaks(festival: Festival, layout: Layout, move: Move) -> list[str]:
    """Places in ``move`` that break a set's start window, stage list or stage lock, read off the input."""
    found = []
    for i, (_, stage, start) in zip(move.sets, move.to, strict=True):
        published = festival.timetable[i]
        stage_id = layout.rules.stage_ids[stage]
        if published.not_before is not None and start < published.not_before:
            found.append(f"{published.act_id} would start before not_before")
        if published.not_after is not None and start > published.not_after:
            found.append(f"{published.act_id} would start after not_after")
        if published.stages is not None and stage_id not in published.stages:
            found.append(f"{published.act_id} would play {stage_id}, which is not in its list")
        if published.stage_locked and stage_id != published.stage_id:
            found.append(f"{published.act_id} would leave its locked stage")
    return found


def swaps_by_pair(layout: Layout) -> dict[frozenset[int], list[dict[int, Placement]]]:
    found: dict[frozenset[int], list[dict[int, Placement]]] = defaultdict(list)
    for move in candidate_moves(layout, [True] * layout.rules.n_sets):
        if len(move.sets) == 2:
            found[frozenset(move.sets)].append(dict(zip(move.sets, move.to, strict=True)))
    return dict(found)


class TestValidation:
    def test_not_after_takes_minutes_or_a_clock_string_and_defaults_to_none(self):
        assert slot(not_after="11:30").not_after == 690
        assert slot(not_after=700).not_after == 700
        assert (slot().not_after, slot().stages) == (None, None)

    def test_not_before_later_than_not_after_is_rejected(self):
        with pytest.raises(
            ValidationError, match="set for 'a' has not_before 11:40 later than not_after 11:30"
        ):
            slot(not_before=700, not_after=690)
        pinned = slot(not_before=700, not_after=700)
        assert (pinned.not_before, pinned.not_after) == (700, 700)

    def test_a_published_start_outside_its_window_is_accepted(self):
        late = slot(start=600, end=660, not_before=500, not_after=590)
        early = slot(start=600, end=660, not_before=610)
        assert (late.start, early.start) == (600, 600)

    def test_stage_lists_must_name_known_stages_and_include_the_current_stage(self):
        with pytest.raises(ValidationError) as error:
            make_festival(
                [
                    ("a", 0, "main", 600, 660, {"stages": ["main", "arena"]}),
                    ("b", 0, "side", 600, 660, {"stages": ["main"]}),
                ]
            )
        text = str(error.value)
        assert "set for 'a' lists unknown stage 'arena'" in text
        assert "set for 'b' is on stage 'side', which is not one of its allowed stages" in text

    def test_an_empty_stage_list_is_rejected(self):
        with pytest.raises(ValidationError, match="at least 1 item"):
            slot(stages=[])

    def test_rules_compile_latest_starts_and_allowed_stage_indices(self):
        rules = build_rules(blocks(a={"not_after": "11:40", "stages": ["tent", "main"]}, tent=True))
        assert rules.not_after == (700, NO_LIMIT, NO_LIMIT, NO_LIMIT, NO_LIMIT)
        every = frozenset({MAIN, SIDE, TENT})
        assert rules.allowed_stages == (frozenset({MAIN, TENT}), every, every, every, every)


class TestViolations:
    def test_a_published_start_after_not_after_is_reported_and_freezes_the_set(self):
        festival = make_festival([("a", 0, "main", 600, 660, {"not_after": 590}), ("b", 0, "side", 600, 660)])
        report = score_festival(festival, make_matrix(["a", "b"], {("a", "b"): 0.5}), NO_BASELINE)
        assert report.violations == [
            Violation(kind="not_after", act_ids=["a"], message="A starts after its latest allowed time")
        ]
        assert report.movability.frozen_by_existing_violations == 1
        assert Layout.from_festival(festival).frozen == (True, False)

    def test_a_set_on_a_stage_outside_its_list_is_reported(self):
        layout = Layout.from_festival(blocks(a={"stages": ["main"]}))
        assert violations(layout) == []
        moved = layout.with_placements([(0, SIDE, 795), *layout.snapshot()[1:]])
        assert violations(moved) == [
            Violation(kind="stage", act_ids=["a"], message="A is on a stage it may not play on")
        ]


class TestCandidateMoves:
    def test_free_windows_end_where_a_start_at_not_after_would_end(self):
        unlimited = Layout.from_festival(blocks(tent=True))
        assert free_windows(unlimited, A, 0, MAIN) == [(540, 705), (795, 900)]
        assert free_windows(unlimited, A, 0, TENT) == [(675, 900)]
        limited = Layout.from_festival(blocks(a={"not_after": 700}, tent=True))
        assert free_windows(limited, A, 0, MAIN) == [(540, 705)]  # 12:00-13:00 belongs to d
        assert free_windows(limited, A, 0, TENT) == [(675, 760)]  # latest start 11:40, so latest end 12:40

    def test_gap_moves_stay_inside_the_start_window_and_the_stage_list(self):
        layout = Layout.from_festival(blocks(a={"not_after": 700, "stages": ["main", "tent"]}, tent=True))
        assert [move.to for move in gap_moves(layout, A)] == [
            ((0, MAIN, 540),),
            ((0, MAIN, 645),),
            ((0, TENT, 675),),
            ((0, TENT, 700),),
        ]

    UNLIMITED_SWAPS = {
        frozenset({A, B}): [{A: (0, SIDE, 600), B: (0, MAIN, 600)}],
        frozenset({A, C}): [{A: (0, SIDE, 720), C: (0, MAIN, 600)}],
        frozenset({A, D}): [{D: (0, MAIN, 600), A: (0, MAIN, 720)}],  # same stage: d opens, a closes
        frozenset({B, C}): [{C: (0, SIDE, 600), B: (0, SIDE, 720)}],
        frozenset({B, D}): [{B: (0, MAIN, 720), D: (0, SIDE, 600)}],
        frozenset({C, D}): [{C: (0, MAIN, 720), D: (0, SIDE, 720)}],
    }

    @pytest.mark.parametrize(
        ("limits", "dropped", "changed"),
        [
            pytest.param({}, set(), {}, id="no limits"),
            pytest.param({"a": {"not_after": 670}}, {(A, C), (A, D)}, {}, id="a may not start after 11:10"),
            pytest.param(
                {"a": {"not_after": 700}},
                {(A, D)},
                {(A, C): [{A: (0, SIDE, 700), C: (0, MAIN, 600)}]},
                id="a may not start after 11:40, so it starts c's slot 20 minutes early",
            ),
            pytest.param({"a": {"stages": ["main"]}}, {(A, B), (A, C)}, {}, id="a stays on the main stage"),
            pytest.param({"c": {"stages": ["side"]}}, {(A, C), (C, D)}, {}, id="c stays on the side stage"),
            pytest.param({"d": {"not_before": 650}}, {(A, D), (B, D)}, {}, id="d may not start before 10:50"),
        ],
    )
    def test_swaps_respect_the_limits_of_both_sets(self, limits, dropped, changed):
        layout = Layout.from_festival(blocks(**limits))
        expected = {
            pair: changed.get(tuple(sorted(pair)), placements)
            for pair, placements in self.UNLIMITED_SWAPS.items()
            if tuple(sorted(pair)) not in dropped
        }
        assert swaps_by_pair(layout) == expected

    def test_a_swap_is_judged_by_both_sets_limits_in_either_argument_order(self):
        layout = Layout.from_festival(blocks(a={"not_after": 700}))
        windows = [slot_window(layout, i) for i in range(4)]
        assert swap_moves(layout, A, C, windows[A], windows[C]) == (
            Move((A, C), ((0, SIDE, 700), (0, MAIN, 600))),
        )
        assert swap_moves(layout, C, A, windows[C], windows[A]) == (
            Move((C, A), ((0, MAIN, 600), (0, SIDE, 700))),
        )
        for limits in ({"a": {"not_after": 670}}, {"a": {"stages": ["main"]}}, {"c": {"stages": ["side"]}}):
            blocked = Layout.from_festival(blocks(**limits))
            windows = [slot_window(blocked, i) for i in range(4)]
            assert swap_moves(blocked, A, C, windows[A], windows[C]) == ()
            assert swap_moves(blocked, C, A, windows[C], windows[A]) == ()

    def test_feasibility_rejects_a_late_start_and_a_stage_outside_the_list(self):
        layout = Layout.from_festival(blocks(a={"not_after": 700, "stages": ["main", "tent"]}, tent=True))
        inside = Move((A,), ((0, TENT, 700),))
        late = Move((A,), ((0, TENT, 760),))
        late_and_off_list = Move((A,), ((0, SIDE, 795),))
        assert (layout.issues_after(inside), layout.is_feasible(inside)) == (set(), True)
        assert (layout.issues_after(late), layout.is_feasible(late)) == ({("not_after", A)}, False)
        assert (layout.issues_after(late_and_off_list), layout.is_feasible(late_and_off_list)) == (
            {("not_after", A), ("stage", A)},
            False,
        )
        listed_only = Layout.from_festival(blocks(a={"stages": ["main", "tent"]}, tent=True))
        assert (listed_only.issues_after(late_and_off_list), listed_only.is_feasible(late_and_off_list)) == (
            {("stage", A)},
            False,
        )


def undercard(limits: dict) -> tuple[Festival, OverlapMatrix]:
    """An undercard set on the tent clashing with a locked main-stage set.

    The main stage is taken 10:00-11:00 and 12:00-13:00, so the clash-free places for the undercard are
    the main stage from 13:15, or the tent from 11:00 (when its window allows) or at 14:00.
    """
    festival = make_festival(
        [
            ("a", 0, "tent", 600, 660, limits),
            ("b", 0, "main", 600, 660, {"locked": True}),
            ("c", 0, "main", 720, 780, {"locked": True}),
        ],
        constraints=Constraints(changeover_minutes=15),
        hours={"main": [(0, 600, 900)], "tent": [(0, 600, 900)]},
    )
    return festival, make_matrix(["a", "b", "c"], {("a", "b"): 0.8})


@pytest.mark.parametrize(
    ("limits", "expected"),
    [
        pytest.param({}, ("main", 795, 855), id="free to move to the main stage"),
        pytest.param({"not_after": 660}, ("tent", 660, 720), id="latest start 11:00"),
        pytest.param({"stages": ["tent"]}, ("tent", 840, 900), id="tent only"),
        pytest.param({"stage_locked": True}, ("tent", 840, 900), id="stage locked"),
        pytest.param({"not_after": 660, "stages": ["tent"]}, ("tent", 660, 720), id="both"),
    ],
)
def test_every_optimizer_option_keeps_the_undercard_inside_its_limits(limits, expected):
    festival, matrix = undercard(limits)
    pinned = ScoringConfig(baseline=BaselineStats(samples=1, mean_regret=1.0))
    report = optimize(festival, matrix, config=pinned)
    assert report.status == "improved"
    assert [option.kind for option in report.options] == ["least_regret", "balanced", "fewest_moves"]
    stage_id, start, end = expected
    for option in report.options:
        assert option.metrics.regret == 0.0
        assert option.timetable[0] == festival.timetable[0].model_copy(
            update={"stage_id": stage_id, "start": start, "end": end}
        )
        assert option.timetable[1:] == festival.timetable[1:]


@given(festival_cases(windows=True))
@PROPERTY
def test_candidate_and_random_moves_never_break_a_start_window_or_stage_list(case):
    festival, _ = case
    layout = Layout.from_festival(festival)
    assert conflicts(festival) == []
    everyone = [True] * layout.rules.n_sets  # locked and frozen sets too
    movable = [i for i in range(layout.rules.n_sets) if not layout.frozen[i]]
    rng = random.Random(5)
    for _ in range(4):
        for move in candidate_moves(layout, everyone):
            assert limit_breaks(festival, layout, move) == []
        for _ in range(15 if movable else 0):
            move = random_move(layout, movable, rng)
            if move is None:
                continue
            assert limit_breaks(festival, layout, move) == []
            if layout.is_feasible(move):
                layout.apply(move)
    assert conflicts(festival, slots_of(festival, layout)) == []


def nearby_moves(layout: Layout, rng: random.Random, count: int) -> list[Move]:
    """Single-set moves to a random stage, a little earlier or later than now or anywhere in its hours."""
    rules = layout.rules
    moves = []
    while len(moves) < count:
        i = rng.randrange(rules.n_sets)
        day = rng.randrange(rules.n_days) if rules.allow_day_moves else rules.home_day[i]
        stage = rng.randrange(rules.n_stages)
        first, last = rules.open[day][stage], rules.latest_end(day, stage) - rules.dur[i]
        if first > last:
            continue
        shifted = layout.start[i] + rng.choice((-30, -10, 10, 30, 60))
        start = rng.choice((rng.randint(first, last), min(max(shifted, first), last)))
        moves.append(Move((i,), ((day, stage, start),)))
    return moves


@given(festival_cases(windows=True))
@PROPERTY
def test_feasibility_agrees_with_the_brute_force_checker_under_windows_and_stage_lists(case):
    festival, _ = case
    layout = Layout.from_festival(festival)
    rules = layout.rules
    candidates = list(candidate_moves(layout, [not frozen for frozen in layout.frozen]))
    random.Random(6).shuffle(candidates)
    for move in candidates[:40] + nearby_moves(layout, random.Random(7), 60):
        structural = all(
            not layout.frozen[i]
            and (not rules.stage_locked[i] or stage == layout.stage[i])
            and (rules.allow_day_moves or day == rules.home_day[i])
            for i, (day, stage, _) in zip(move.sets, move.to, strict=True)
        )
        after = layout.copy()
        after.apply(move)
        clean = conflicts(festival, slots_of(festival, after)) == []
        assert layout.is_feasible(move) == (structural and clean)


@given(festival_cases(windows=True))
@settings(PROPERTY, max_examples=8)
def test_every_optimizer_option_respects_start_windows_and_stage_lists(case):
    festival, matrix = case
    config = ScoringConfig(baseline_samples=40, seed=2)
    report = optimize(festival, matrix, weight=0.6, move_budget=4, config=config)
    for option in report.options:
        assert conflicts(festival, option.timetable) == []
        for before, after in zip(festival.timetable, option.timetable, strict=True):
            limits = ("act_id", "locked", "stage_locked", "not_before", "not_after", "stages")
            assert after.model_dump(include=set(limits)) == before.model_dump(include=set(limits))
            if before.locked:
                assert after == before
            if before.stage_locked:
                assert after.stage_id == before.stage_id
        Festival.model_validate(
            {**festival.model_dump(), "timetable": [s.model_dump() for s in option.timetable]}
        )


@given(festival_cases())
@PROPERTY
def test_stage_locked_offers_the_same_moves_as_a_list_of_its_own_stage(case):
    festival, _ = case
    data = festival.model_dump()
    for item in data["timetable"]:
        if item["stage_locked"]:
            item["stage_locked"] = False
            item["stages"] = [item["stage_id"]]
    listed = Festival.model_validate(data)
    locked_layout, listed_layout = Layout.from_festival(festival), Layout.from_festival(listed)
    everyone = [True] * locked_layout.rules.n_sets
    moves = list(candidate_moves(locked_layout, everyone))
    assert moves == list(candidate_moves(listed_layout, everyone))
    assert [locked_layout.is_feasible(m) for m in moves] == [listed_layout.is_feasible(m) for m in moves]
