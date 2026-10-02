import math

import pytest
from schedule_support import make_festival, make_matrix

from app.schedule.layout import Layout
from app.schedule.metrics import (
    DRAW_PRIOR,
    build_scorer,
    clash_budget_index,
    concurrency,
    draw_balance,
    draw_of,
    estimate_baseline,
    pair_draw,
    pair_regret,
    pair_split,
    quantile,
    regret_weight,
    score_festival,
    shared_minutes,
    split_weight,
    top_draw_tier,
)
from app.schedule.models import Act, ScheduleInputError, ScoringConfig, SetSlot
from app.schedule.synthetic import synthetic_festival

NO_BASELINE = ScoringConfig(baseline_samples=0)
EXTRA_STAGES = {"s1": 1, "s2": 2, "s3": 2, "s4": 3, "s5": 3}


def slot(act_id: str, stage: str, start: str, end: str, day: int = 0) -> SetSlot:
    return SetSlot(act_id=act_id, day=day, stage_id=stage, start=start, end=end)


class TestConcurrency:
    def test_partial_overlap_is_shared_minutes_over_the_shorter_set(self):
        a, b = slot("a", "main", "18:00", "19:00"), slot("b", "side", "18:30", "19:30")
        assert shared_minutes(a, b) == 30
        assert concurrency(a, b) == 0.5

    def test_a_contained_set_is_fully_concurrent(self):
        long, short = slot("a", "main", "18:00", "20:00"), slot("b", "side", "18:30", "19:00")
        assert concurrency(long, short) == 1.0
        assert concurrency(short, long) == 1.0

    def test_back_to_back_sets_do_not_clash(self):
        assert concurrency(slot("a", "main", "18:00", "19:00"), slot("b", "side", "19:00", "20:00")) == 0.0

    def test_sets_on_different_days_never_clash(self):
        a, b = slot("a", "main", "18:00", "19:00"), slot("b", "side", "18:00", "19:00", day=1)
        assert shared_minutes(a, b) == 0
        assert concurrency(a, b) == 0.0

    def test_sets_on_the_same_stage_have_no_concurrency(self):
        assert concurrency(slot("a", "main", "18:00", "19:00"), slot("b", "main", "18:30", "19:30")) == 0.0


class TestPairFormulas:
    def test_draw_is_popularity_or_a_billing_tier_prior(self):
        assert draw_of(Act(id="a", name="A", popularity=0.42, billing_tier=1)) == 0.42
        for tier, prior in DRAW_PRIOR.items():
            assert draw_of(Act(id="a", name="A", billing_tier=tier)) == prior
        assert DRAW_PRIOR[1] > DRAW_PRIOR[2] > DRAW_PRIOR[3] > DRAW_PRIOR[4]

    def test_pair_draw_is_the_geometric_mean(self):
        assert pair_draw(0.81, 1.0) == pytest.approx(0.9)
        assert pair_draw(0.4, 0.4) == pytest.approx(0.4)

    def test_draw_balance_is_the_ratio_of_the_smaller_draw_to_the_larger(self):
        assert draw_balance(0.8, 0.4) == 0.5
        assert draw_balance(0.4, 0.8) == 0.5
        assert draw_balance(0.0, 0.0) == 0.0

    def test_regret_weight_with_neutral_rarity_is_overlap_times_draw(self):
        assert regret_weight(0.6, 0.81, 1.0, 0.5, 0.5) == pytest.approx(0.54)

    def test_rarity_scales_regret_between_half_and_one_and_a_half(self):
        base = regret_weight(0.6, 0.81, 1.0, 0.5, 0.5)
        assert regret_weight(0.6, 0.81, 1.0, 0.9, 0.7) == pytest.approx(0.6 * 0.9 * 1.3)
        assert regret_weight(0.6, 0.81, 1.0, 1.0, 1.0) == pytest.approx(1.5 * base)
        assert regret_weight(0.6, 0.81, 1.0, 0.0, 0.0) == pytest.approx(0.5 * base)

    def test_split_weight_rewards_low_overlap_and_balanced_draws(self):
        assert split_weight(0.1, 0.8, 0.4) == pytest.approx(0.9 * 0.5)
        assert split_weight(0.1, 0.6, 0.6) > split_weight(0.1, 0.8, 0.4)
        assert split_weight(0.1, 0.6, 0.6) > split_weight(0.6, 0.6, 0.6)

    def test_pair_regret_and_split_scale_with_concurrency(self):
        a, b = slot("a", "main", "18:00", "19:00"), slot("b", "side", "18:30", "19:30")
        act_a = Act(id="a", name="A", popularity=0.9)
        act_b = Act(id="b", name="B", popularity=0.4)
        assert pair_regret(a, b, 0.8, act_a, act_b) == pytest.approx(0.8 * 0.5 * 0.6)
        assert pair_split(a, b, 0.1, act_a, act_b) == pytest.approx(0.9 * (0.4 / 0.9) * 0.5)

    def test_clash_budget_index_is_a_percentage_of_the_baseline(self):
        assert clash_budget_index(3.0, 2.0) == 150.0
        assert clash_budget_index(1.0, 2.0) == 50.0
        assert clash_budget_index(1.0, None) is None
        assert clash_budget_index(1.0, 0.0) is None

    def test_quantile_interpolates(self):
        assert quantile([], 0.5) is None
        assert quantile([5.0], 0.9) == 5.0
        assert quantile([0.0, 10.0], 0.25) == 2.5
        assert quantile([1.0, 2.0, 3.0, 4.0, 5.0], 0.5) == 3.0


