"""White-box checks of the move engine against slow, obviously correct reference calculations."""

import random
from collections import defaultdict

import pytest
from hypothesis import given
from schedule_support import PROPERTY, conflicts, festival_cases, make_festival, make_matrix, slots_of

from app.schedule.layout import Layout, Move, Placement
from app.schedule.metrics import build_scorer
from app.schedule.models import Constraints, Festival, ScoringConfig
from app.schedule.moves import (
    Objective,
    candidate_moves,
    free_windows,
    grid_moves,
    random_move,
    slot_window,
)
from app.schedule.synthetic import synthetic_festival


def mixed_weights(festival: Festival, matrix, weight: float = 0.4):
    """Regret and split pair weights blended like the optimizer does (entries of both signs)."""
    layout = Layout.from_festival(festival)
    scorer = build_scorer(festival, matrix, ScoringConfig(), layout)
    n = layout.rules.n_sets
    return layout, [
        [weight * scorer.regret_w[i][k] - (1 - weight) * 3 * scorer.split_w[i][k] for k in range(n)]
        for i in range(n)
    ]


def sample_moves(layout: Layout, count: int, seed: int) -> list[Move]:
    movable = [not layout.frozen[i] for i in range(layout.rules.n_sets)]
    moves = list(candidate_moves(layout, movable))
    random.Random(seed).shuffle(moves)
    return moves[:count]


@given(festival_cases())
@PROPERTY
def test_incremental_delta_matches_a_full_rescore(case):
    festival, matrix = case
    layout, weights = mixed_weights(festival, matrix)
    objective = Objective(layout, weights)
    before = layout.pair_sums([weights])[0]
    assert objective.total() == pytest.approx(before, abs=1e-9)
    for move in sample_moves(layout, 60, seed=1):
        if not layout.is_feasible(move):
            continue
        after = layout.copy()
        after.apply(move)
        expected = after.pair_sums([weights])[0] - before
        assert objective.delta(move) == pytest.approx(expected, abs=1e-9)


@given(festival_cases())
@PROPERTY
def test_feasibility_agrees_with_an_independent_brute_force_checker(case):
    festival, _ = case
    layout = Layout.from_festival(festival)
    assert conflicts(festival) == []
    rules = layout.rules
    for move in sample_moves(layout, 80, seed=2):
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


@given(festival_cases())
@PROPERTY
def test_random_feasible_moves_keep_every_index_consistent(case):
    festival, _ = case
    layout = Layout.from_festival(festival)
    rng = random.Random(3)
    movable = [i for i in range(layout.rules.n_sets) if not layout.frozen[i]]
    if not movable:
        return
    for _ in range(60):
        move = random_move(layout, movable, rng)
        if move is not None and layout.is_feasible(move):
            layout.apply(move)
    rebuilt = layout.with_placements(layout.snapshot())
    assert layout.by_day == rebuilt.by_day
    assert layout.by_slot == rebuilt.by_slot
    for members in layout.by_slot.values():
        assert [layout.start[i] for i in members] == sorted(layout.start[i] for i in members)
    assert conflicts(festival, slots_of(festival, layout)) == []


def test_locked_sets_are_never_offered_a_feasible_move():
    festival, _ = synthetic_festival(7)
    layout = Layout.from_festival(festival)
    locked = [i for i in range(layout.rules.n_sets) if layout.rules.locked[i]]
    assert locked
    everyone = [True] * layout.rules.n_sets  # ask for moves of locked sets too
    offered = [m for m in candidate_moves(layout, everyone) if set(m.sets) & set(locked)]
    assert offered
    assert not any(layout.is_feasible(m) for m in offered)


def test_windows_respect_changeover_and_stage_hours():
    festival = make_festival(
        [("a", 0, "main", 600, 660), ("b", 0, "main", 720, 780), ("c", 0, "side", 600, 630)],
        constraints=Constraints(changeover_minutes=15),
        hours={"main": [(0, 540, 900)], "side": [(0, 540, 900)]},
    )
    layout = Layout.from_festival(festival)
    a, b, c = 0, 1, 2
    assert slot_window(layout, a) == (540, 705)  # opens at 540, must end 15 minutes before b starts
    assert slot_window(layout, b) == (675, 900)  # starts 15 minutes after a ends, runs to closing
    assert slot_window(layout, c) == (540, 900)
    assert free_windows(layout, c, 0, 0) == [(540, 585), (675, 705), (795, 900)]


def test_windows_too_short_for_the_set_are_left_out_and_not_before_trims_them():
    festival = make_festival(
        [
            ("a", 0, "main", 600, 660),
            ("b", 0, "main", 720, 780),
            ("c", 0, "side", 600, 650, {"not_before": 700}),
        ],
        constraints=Constraints(changeover_minutes=15),
        hours={"main": [(0, 540, 900)], "side": [(0, 540, 900)]},
    )
    layout = Layout.from_festival(festival)
    assert free_windows(layout, 2, 0, 0) == [(795, 900)]  # 45- and 30-minute gaps cannot hold 50 minutes
    assert free_windows(layout, 2, 0, 1) == [(700, 900)]  # its own stage, trimmed by not_before


