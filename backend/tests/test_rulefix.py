"""The rule search: the smallest changes this search found that end an overlap between two sets.

Every change is re-checked here without the engine's own feasibility code: the moved timetable is rebuilt as a
validated ``Festival``, the independent brute-force checker lists its violations, and the score comes from
``score_festival``. "Adds no new break" is not "every rule passes": one day below already breaks a rule and
the changes keep that break.
"""

import json

import pytest
from hypothesis import given

from app.agent.clash_tools import MOVE_GRID_MINUTES, PlanMove, apply_plan
from app.schedule import rulefix
from app.schedule.layout import Layout
from app.schedule.metrics import score_festival, shared_minutes
from app.schedule.models import Festival, ScoringConfig, parse_minutes
from tests.schedule_support import PROPERTY, conflicts, festival_cases, make_festival, make_matrix

ALL_DAY = [(0, 600, 960)]
HOURS = {"main": ALL_DAY, "side": ALL_DAY, "tent": ALL_DAY}


def day_sets(extra=(), locked=()):
    """Nine sets in three blocks. A (main) and B (side) share 30 minutes. Stages are open 10:00-16:00, so
    the only free time long enough for a one-hour set is the tail after 15:00 on the side stage."""
    sets = [
        ("a", 0, "main", 600, 660),
        ("b", 0, "side", 630, 690),
        ("g", 0, "tent", 600, 645),
        ("c", 0, "main", 720, 780),
        ("d", 0, "side", 720, 765),
        ("h", 0, "tent", 720, 780),
        ("e", 0, "main", 840, 900),
        ("f", 0, "side", 840, 885),
        ("i", 0, "tent", 840, 900),
        *extra,
    ]
    return [(*s, {"locked": True}) if s[0] in locked else s for s in sets]


def build(sets=None, *, constraints=None, hours=HOURS):
    sets = day_sets() if sets is None else sets
    festival = make_festival(sets, hours=hours, constraints=constraints)
    matrix = make_matrix([s[0] for s in sets], {("a", "b"): 0.9}, default=0.3)
    report = score_festival(festival, matrix, ScoringConfig(baseline_samples=60))
    return festival, matrix, ScoringConfig(baseline=report.baseline)


def search(festival, matrix, config, a="a", b="b", *, keep=10_000):
    previous = rulefix.KEPT_FIXES
    rulefix.KEPT_FIXES = keep
    try:
        return rulefix.rule_fixes(festival, matrix, config, a, b)
    finally:
        rulefix.KEPT_FIXES = previous


def moved_festival(festival: Festival, fix: dict) -> Festival:
    """The published day with the fix's moves taken, as a validated Festival (it rejects a stage overlap)."""
    data = festival.model_dump()
    for move in fix["moves"]:
        slot = next(s for s in data["timetable"] if s["act_id"] == move["act_id"])
        duration = slot["end"] - slot["start"]
        start = parse_minutes(move["start"])
        slot.update(stage_id=move["stage_id"], day=move["day"], start=start, end=start + duration)
    return Festival.model_validate(data)


def shared_after(festival: Festival, a: str, b: str) -> int:
    slots = {s.act_id: s for s in festival.timetable}
    return shared_minutes(slots[a], slots[b])


def check_fix(festival, matrix, config, fix, a="a", b="b"):
    """Everything a returned change must satisfy, re-derived without the search's own code."""
    moved = moved_festival(festival, fix)
    assert shared_after(moved, a, b) == 0
    assert set(conflicts(moved)) <= set(conflicts(festival))  # no new break (the day's own breaks stay)
    locked = {s.act_id for s in festival.timetable if s.locked}
    assert not locked & {m["act_id"] for m in fix["moves"]}
    report = score_festival(moved, matrix, config)
    assert fix["budget_after"] == report.metrics.clash_budget_index
    assert fix["stage_fit_flags_after"] == len(report.stage_fit)
    assert fix["stage_fit_flags_now"] == len(score_festival(festival, matrix, config).stage_fit)
    assert fix["sets_moved"] == len(fix["moves"])
    assert fix["minutes_moved"] == sum(m["minutes_moved"] for m in fix["moves"])
    published = {s.act_id: s for s in festival.timetable}
    after = {s.act_id: s for s in moved.timetable}
    assert fix["stage_changes"] == sum(
        published[m["act_id"]].stage_id != after[m["act_id"]].stage_id for m in fix["moves"]
    )
    for move in fix["moves"]:
        assert move["minutes_moved"] == abs(after[move["act_id"]].start - published[move["act_id"]].start)