class TestTopDrawTier:
    def test_takes_the_top_share_of_scored_acts(self):
        draws = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.05]
        flags, cutoff = top_draw_tier(draws, [True] * 10, 0.3)
        assert flags == [True, True, True] + [False] * 7
        assert cutoff == 0.7

    def test_ties_at_the_cutoff_stay_in(self):
        flags, cutoff = top_draw_tier([0.9, 0.9, 0.9, 0.5], [True] * 4, 0.25)
        assert flags == [True, True, True, False]
        assert cutoff == 0.9

    def test_unscored_acts_never_count(self):
        flags, _ = top_draw_tier([0.99, 0.9, 0.8, 0.1], [False, True, True, True], 0.3)
        assert flags == [False, True, True, False]

    def test_needs_at_least_two_scored_acts(self):
        assert top_draw_tier([0.9, 0.8], [True, False], 0.5) == ([False, False], None)


def two_clash_festival():
    """a/b clash 30 of 60 minutes (overlap 0.8); c/d clash fully (overlap 0.1)."""
    festival = make_festival(
        [
            ("a", 0, "main", "18:00", "19:00"),
            ("b", 0, "side", "18:30", "19:30"),
            ("c", 0, "main", "20:00", "21:00"),
            ("d", 0, "side", "20:00", "21:00"),
        ],
        acts={
            "a": {"popularity": 0.9},
            "b": {"popularity": 0.4},
            "c": {"popularity": 0.6},
            "d": {"popularity": 0.6},
        },
    )
    matrix = make_matrix(["a", "b", "c", "d"], {("a", "b"): 0.8, ("c", "d"): 0.1}, default=0.05)
    return festival, matrix


class TestScoring:
    def test_regret_and_split_match_a_hand_calculation(self):
        festival, matrix = two_clash_festival()
        report = score_festival(festival, matrix, NO_BASELINE)
        regret = 0.8 * 0.5 * math.sqrt(0.9 * 0.4) + 0.1 * 1.0 * 0.6
        assert report.metrics.regret == pytest.approx(regret, abs=1e-5)
        assert report.metrics.split_quality == pytest.approx(0.9, abs=1e-5)  # only c/d are both top-draw
        assert report.metrics.scored_concurrent_pairs == 2
        assert report.metrics.unscored_concurrent_pairs == 0
        assert report.metrics.clash_budget_index is None and report.baseline is None
        assert set(report.top_draw_acts) == {"a", "c", "d"}

    def test_pair_functions_agree_with_the_engine(self):
        festival, matrix = two_clash_festival()
        report = score_festival(festival, matrix, NO_BASELINE)
        acts = festival.act_by_id()
        slots = {s.act_id: s for s in festival.timetable}
        first = report.clashes[0]
        expected = pair_regret(slots["a"], slots["b"], 0.8, acts["a"], acts["b"])
        assert first.a.act_id == "a" and first.b.act_id == "b"
        assert first.regret == pytest.approx(expected, abs=1e-5)
        assert first.concurrency == 0.5 and first.overlap_minutes == 30

    def test_clashes_are_ranked_by_regret_with_shares_that_add_up(self):
        festival, matrix = two_clash_festival()
        report = score_festival(festival, matrix, NO_BASELINE)
        assert [c.rank for c in report.clashes] == [1, 2]
        assert report.clashes[0].regret > report.clashes[1].regret
        assert sum(c.regret_share for c in report.clashes) == pytest.approx(1.0, abs=1e-3)
        assert sum(report.regret_by_act.values()) == pytest.approx(2 * report.metrics.regret, abs=1e-4)

    def test_splits_list_only_top_draw_pairs(self):
        festival, matrix = two_clash_festival()
        report = score_festival(festival, matrix, NO_BASELINE)
        assert [(s.a.act_id, s.b.act_id) for s in report.splits] == [("c", "d")]
        assert report.splits[0].split_quality == pytest.approx(0.9, abs=1e-5)

    def test_zero_overlap_pairs_cost_nothing(self):
        festival, _ = two_clash_festival()
        matrix = make_matrix(["a", "b", "c", "d"], {})
        report = score_festival(festival, matrix, NO_BASELINE)
        assert report.metrics.regret == 0.0 and report.clashes == []

    def test_a_matrix_with_none_of_the_scheduled_acts_is_an_input_error(self):
        festival, _ = two_clash_festival()
        with pytest.raises(ScheduleInputError, match="none of the scheduled acts"):
            score_festival(festival, make_matrix(["x", "y"], {("x", "y"): 0.5}), NO_BASELINE)