def test_a_pre_existing_violation_is_tolerated_and_freezes_its_sets():
    festival = make_festival(
        [("a", 0, "main", 600, 660), ("b", 0, "main", 665, 725), ("c", 0, "side", 600, 660)]
    )
    layout = Layout.from_festival(festival)
    assert layout.issues() == [("gap", 0, 1)]
    assert layout.frozen == (True, True, False)
    assert layout.tolerated == frozenset({("gap", 0, 1)})
    move_a = Move((0,), ((0, 0, 700),))
    assert not layout.is_feasible(move_a)  # frozen, even though it would fix the violation


def test_swaps_are_offered_only_where_both_durations_fit_the_other_slot():
    festival = make_festival(
        [
            ("a", 0, "main", 600, 660),
            ("b", 0, "main", 675, 735),
            ("c", 0, "side", 600, 690),
            ("d", 0, "side", 705, 765),
        ],
        constraints=Constraints(changeover_minutes=15),
    )
    layout = Layout.from_festival(festival)
    a, b, c, d = range(4)
    main, side = 0, 1
    # Slot windows (program window 600-765, 15 minute changeover): a 600-660, b 675-765, c 600-690, d 705-765.
    swaps = [m for m in candidate_moves(layout, [True] * 4) if len(m.sets) == 2]
    by_pair: dict[frozenset[int], list[dict[int, Placement]]] = defaultdict(list)
    for move in swaps:
        by_pair[frozenset(move.sets)].append(dict(zip(move.sets, move.to, strict=True)))
    # The 90 minute c cannot take a's 60 minute slot, so a and c never swap.
    assert by_pair == {
        frozenset({a, b}): [{b: (0, main, 600), a: (0, main, 675)}],  # same stage: b opens, a closes
        frozenset({a, d}): [{a: (0, side, 705), d: (0, main, 600)}],
        frozenset({b, c}): [
            {b: (0, side, 600), c: (0, main, 675)},  # b starts where c started
            {b: (0, side, 630), c: (0, main, 675)},  # b ends where c ended (690)
        ],  # c ending at 735 would start at 645, inside a's changeover, so both variants push it to 675
        frozenset({b, d}): [{b: (0, side, 705), d: (0, main, 675)}],
        frozenset({c, d}): [{d: (0, side, 600), c: (0, side, 675)}],  # same stage: d opens, c closes
    }
    for move in swaps:
        assert layout.is_feasible(move)
        after = layout.copy()
        after.apply(move)
        assert conflicts(festival, slots_of(festival, after)) == []


def test_sets_moved_onto_a_tied_start_are_indexed_like_a_fresh_layout():
    festival = make_festival(
        [("a", 0, "main", 700, 760), ("b", 0, "side", 600, 660)],
        constraints=Constraints(changeover_minutes=15),
    )
    layout = Layout.from_festival(festival)
    a, b = 0, 1
    assert layout.by_day == [[b, a]]
    move = Move((b,), ((0, 1, 700),))  # side stage; b now starts at 700, the same minute as a
    assert layout.is_feasible(move)
    layout.apply(move)
    assert layout.by_day == [[a, b]]  # a tie goes to the lower set index, whatever the order before
    assert layout.by_slot == {(0, 0): [a], (0, 1): [b]}
    assert layout.concurrent_pairs() == [(a, b, 60)]
    fresh = layout.copy()
    assert (fresh.by_day, fresh.by_slot, fresh.concurrent_pairs()) == (
        layout.by_day,
        layout.by_slot,
        layout.concurrent_pairs(),
    )


# ------------------------------------------------------------------------------------------- thaw


def broken_rule_day(*, locked_partner: bool = False):
    """a (main) and b (side) overlap and may not: their rule is broken before anything moves. c and d are
    bystanders. With ``locked_partner`` b is locked in place."""
    return make_festival(
        [
            ("a", 0, "main", 600, 660),
            ("b", 0, "side", 620, 680, {"locked": True} if locked_partner else {}),
            ("c", 0, "tent", 600, 660),
            ("d", 0, "main", 900, 960),
        ],
        constraints=Constraints(no_clash_with=[("a", "b")], changeover_minutes=15),
        hours={"main": [(0, 540, 1100)], "side": [(0, 540, 1100)], "tent": [(0, 540, 1100)]},
    )


def every_move(layout: Layout, i: int) -> list[Move]:
    """Every gap move of set ``i`` on the 5-minute grid, and every swap, as the engine would offer."""
    movable = [k == i for k in range(layout.rules.n_sets)]
    return [*grid_moves(layout, i, step=5), *candidate_moves(layout, movable)]