def single_place_oracle(festival: Festival, mover: str, partner: str) -> set[tuple[str, int]]:
    """Every (stage, start) on the 5-minute grid where the mover alone shares no minute with the partner and
    the day holds no break it did not hold, by brute force over rebuilt days."""
    slots = {s.act_id: s for s in festival.timetable}
    old = slots[mover]
    allowed = set()
    for stage in festival.stages:
        for start in range(0, 1440, MOVE_GRID_MINUTES):
            if (stage.id, start) == (old.stage_id, old.start):
                continue
            data = festival.model_dump()
            slot = next(s for s in data["timetable"] if s["act_id"] == mover)
            slot.update(stage_id=stage.id, start=start, end=start + old.duration)
            try:
                moved = Festival.model_validate(data)
            except ValueError:
                continue
            if shared_after(moved, mover, partner) == 0 and set(conflicts(moved)) <= set(conflicts(festival)):
                allowed.add((stage.id, start))
    return allowed


def test_the_grid_is_the_what_if_grid_and_the_search_says_what_it_covered():
    assert rulefix.GRID_MINUTES == MOVE_GRID_MINUTES == 5
    searched = rulefix.SEARCHED
    assert (
        "5-minute grid" in searched and "swaps" in searched and "longer chains were not searched" in searched
    )
    assert "every rule" not in searched.lower() and "passes" not in searched.lower()


def test_single_places_are_exactly_the_places_a_brute_force_finds_and_swaps_follow_them():
    festival, matrix, config = build()
    found = search(festival, matrix, config)
    singles = [fix for fix in found["fixes"] if fix["sets_moved"] == 1]
    moves = {(m["act_id"], m["stage_id"], parse_minutes(m["start"])) for f in singles for m in f["moves"]}
    expected = {("a", s, t) for s, t in single_place_oracle(festival, "a", "b")} | {
        ("b", s, t) for s, t in single_place_oracle(festival, "b", "a")
    }
    assert expected and moves == expected
    assert found["single_set_places"] == len(expected)
    assert found["fixes_found"] == len(found["fixes"]) > len(singles)  # swaps too
    assert any(fix["sets_moved"] == 2 for fix in found["fixes"])
    for fix in found["fixes"]:
        check_fix(festival, matrix, config, fix)


def test_both_moved_sets_of_a_swap_are_rechecked():
    # The set that swaps in must not end up past a curfew or outside its own start window
    festival, matrix, config = build(
        day_sets(),
        constraints={"curfew": {0: 960}, "changeover_minutes": 15},
    )
    data = festival.model_dump()
    for slot in data["timetable"]:
        if slot["act_id"] in {"e", "f", "i"}:
            slot["not_after"] = slot["start"]  # the late block may not start later than it does now
    festival = Festival.model_validate(data)
    found = search(festival, matrix, config)
    assert found["fixes"]
    for fix in found["fixes"]:
        check_fix(festival, matrix, config, fix)
        for move in fix["moves"]:
            if move["act_id"] in {"e", "f", "i"}:
                assert parse_minutes(move["start"]) <= {"e": 840, "f": 840, "i": 840}[move["act_id"]]


def test_the_day_may_already_break_a_rule_and_a_change_adds_none():
    # i and l are 5 minutes apart on the tent stage: a changeover break the published day already has
    festival, matrix, config = build(day_sets(extra=[("l", 0, "tent", 905, 950)]))
    published = set(conflicts(festival))
    assert any("changeover between i and l" in c for c in published)
    found = search(festival, matrix, config)
    assert found["fixes"]
    kept = 0
    for fix in found["fixes"]:
        check_fix(festival, matrix, config, fix)
        if set(conflicts(moved_festival(festival, fix))) == published:
            kept += 1
    assert kept > 0  # the break stays: "no new break" is what is checked, not "every rule passes"


def test_a_locked_set_never_moves_and_the_other_one_does():
    festival, matrix, config = build(day_sets(locked=("a",)))
    found = search(festival, matrix, config)
    assert found["a"]["locked"] is True and found["b"]["locked"] is False
    assert found["fixes"]
    for fix in found["fixes"]:
        check_fix(festival, matrix, config, fix)
        assert "a" not in {m["act_id"] for m in fix["moves"]}
        assert "b" in {m["act_id"] for m in fix["moves"]}  # a swap of a with another set is not on offer
    reverse = search(festival, matrix, config, "b", "a")
    assert reverse["a"]["act_id"] == "b" and reverse["fixes"] == found["fixes"]