class TestCoverage:
    def festival(self):
        return make_festival(
            [
                ("a", 0, "main", "18:00", "19:00"),
                ("b", 0, "side", "18:00", "19:00"),
                ("e", 0, "tent", "18:00", "19:00"),
            ]
        )

    def test_a_none_act_is_excluded_not_scored_as_zero_overlap(self):
        festival = self.festival()
        pairs = {("a", "b"): 0.4, ("a", "e"): 0.9, ("b", "e"): 0.9}
        with_signal = score_festival(festival, make_matrix(["a", "b", "e"], pairs), NO_BASELINE)
        without = score_festival(festival, make_matrix(["a", "b", "e"], pairs, {"e": "none"}), NO_BASELINE)
        only_ab = 0.4 * 0.5
        assert without.metrics.regret == pytest.approx(only_ab, abs=1e-5)
        assert with_signal.metrics.regret > without.metrics.regret
        assert without.metrics.scored_concurrent_pairs == 1
        assert without.metrics.unscored_concurrent_pairs == 2
        assert all("e" not in (c.a.act_id, c.b.act_id) for c in without.clashes)
        assert "e" not in without.regret_by_act

    def test_unscored_acts_are_listed_with_a_reason(self):
        festival = self.festival()
        report = score_festival(
            festival, make_matrix(["a", "e"], {("a", "e"): 0.5}, {"e": "none"}), NO_BASELINE
        )
        reasons = {u.act_id: u.reason for u in report.coverage.unscored}
        assert reasons == {"b": "not_in_matrix", "e": "no_signal"}
        assert report.coverage.none == 2 and report.coverage.scored_acts == 1
        assert report.coverage.scored_share == pytest.approx(1 / 3, abs=1e-3)

    def test_weak_acts_are_scored_but_flagged_low_confidence(self):
        festival = self.festival()
        matrix = make_matrix(["a", "b", "e"], {("a", "b"): 0.4}, {"b": "weak"})
        report = score_festival(festival, matrix, NO_BASELINE)
        assert report.metrics.regret > 0
        assert report.clashes[0].confidence == "weak"
        assert report.coverage.weak == 1 and report.coverage.weak_act_ids == ["b"]

    def test_acts_without_a_coverage_entry_count_as_strong(self):
        report = score_festival(self.festival(), make_matrix(["a", "b", "e"], {("a", "b"): 0.4}), NO_BASELINE)
        assert report.coverage.strong == 3
        assert report.clashes[0].confidence == "strong"

    def test_unscored_acts_do_not_make_the_top_draw_tier(self):
        festival = make_festival(
            [("a", 0, "main", 600, 660), ("b", 0, "side", 600, 660), ("c", 0, "tent", 600, 660)],
            acts={"a": {"popularity": 0.99}, "b": {"popularity": 0.5}, "c": {"popularity": 0.4}},
        )
        matrix = make_matrix(["a", "b", "c"], {("a", "b"): 0.2}, {"a": "none"})
        report = score_festival(festival, matrix, NO_BASELINE)
        assert "a" not in report.top_draw_acts