def clean_after(festival: Festival, layout: Layout, move: Move) -> bool:
    after = layout.copy()
    after.apply(move)
    return conflicts(festival, slots_of(festival, after)) == []


def test_by_default_a_standing_break_freezes_its_sets():
    festival = broken_rule_day()
    layout = Layout.from_festival(festival)
    assert layout.issues() == [("no_clash", 0, 1)]
    assert layout.frozen == (True, True, False, False) and layout.thawed == (False,) * 4
    assert not any(layout.is_feasible(m) for i in (0, 1) for m in every_move(layout, i))
    assert Layout.from_festival(festival, thaw=False).frozen == layout.frozen


def test_thawed_sets_move_only_to_places_that_end_their_break():
    festival = broken_rule_day()
    layout = Layout.from_festival(festival, thaw=True)
    assert layout.frozen == (False,) * 4 and layout.thawed == (True, True, False, False)
    assert layout.tolerated == frozenset({("no_clash", 0, 1)})
    for i in (0, 1):
        moves = every_move(layout, i)
        assert moves
        feasible = [m for m in moves if layout.is_feasible(m)]
        assert feasible  # a place that ends the break exists
        # Exactly the moves after which the whole day is clean: none that merely keeps the overlap
        assert feasible == [m for m in moves if clean_after(festival, layout, m)]
        keeps = [m for m in moves if not clean_after(festival, layout, m)]
        assert keeps and not any(layout.is_feasible(m) for m in keeps)
    # The bystanders are free as ever, and a move of one may not add to the break
    assert any(layout.is_feasible(m) for m in every_move(layout, 2))


def test_a_move_of_another_set_may_leave_the_break_standing():
    """Only the thawed sets must end their part in the break; moving a bystander keeps it tolerated."""
    layout = Layout.from_festival(broken_rule_day(), thaw=True)
    move = Move((3,), ((0, 0, 1000),))  # d, a bystander on main, an hour later
    assert layout.is_feasible(move)


def test_a_locked_set_stays_frozen_when_thawed():
    festival = broken_rule_day(locked_partner=True)
    layout = Layout.from_festival(festival, thaw=True)
    assert layout.frozen == (False, True, False, False) and layout.thawed == (True, False, False, False)
    assert not any(layout.is_feasible(m) for m in every_move(layout, 1))
    assert any(layout.is_feasible(m) for m in every_move(layout, 0))  # a can still end the break by moving


def test_thaw_survives_copy_and_with_placements():
    layout = Layout.from_festival(broken_rule_day(), thaw=True)
    for twin in (layout.copy(), layout.with_placements(layout.snapshot())):
        assert twin.thawed == layout.thawed and twin.frozen == layout.frozen
        assert twin.tolerated == layout.tolerated


@given(festival_cases(windows=True))
@PROPERTY
def test_thaw_changes_nothing_on_a_day_with_no_standing_break(case):
    festival, _ = case
    plain, thawed = Layout.from_festival(festival), Layout.from_festival(festival, thaw=True)
    assert plain.issues() == [] and thawed.thawed == (False,) * plain.rules.n_sets
    assert (thawed.frozen, thawed.tolerated, thawed.snapshot()) == (
        plain.frozen,
        plain.tolerated,
        plain.snapshot(),
    )
    for i in range(plain.rules.n_sets):
        for move in every_move(plain, i)[:25]:
            assert plain.is_feasible(move) == thawed.is_feasible(move)


def test_optimize_keeps_default_numbers_and_its_baseline_with_or_without_thaw():
    from app.schedule.optimizer import optimize

    festival, matrix = synthetic_festival(7, days=1, acts=14)
    plain = optimize(festival, matrix, 1.0, 4)
    thawed = optimize(festival, matrix, 1.0, 4, thaw=True)
    for report in (plain, thawed):
        report.elapsed_ms = 0
    assert thawed.model_dump() == plain.model_dump()


def test_optimize_with_thaw_ends_a_standing_break_and_without_it_cannot():
    from app.schedule.optimizer import optimize

    festival = broken_rule_day()
    matrix = make_matrix(["a", "b", "c", "d"], {("a", "b"): 0.9, ("c", "d"): 0.2}, default=0.4)
    stuck = optimize(festival, matrix, 1.0, 4)
    assert stuck.movability.frozen_by_existing_violations == 2
    assert all(m.name not in ("A", "B") for option in stuck.options for m in option.moves)
    freed = optimize(festival, matrix, 1.0, 4, thaw=True)
    assert freed.movability.frozen_by_existing_violations == 0
    final = next(o for o in freed.options if o.kind == "balanced")
    assert final.improved and {m.name for m in final.moves} & {"A", "B"}
    assert conflicts(festival, final.timetable) == []  # the plan ends the break