def test_two_locked_sets_have_no_fixes_and_the_search_does_not_run(monkeypatch):
    festival, matrix, config = build(day_sets(locked=("a", "b")))
    monkeypatch.setattr(rulefix, "build_scorer", lambda *a, **k: pytest.fail("the search ran"))
    found = rulefix.rule_fixes(festival, matrix, config, "a", "b")
    assert found["a"]["locked"] and found["b"]["locked"]
    assert found["holds"] is False and found["shared_minutes"] == 30
    assert found["fixes"] == [] and found["fixes_found"] == 0 and found["single_set_places"] == 0


def test_a_pair_that_shares_no_minute_holds_with_no_search(monkeypatch):
    festival, matrix, config = build()
    monkeypatch.setattr(rulefix, "build_scorer", lambda *a, **k: pytest.fail("the search ran"))
    monkeypatch.setattr(rulefix, "grid_moves", lambda *a, **k: pytest.fail("the search ran"))
    found = rulefix.rule_fixes(festival, matrix, config, "a", "c")
    assert found["holds"] is True and found["shared_minutes"] == 0
    assert found["fixes"] == [] and found["fixes_found"] == 0 and found["single_set_places"] == 0
    other_day = make_festival([("a", 0, "main", 600, 660), ("b", 1, "side", 600, 660)], days=2)
    assert rulefix.published_shared(other_day, "a", "b") == 0


def test_the_order_is_sets_then_minutes_then_stage_changes_then_budget_then_ids():
    festival, matrix, config = build()
    fixes = search(festival, matrix, config)["fixes"]
    keys = [
        (
            f["sets_moved"],
            f["minutes_moved"],
            f["stage_changes"],
            f["budget_after"],
            tuple(sorted(m["act_id"] for m in f["moves"])),
        )
        for f in fixes
    ]
    assert keys == sorted(keys) and len(set(keys)) > 1
    assert [f["sets_moved"] for f in fixes] == sorted(f["sets_moved"] for f in fixes)
    # the pair's own set comes first in a swap
    for fix in fixes:
        if fix["sets_moved"] == 2:
            assert fix["moves"][0]["act_id"] in {"a", "b"}


def test_only_the_first_few_changes_are_kept_and_the_rest_are_counted():
    festival, matrix, config = build()
    everything = search(festival, matrix, config)
    kept = rulefix.rule_fixes(festival, matrix, config, "a", "b")
    assert len(kept["fixes"]) == rulefix.KEPT_FIXES == 5
    assert kept["fixes_found"] == everything["fixes_found"] > 5
    assert kept["fixes"] == everything["fixes"][:5]


def test_a_one_set_change_prices_as_apply_plan_does():
    festival, matrix, config = build()
    found = search(festival, matrix, config)
    singles = [f for f in found["fixes"] if f["sets_moved"] == 1]
    assert singles
    for fix in singles:
        move = fix["moves"][0]
        plan = apply_plan(
            festival,
            matrix,
            config,
            [PlanMove(move["act_id"], move["stage_id"], move["day"], parse_minutes(move["start"]))],
        )
        assert plan.steps[0].budget_after == fix["budget_after"]


def test_a_pair_the_day_already_holds_apart_as_a_rule_is_searched_the_same():
    festival, matrix, config = build()
    base = search(festival, matrix, config)
    held = festival.model_copy(
        update={"constraints": festival.constraints.model_copy(update={"no_clash_with": [("b", "a")]})}
    )
    published = {Layout.from_festival(held).rules.act_ids[i[1]] for i in Layout.from_festival(held).issues()}
    assert published  # the rule is already broken on the published day
    again = search(held, matrix, config)
    assert again["fixes"] == base["fixes"]


def test_the_answer_carries_no_taste_overlap_popularity_or_matrix():
    festival, matrix, config = build()
    text = json.dumps(search(festival, matrix, config))
    for banned in ("matrix", "affinity", "overlap_out_of", "popularity", "draw"):
        assert banned not in text


@PROPERTY
@given(festival_cases(windows=True))
def test_every_change_on_random_days_is_legal_when_checked_independently(case):
    festival, matrix = case
    config = ScoringConfig(
        baseline=score_festival(festival, matrix, ScoringConfig(baseline_samples=30)).baseline
    )
    layout = Layout.from_festival(festival)
    pairs = layout.concurrent_pairs()[:3]
    ids = layout.rules.act_ids
    for i, k, _ in pairs:
        found = search(festival, matrix, config, ids[i], ids[k])
        assert found["fixes_found"] == len(found["fixes"])
        for fix in found["fixes"]:
            check_fix(festival, matrix, config, fix, ids[i], ids[k])