class TestLabels:
    def lineup(self):
        genres = {"a": "rock", "b": " Rock ", "c": "pop", "d": "pop", "e": "jazz"}
        festival = make_festival(
            [(act, 0, stage, "18:00", "19:00") for act, stage in zip("abcde", EXTRA_STAGES, strict=True)],
            stages=EXTRA_STAGES,
            acts={act: {"genre": genre} for act, genre in genres.items()},
        )
        pairs = {
            ("a", "b"): 0.02, ("c", "d"): 0.60, ("a", "c"): 0.90, ("a", "d"): 0.30, ("b", "c"): 0.25,
            ("b", "d"): 0.20, ("a", "e"): 0.10, ("b", "e"): 0.12, ("c", "e"): 0.15, ("d", "e"): 0.05,
        }  # fmt: skip
        return festival, make_matrix(list("abcde"), pairs)

    def test_hidden_clash_is_a_top_decile_overlap_between_different_genres(self):
        festival, matrix = self.lineup()
        report = score_festival(festival, matrix, NO_BASELINE)
        hidden = [c for c in report.clashes if c.label == "hidden"]
        assert [(c.a.act_id, c.b.act_id) for c in hidden] == [("a", "c")]
        assert report.hidden_clash_count == 1
        assert report.thresholds.hidden_overlap == pytest.approx(0.63)

    def test_false_clash_is_a_low_overlap_between_matching_genres(self):
        festival, matrix = self.lineup()
        report = score_festival(festival, matrix, NO_BASELINE)
        assert [(c.a.act_id, c.b.act_id) for c in report.false_clashes] == [("a", "b")]
        assert report.false_clash_count == 1
        assert report.thresholds.false_overlap == pytest.approx(0.105)

    def test_same_genre_with_high_overlap_and_unknown_genres_get_no_label(self):
        festival, matrix = self.lineup()
        report = score_festival(festival, matrix, NO_BASELINE)
        by_pair = {(c.a.act_id, c.b.act_id): c.label for c in report.clashes}
        assert by_pair[("c", "d")] is None  # same genre, high overlap: a real clash, not a false one
        assert by_pair[("a", "e")] is None  # low overlap but different genres
        data = festival.model_dump()
        for act in data["acts"]:
            act["genre"] = None
        blank = score_festival(type(festival).model_validate(data), matrix, NO_BASELINE)
        assert blank.hidden_clash_count == 0 and blank.false_clash_count == 0


class TestStageFit:
    def festival(self, popularity):
        placement = {
            "a": "tent",
            "b": "tent",
            "c": "tent",
            "d": "side",
            "e": "side",
            "f": "side",
            "g": "main",
            "h": "main",
        }
        times = {"a": 600, "b": 700, "c": 800, "d": 600, "e": 700, "f": 800, "g": 600, "h": 700}
        return make_festival(
            [(act, 0, stage, times[act], times[act] + 60) for act, stage in placement.items()],
            acts={act: {"popularity": popularity[act]} for act in placement},
        )

    def test_flags_acts_whose_draw_rank_does_not_fit_their_stage_tier(self):
        popularity = dict(zip("abcdefgh", (0.95, 0.9, 0.85, 0.7, 0.6, 0.5, 0.3, 0.2), strict=True))
        festival = self.festival(popularity)
        report = score_festival(festival, make_matrix(list("abcdefgh"), {}), NO_BASELINE)
        flags = {f.act_id: f for f in report.stage_fit}
        assert set(flags) == {"a", "b", "c", "g", "h"}
        assert {flags[a].direction for a in "abc"} == {"bigger_stage_suggested"}
        assert {flags[a].direction for a in "gh"} == {"smaller_stage_suggested"}
        assert flags["a"].draw_rank == 1 and flags["a"].stage_tier == 3 and flags["a"].lineup_size == 8
        assert "ranks 1 of 8 by draw" in flags["a"].message

    def test_a_well_matched_lineup_raises_no_flags(self):
        popularity = dict(zip("abcdefgh", (0.2, 0.3, 0.5, 0.6, 0.7, 0.85, 0.9, 0.95), strict=True))
        report = score_festival(self.festival(popularity), make_matrix(list("abcdefgh"), {}), NO_BASELINE)
        assert report.stage_fit == []

    def test_a_single_stage_tier_cannot_be_mismatched(self):
        festival = make_festival(
            [("a", 0, "main", 600, 660), ("b", 0, "main", 700, 760), ("c", 0, "main", 800, 860)]
        )
        assert score_festival(festival, make_matrix(["a", "b", "c"], {}), NO_BASELINE).stage_fit == []


class TestMovabilityAndViolations:
    def test_movability_counts_locks_and_unscored_sets(self):
        festival = make_festival(
            [
                ("a", 0, "main", 600, 660, {"locked": True}),
                ("b", 0, "side", 600, 660),
                ("c", 0, "tent", 600, 660),
                ("d", 0, "main", 700, 760),
            ]
        )
        matrix = make_matrix(["a", "b", "c", "d"], {("b", "c"): 0.3}, {"c": "none"})
        movability = score_festival(festival, matrix, NO_BASELINE).movability
        assert (movability.total_sets, movability.locked, movability.unscored, movability.movable) == (
            4,
            1,
            1,
            2,
        )
        assert movability.movable_share == 0.5

    def test_existing_violations_are_reported_and_their_sets_are_frozen(self):
        festival = make_festival(
            [("a", 0, "main", 600, 660), ("b", 0, "main", 665, 725), ("c", 0, "side", 600, 660)]
        )
        report = score_festival(festival, make_matrix(["a", "b", "c"], {("a", "c"): 0.5}), NO_BASELINE)
        assert [v.kind for v in report.violations] == ["gap"]
        assert set(report.violations[0].act_ids) == {"a", "b"}
        assert "changeover" in report.violations[0].message
        assert report.movability.frozen_by_existing_violations == 2

    def test_a_clean_timetable_has_no_violations(self):
        festival, matrix = synthetic_festival(7)
        assert score_festival(festival, matrix, NO_BASELINE).violations == []


class TestBaseline:
    def test_the_same_seed_gives_the_same_baseline(self):
        festival, matrix = synthetic_festival(7)
        config = ScoringConfig(baseline_samples=60, seed=3)
        first = score_festival(festival, matrix, config)
        second = score_festival(festival, matrix, config)
        assert first.baseline == second.baseline
        assert first.metrics == second.metrics

    def test_the_index_is_regret_over_the_baseline_mean(self):
        festival, matrix = synthetic_festival(7)
        report = score_festival(festival, matrix, ScoringConfig(baseline_samples=60))
        assert report.baseline is not None
        expected = 100 * report.metrics.regret / report.baseline.mean_regret
        assert report.metrics.clash_budget_index == pytest.approx(expected, abs=0.01)

    def test_a_pinned_baseline_is_reused_without_sampling(self):
        festival, matrix = synthetic_festival(7)
        first = score_festival(festival, matrix, ScoringConfig(baseline_samples=60))
        again = score_festival(
            festival, matrix, ScoringConfig(baseline=first.baseline, baseline_samples=1000)
        )
        assert again.baseline == first.baseline
        assert again.metrics.clash_budget_index == first.metrics.clash_budget_index

    def test_fresh_random_timetables_average_an_index_near_100(self):
        from app.schedule.sampling import sample_pair_sums

        festival, matrix = synthetic_festival(7)
        layout = Layout.from_festival(festival)
        scorer = build_scorer(festival, matrix, ScoringConfig(), layout)
        baseline = estimate_baseline(layout, scorer, ScoringConfig(baseline_samples=300, seed=1))
        fresh = sample_pair_sums(layout, [scorer.regret_w], 300, seed=99)
        indices = [100 * s[0] / baseline.mean_regret for s in fresh.sums]
        assert sum(indices) / len(indices) == pytest.approx(100, abs=8)

    def test_the_baseline_does_not_depend_on_which_arrangement_is_scored(self):
        """Re-scoring an optimized timetable must not move the dial's reference point."""
        from app.schedule.models import Festival
        from app.schedule.optimizer import optimize

        festival, matrix = synthetic_festival(7)
        config = ScoringConfig(baseline_samples=300, seed=5)
        option = optimize(festival, matrix, 1.0, 6, config).options[0]
        data = festival.model_dump()
        data["timetable"] = [s.model_dump() for s in option.timetable]
        shuffled = Festival.model_validate(data)
        original = score_festival(festival, matrix, config).baseline
        after = score_festival(shuffled, matrix, config).baseline
        assert after is not None and original is not None
        assert after.mean_regret == pytest.approx(original.mean_regret, rel=0.08)

    def test_nothing_to_reshuffle_makes_the_baseline_the_input_itself(self):
        festival, matrix = two_clash_festival()
        data = festival.model_dump()
        for item in data["timetable"]:
            item["locked"] = True
        locked = type(festival).model_validate(data)
        report = score_festival(locked, matrix, ScoringConfig(baseline_samples=20))
        assert report.baseline is not None and report.baseline.degenerate
        assert report.metrics.clash_budget_index == 100.0

    def test_an_unlocked_lineup_gives_a_spread_of_random_timetables(self):
        festival, matrix = synthetic_festival(7)
        report = score_festival(festival, matrix, ScoringConfig(baseline_samples=100))
        baseline = report.baseline
        assert baseline is not None and not baseline.degenerate
        assert baseline.std_regret > 0
        assert baseline.p10_index is not None and baseline.p90_index is not None
        assert baseline.p10_index < 100 < baseline.p90_index
