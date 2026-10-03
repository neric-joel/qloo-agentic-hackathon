"""A rule change kept as one step of a what-if plan: ``{"rule": {"a", "b"}, "moves": [one or two moves]}``.

Pinned here: bodies of single kept moves answer byte-identically to the round-6 code (recorded output on a
synthetic day in ``tests/golden``); a change ``rule_fixes`` lists is accepted as a step and priced as the
search priced it; a step is judged after the whole step, never move by move; the receipt
(``rule_holds_after``, ``new_breaks``) is read on the whole plan; the caps and the memory of illegal plans
work as in round 5; hostile bodies are 422 and echo nothing. Synthetic days only.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from hypothesis import given

from app import whatif
from app.agent.clash_tools import IllegalStep, PlanGroup, PlanMove, apply_plan, compute_move_options
from app.config import Settings, get_settings
from app.limits import RunLimiter
from app.main import app, get_qloo
from app.presets import get_presets
from app.schedule import rulefix
from app.schedule.layout import Layout
from app.schedule.metrics import score_festival
from app.schedule.models import ScoringConfig, parse_minutes
from tests.schedule_support import PROPERTY, festival_cases
from tests.test_rulefix import HOURS, build, day_sets, moved_festival, search, shared_after
from tests.test_whatif import no_qloo
from tests.test_whatif import preset as legacy_day  # noqa: F401  (the synthetic day the golden file records)

GOLDEN = Path(__file__).parent / "golden" / "whatif_round6_plans.json"
NO_STORE = "no-store"
STEP_1 = {"detail": "Step 1 is not a legal place for that set after the steps before it."}
STEP_2 = {"detail": "Step 2 is not a legal place for that set after the steps before it."}
PICK_ONCE = {"detail": "Pick each set once."}
NOT_ON_DAY = {"detail": "That set is not on this festival day."}
RECEIPT_KEYS = {"rule", "moves", "budget_after", "rule_holds_after", "new_breaks"}
MOVED_KEYS = {"act", "act_id", "move", "stage", "stage_id", "day", "start", "end"}


# ------------------------------------------------------------------------------------------- the pins


def test_bodies_of_single_moves_answer_byte_identically_to_round_6(legacy_day):  # noqa: F811
    recorded = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert len(recorded) >= 7
    with TestClient(app) as client:
        for name, case in recorded.items():
            response = client.post("/api/presets/day/whatif", json=case["body"])
            assert response.status_code == case.get("status", 200), name
            assert response.text == case["raw"], name  # the same bytes, key order included
            assert response.headers["cache-control"] == NO_STORE


# ------------------------------------------------------------------------------------- a day with a rule


def write_day(directory, sets=None, *, constraints=None):
    festival, matrix, config = build(sets, constraints=constraints)
    report = score_festival(festival, matrix, config)
    data = {
        "id": "rules",
        "title": "Rules",
        "festival": festival.model_dump(mode="json"),
        "matrix": matrix.model_dump(mode="json"),
        "report": report.model_dump(mode="json"),
    }
    (directory / "rules.json").write_text(json.dumps(data), encoding="utf-8")
    return festival, matrix, config


@pytest.fixture
def day(tmp_path, monkeypatch):
    """The nine-set day of ``test_rulefix``: a and b share 30 minutes, c locked in the lineup of nothing."""
    made = write_day(tmp_path, day_sets(locked=("i",)))
    settings = Settings(presets_dir=tmp_path, _env_file=None)
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_qloo] = no_qloo
    monkeypatch.setattr(whatif, "get_settings", lambda: settings)
    with whatif._cache_lock:
        whatif._cache.clear()
        whatif._plans.clear()
        whatif._illegal.clear()
    whatif._limiter = None
    preset = get_presets(settings)["rules"]
    yield (*made, preset)
    app.dependency_overrides.clear()
    whatif._limiter = None


def post(client: TestClient, steps: list, **extra):
    return client.post("/api/presets/rules/whatif", json={"moves": steps, **extra})


def visits(client: TestClient) -> int:
    return sum(len(v) for v in whatif.get_whatif_limiter()._visitors.values())


def one(act: str, stage: str, start: str, day_: int = 0) -> dict:
    return {"act": act, "stage_id": stage, "day": day_, "start": start}


def rule_step(moves: list[dict], a: str = "a", b: str = "b") -> dict:
    return {"rule": {"a": a, "b": b}, "moves": moves}


def step_of(fix: dict, a: str = "a", b: str = "b") -> dict:
    """A change ``/rule-fixes`` lists, as a rule step."""
    return rule_step([one(m["act_id"], m["stage_id"], m["start"], m["day"]) for m in fix["moves"]], a, b)


def fixes_of(festival, matrix, config, sets_moved: int | None = None, **kw) -> list[dict]:
    found = search(festival, matrix, config, **kw)["fixes"]
    return [f for f in found if sets_moved is None or f["sets_moved"] == sets_moved]


def plan_move(m: dict) -> PlanMove:
    return PlanMove(m["act_id"], m["stage_id"], m["day"], parse_minutes(m["start"]))


def test_a_listed_change_is_a_step_priced_as_the_search_priced_it(day):
    festival, matrix, config, _ = day
    listed = rulefix.rule_fixes(festival, matrix, config, "a", "b")["fixes"]
    assert len(listed) == rulefix.KEPT_FIXES and {f["sets_moved"] for f in listed} == {1, 2}
    with TestClient(app) as client:
        for fix in listed:
            response = post(client, [step_of(fix)])
            assert response.status_code == 200 and response.headers["cache-control"] == NO_STORE
            body = response.json()
            (step,) = body["plan"]["steps"]
            assert set(step) == RECEIPT_KEYS
            assert step["budget_after"] == body["plan"]["budget"] == fix["budget_after"]
            assert step["rule_holds_after"] is True and step["new_breaks"] == 0
            assert step["rule"] == {
                "a": {"act_id": "a", "act": "A"},
                "b": {"act_id": "b", "act": "B"},
            }
            assert [set(m) for m in step["moves"]] == [MOVED_KEYS] * fix["sets_moved"]
            for kept, listed_move in zip(step["moves"], fix["moves"], strict=True):
                for key in ("act", "act_id", "stage", "stage_id", "day", "start", "end"):
                    assert kept[key] == listed_move[key]
                assert kept["move"].startswith(f"{kept['act']}: ")
                assert kept["move"].endswith(f"{kept['stage']} {kept['start']}-{kept['end']}")
                assert kept["move"].split(" -> ")[0].endswith(listed_move["from"].split(" ", 1)[-1])
            # Re-derived without the plan code: the moved day, its index and the pair's shared minutes
            moved = moved_festival(festival, fix)
            assert shared_after(moved, "a", "b") == 0
            assert body["plan"]["budget"] == score_festival(moved, matrix, config).metrics.clash_budget_index
            assert (
                body["published_budget"]
                == score_festival(festival, matrix, config).metrics.clash_budget_index
            )


@PROPERTY
@given(festival_cases(windows=True))
def test_every_change_the_search_lists_is_a_legal_step_on_random_days(case):
    festival, matrix = case
    config = ScoringConfig(
        baseline=score_festival(festival, matrix, ScoringConfig(baseline_samples=30)).baseline
    )
    layout = Layout.from_festival(festival)
    ids = layout.rules.act_ids
    for i, k, _ in layout.concurrent_pairs()[:3]:
        for fix in search(festival, matrix, config, ids[i], ids[k])["fixes"]:
            group = PlanGroup(tuple(plan_move(m) for m in fix["moves"]), (ids[i], ids[k]))
            plan = apply_plan(festival, matrix, config, [group])
            (step,) = plan.steps
            assert step.budget_after == fix["budget_after"] == plan.report.metrics.clash_budget_index
            assert plan.new_breaks == 0
            moved = moved_festival(festival, fix)
            assert plan.festival.timetable == moved.timetable
            assert shared_after(plan.festival, ids[i], ids[k]) == 0


def clock(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def illegal_alone(festival, matrix, config, move: dict) -> bool:
    try:
        apply_plan(festival, matrix, config, [plan_move(move)])
    except IllegalStep:
        return True
    return False


def test_a_step_is_judged_after_the_whole_step_never_move_by_move(day):
    festival, matrix, config, _ = day
    swaps = fixes_of(festival, matrix, config, 2)
    # Swaps whose two halves are each refused as a plain kept move, one at a time
    halves = [f for f in swaps if all(illegal_alone(festival, matrix, config, m) for m in f["moves"])]
    assert halves
    fix = halves[0]
    first, second = fix["moves"]
    taken = next(s for s in festival.timetable if s.act_id not in {"a", "b", second["act_id"]})
    with TestClient(app) as client:
        for m in fix["moves"]:
            refused = post(client, [one(m["act_id"], m["stage_id"], m["start"])])
            assert refused.status_code == 422 and refused.json() == STEP_1
        whole = post(client, [step_of(fix)])
        assert whole.status_code == 200
        assert whole.json()["plan"]["steps"][0]["rule_holds_after"] is True
        # The same first move with the second set sent to a taken slot: the whole step is refused
        spoilt = rule_step(
            [
                one(first["act_id"], first["stage_id"], first["start"]),
                one(second["act_id"], taken.stage_id, clock(taken.start)),
            ]
        )
        refused = post(client, [spoilt])
        assert refused.status_code == 422 and refused.json() == STEP_1


def test_one_move_kept_first_then_the_rule_change_is_priced_on_the_timetable_it_left(day):
    festival, matrix, config, _ = day
    with TestClient(app) as client:
        for fix in fixes_of(festival, matrix, config)[:5]:
            touched = {m["act_id"] for m in fix["moves"]}
            before = next(
                (
                    (act, place)
                    for act in ("g", "h", "d", "f")
                    if act not in touched
                    for place in post(client, [], act=act).json()["options"]["options"]
                ),
                None,
            )
            assert before is not None
            act, place = before
            single = one(act, place["stage_id"], place["start"])
            response = post(client, [single, step_of(fix)])
            if response.status_code == 422:  # the single move got in the change's way: only then
                assert response.json() == STEP_2
                continue
            body = response.json()
            first, second = body["plan"]["steps"]
            assert set(first) == {
                "act",
                "act_id",
                "move",
                "stage",
                "stage_id",
                "day",
                "start",
                "end",
                "budget_after",
            }
            assert set(second) == RECEIPT_KEYS
            moved = moved_festival(festival, fix)
            data = moved.model_dump()
            slot = next(s for s in data["timetable"] if s["act_id"] == act)
            length = slot["end"] - slot["start"]
            start = parse_minutes(place["start"])
            slot.update(stage_id=place["stage_id"], start=start, end=start + length)
            both = type(moved).model_validate(data)
            assert second["budget_after"] == body["plan"]["budget"]
            assert body["plan"]["budget"] == score_festival(both, matrix, config).metrics.clash_budget_index
            assert second["rule_holds_after"] is True and second["new_breaks"] == 0


def test_a_legal_step_that_leaves_the_pair_overlapping_is_accepted_and_says_so(day):
    festival, matrix, config, _ = day
    # b 5 minutes later on its own stage: legal, and a and b still share 25 minutes
    with TestClient(app) as client:
        response = post(client, [rule_step([one("b", "side", "10:35")])])
    assert response.status_code == 200
    (step,) = response.json()["plan"]["steps"]
    assert step["rule_holds_after"] is False and step["new_breaks"] == 0
    assert [m["act_id"] for m in step["moves"]] == ["b"] and step["budget_after"] is not None


def test_the_receipt_is_read_after_the_whole_plan_not_when_the_step_is_applied(day):
    festival, matrix, config, _ = day
    # A change after which the pair's other set has a place that puts it back across the first one
    chosen = None
    for fix in fixes_of(festival, matrix, config, 2)[:40]:
        moved = moved_festival(festival, fix)
        touched = {m["act_id"] for m in fix["moves"]}
        for free, other in (("a", "b"), ("b", "a")):
            if free in touched:
                continue
            slots = {s.act_id: s for s in moved.timetable}
            places = compute_move_options(moved, matrix, config, free, 1_000, partners=True)["options"]
            back = [
                p
                for p in places
                if parse_minutes(p["start"]) < slots[other].end
                and slots[other].start < parse_minutes(p["end"])
            ]
            if back and chosen is None:
                chosen = (fix, free, back[0])
    assert chosen is not None
    fix, free, back = chosen
    with TestClient(app) as client:
        held = post(client, [step_of(fix)])
        assert held.json()["plan"]["steps"][0]["rule_holds_after"] is True
        broken = post(client, [step_of(fix), one(free, back["stage_id"], back["start"])])
        assert broken.status_code == 200
        first, second = broken.json()["plan"]["steps"]
        assert first["rule_holds_after"] is False and first["new_breaks"] == 0
        assert "rule_holds_after" not in second and "new_breaks" not in second


def test_a_rule_step_may_move_a_set_an_earlier_step_moved_and_is_priced_on_what_that_step_left(day):
    festival, matrix, config, _ = day
    fix = fixes_of(festival, matrix, config, 1)[0]
    (mover,) = fix["moves"]
    with TestClient(app) as client:
        places = post(client, [], act=mover["act_id"], limit=12).json()["options"]["options"]
        elsewhere = next(
            p for p in places if (p["stage_id"], p["start"]) != (mover["stage_id"], mover["start"])
        )
        first = one(mover["act_id"], elsewhere["stage_id"], elsewhere["start"])
        response = post(client, [first, step_of(fix)])
        assert response.status_code == 200
        kept, change = response.json()["plan"]["steps"]
        assert kept["budget_after"] == elsewhere["clash_budget_after"]
        assert change["budget_after"] == fix["budget_after"]  # the set ends where the change put it
        assert (
            change["moves"][0]["move"]
            .split(" -> ")[0]
            .endswith(f"{elsewhere['stage']} {elsewhere['start']}-{elsewhere['end']}")
        )  # and it started from the place the earlier step left
        assert change["rule_holds_after"] is True and change["new_breaks"] == 0
        # A plain move is still kept once, and one set is never moved twice inside a step
        twice = post(client, [first, one(mover["act_id"], mover["stage_id"], mover["start"])])
        assert twice.status_code == 422 and twice.json() == PICK_ONCE
        inside = post(client, [rule_step([first, one(mover["act_id"], mover["stage_id"], mover["start"])])])
        assert inside.status_code == 422 and inside.json() == PICK_ONCE


def test_the_pair_may_be_named_by_a_step_that_moves_neither_of_its_sets(day):
    with TestClient(app) as client:
        elsewhere = post(client, [], act="g").json()["options"]["options"][0]
        named = rule_step([one("g", elsewhere["stage_id"], elsewhere["start"])])
        ok = post(client, [named])
    assert ok.status_code == 200
    (step,) = ok.json()["plan"]["steps"]
    assert step["rule_holds_after"] is False and step["new_breaks"] == 0


def test_the_day_may_already_break_a_rule_and_a_step_may_not_add_one(tmp_path, monkeypatch):
    festival, matrix, config = write_day(tmp_path, day_sets(extra=[("l", 0, "tent", 905, 950)]))
    settings = Settings(presets_dir=tmp_path, _env_file=None)
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_qloo] = no_qloo
    monkeypatch.setattr(whatif, "get_settings", lambda: settings)
    whatif._limiter = None
    try:
        published = set(Layout.from_festival(festival).issues())
        assert published  # i and l sit 5 minutes apart: a break the published day has
        with TestClient(app) as client:
            for fix in fixes_of(festival, matrix, config)[:5]:
                response = post(client, [step_of(fix)])
                assert response.status_code == 200
                (step,) = response.json()["plan"]["steps"]
                assert step["new_breaks"] == 0 and step["rule_holds_after"] is True
                moved = moved_festival(festival, fix)
                assert set(Layout.from_festival(moved).issues()) <= published
            # b to the tent right after l ends: the changeover rule would be broken once more
            added = post(client, [rule_step([one("b", "tent", "15:55")])])
            assert added.status_code == 422 and added.json() == STEP_1
    finally:
        app.dependency_overrides.clear()
        whatif._limiter = None


def test_places_that_break_a_rule_or_are_not_places_are_illegal_steps(day):
    festival, matrix, config, _ = day
    fix = fixes_of(festival, matrix, config, 1)[0]
    bad_steps = [
        rule_step([one("i", "tent", "15:00")]),  # a locked set
        rule_step([one("a", "nowhere", "11:00")]),  # no such stage
        rule_step([one("a", "side", "10:00", 1)]),  # a day the festival does not have
        rule_step([one("a", "main", "10:00")]),  # where it already is
        rule_step([one("a", "side", "10:30")]),  # the slot b holds
        rule_step([one("a", "main", "09:00")]),  # before the stage opens
        rule_step([one("a", "tent", "15:30")]),  # past the hour the stage closes
        rule_step([one("a", "side", "11:15"), one("c", "main", "10:00")]),  # a on b, c on a's old slot
        rule_step([one("a", "main", "11:30"), one("a", "main", "11:30")]),  # one set twice in a step
    ]
    with TestClient(app) as client:
        for bad in bad_steps:
            alone = post(client, [bad])
            assert alone.status_code == 422, bad
            assert alone.json() in (STEP_1, PICK_ONCE), bad
        assert post(client, [bad_steps[0], step_of(fix)]).json() == STEP_1  # the number is the step's own
        assert post(client, [step_of(fix), bad_steps[1]]).json() == STEP_2
        assert post(client, [step_of(fix)]).status_code == 200


def test_an_earlier_step_can_make_a_listed_change_illegal_and_the_step_names_its_number(day):
    festival, matrix, config, _ = day
    fix = fixes_of(festival, matrix, config)[0]
    (m,) = fix["moves"]
    assert (m["act_id"], m["stage_id"], m["start"]) == ("b", "side", "15:00")
    blocker = one("g", "side", "15:00")  # g takes the free tail the change needs
    with TestClient(app) as client:
        assert post(client, [step_of(fix)]).status_code == 200
        assert post(client, [blocker]).status_code == 200
        refused = post(client, [blocker, step_of(fix)])
        assert refused.status_code == 422 and refused.json() == STEP_2


# ------------------------------------------------------------------------------ shapes and hostile bodies


def test_shape_errors_are_422_echo_nothing_and_take_no_slot(day):
    marker = "HOSTILE"
    mv = one("b", "side", "10:35")
    pair = {"a": "a", "b": "b"}
    nine = [one(f"x{i}", "side", "10:35") for i in range(9)]
    bodies = [
        {"moves": [{"rule": pair, "moves": []}]},  # no move
        {"moves": [{"rule": pair, "moves": [mv, mv, mv]}]},  # three moves
        {"moves": [{"rule": {"a": "a", "b": "a"}, "moves": [mv]}]},  # a pair of one set
        {"moves": [{"rule": {"a": "a"}, "moves": [mv]}]},
        {"moves": [{"rule": {"a": "a", "b": "b", "c": "c"}, "moves": [mv]}]},
        {"moves": [{"rule": pair}]},
        {"moves": [{"moves": [mv, mv]}]},  # two moves with no rule are not a step
        {"moves": [{**mv, "rule": pair}]},  # a rule on a single move
        {"moves": [{"rule": pair, "moves": [mv], "extra": marker}]},
        {"moves": [{"rule": pair, "moves": [{**mv, "extra": marker}]}]},
        {"moves": [{"rule": {"a": marker * 2_000, "b": "b"}, "moves": [mv]}]},
        {"moves": [{"rule": {"a": f"{marker}\x00", "b": "b"}, "moves": [mv]}]},
        {"moves": [{"rule": {"a": "a", "b": f"{marker}/../x"}, "moves": [mv]}]},
        {"moves": [{"rule": None, "moves": [mv]}]},
        {"moves": [{"rule": "a-b", "moves": [mv]}]},
        {"moves": [{"rule": pair, "moves": "all"}]},
        {"moves": [{"rule": pair, "moves": [{**mv, "day": 14}]}]},
        {"moves": [{"rule": pair, "moves": [{**mv, "day": True}]}]},
        {"moves": [{"rule": pair, "moves": [{**mv, "start": "25:61"}]}]},
        {"moves": [{"rule": pair, "moves": [{**mv, "act": marker * 2_000}]}]},
        {"moves": [{"rule": pair, "moves": [{**mv, "stage_id": marker * 2_000}]}]},
        # more than 8 counted moves: five two-move steps, and nine one-move steps
        {"moves": [{"rule": pair, "moves": [one("b", "side", "10:35"), one("c", "main", "12:05")]}] * 5},
        {"moves": [{"rule": pair, "moves": [mv]}] * 9},
        {"moves": [{"rule": pair, "moves": [mv, mv]}] * 4 + [mv]},
        {"moves": [nine[0], {"rule": pair, "moves": [mv, mv]}, *nine[1:8]]},
        {"moves": ["a-step", 3, None, [], {}]},
    ]
    with TestClient(app) as client:
        responses = [client.post("/api/presets/rules/whatif", json=body) for body in bodies]
        assert visits(client) == 0
    for body, response in zip(bodies, responses, strict=True):
        assert response.status_code == 422, (body, response.text)
        assert response.headers["cache-control"] == NO_STORE
        assert marker not in response.text and "\\u0000" not in response.text
        assert isinstance(response.json()["detail"], list)
        assert all(set(error) == {"loc", "msg", "type"} for error in response.json()["detail"])
        assert len(response.text) < 4_000


def test_eight_counted_moves_pass_the_shape_check_and_are_judged_on_their_places(day):
    pair = {"a": "a", "b": "b"}
    mv = one("g", "side", "10:35")
    # four two-move steps are 8 counted moves: the shape is fine, so the answer is about the places (422 text)
    steps = [
        {"rule": pair, "moves": [one(f"s{i}", "side", "10:35"), one(f"t{i}", "main", "10:35")]}
        for i in range(4)
    ]
    with TestClient(app) as client:
        unknown = post(client, steps)
        assert unknown.status_code == 404 and unknown.json() == NOT_ON_DAY
        ten = post(client, [*steps, rule_step([mv])])
        assert ten.status_code == 422 and isinstance(ten.json()["detail"], list)


def test_unknown_sets_are_404_and_echo_no_id(day):
    mv = one("g", "side", "10:35")
    with TestClient(app) as client:
        bodies = [
            [rule_step([mv], "someone-else", "b")],  # the pair
            [rule_step([mv], "a", "someone-else")],
            [rule_step([one("someone-else", "side", "10:35")])],  # a moved set
            [rule_step([mv, one("someone-else", "side", "10:35")])],
        ]
        responses = [post(client, body) for body in bodies]
        assert visits(client) == 0
    for response in responses:
        assert response.status_code == 404 and response.json() == NOT_ON_DAY
        assert "someone-else" not in response.text and response.headers["cache-control"] == NO_STORE


def test_a_set_is_picked_once_among_single_moves_and_inside_a_step(day):
    with TestClient(app) as client:
        singles = post(client, [one("g", "side", "10:35"), one("g", "side", "11:00")])
        inside = post(client, [rule_step([one("g", "side", "10:35"), one("g", "main", "11:00")])])
    for response in (singles, inside):
        assert response.status_code == 422 and response.json() == PICK_ONCE
        assert response.headers["cache-control"] == NO_STORE


# ------------------------------------------------------------------------------------- caches and caps


def counted_apply_plan(monkeypatch) -> list:
    calls: list = []
    real = whatif.apply_plan

    def counted(*args, **kwargs):
        calls.append(args[3])
        return real(*args, **kwargs)

    monkeypatch.setattr(whatif, "apply_plan", counted)
    return calls


def test_a_rule_plan_is_one_slot_and_a_cache_hit_is_free(day, monkeypatch):
    festival, matrix, config, _ = day
    calls = counted_apply_plan(monkeypatch)
    fix = fixes_of(festival, matrix, config)[0]
    with TestClient(app) as client:
        first = post(client, [step_of(fix)])
        assert visits(client) == 1
        again = post(client, [step_of(fix)])
        assert visits(client) == 1
    assert first.status_code == again.status_code == 200 and first.text == again.text
    assert len(calls) == 1 and isinstance(calls[0][0], PlanGroup)


def test_the_cache_key_covers_the_grouping(day, monkeypatch):
    festival, matrix, config, _ = day
    calls = counted_apply_plan(monkeypatch)
    fix = fixes_of(festival, matrix, config, 1)[0]
    (m,) = fix["moves"]
    single = one(m["act_id"], m["stage_id"], m["start"])
    with TestClient(app) as client:
        plain = post(client, [single])
        grouped = post(client, [rule_step([single])])
        other_pair = post(client, [rule_step([single], "a", "g")])
        again = post(client, [rule_step([single])])
        assert visits(client) == 3
    assert [type(c[0]).__name__ for c in calls] == ["PlanMove", "PlanGroup", "PlanGroup"]
    assert "rule" not in plain.json()["plan"]["steps"][0] and "rule" in grouped.json()["plan"]["steps"][0]
    assert plain.json()["plan"]["budget"] == grouped.json()["plan"]["budget"]
    assert grouped.json()["plan"]["steps"][0]["rule_holds_after"] is True
    assert other_pair.json()["plan"]["steps"][0]["rule"]["b"]["act_id"] == "g"
    assert again.text == grouped.text


def test_an_illegal_rule_plan_is_remembered_and_costs_one_slot(day, monkeypatch):
    calls = counted_apply_plan(monkeypatch)
    bad = rule_step([one("a", "nowhere", "11:00")])
    with TestClient(app) as client:
        first = post(client, [bad])
        again = post(client, [bad])
        assert visits(client) == 1
        other_pair = post(client, [rule_step([one("a", "nowhere", "11:00")], "a", "g")])
        assert visits(client) == 2
    for response in (first, again, other_pair):
        assert response.status_code == 422 and response.json() == STEP_1
        assert response.headers["cache-control"] == NO_STORE
    assert len(calls) == 2
    assert len(whatif._illegal) == 2


def test_a_legal_rule_plan_refused_with_429_never_reaches_the_engine(day, monkeypatch):
    festival, matrix, config, _ = day
    calls = counted_apply_plan(monkeypatch)
    fix = fixes_of(festival, matrix, config)[0]
    app.dependency_overrides[whatif.get_whatif_limiter] = lambda: RunLimiter(
        0, 10, 10, messages=whatif.WHATIF_MESSAGES
    )
    with TestClient(app) as client:
        refused = post(client, [step_of(fix)])
    assert refused.status_code == 429 and calls == []


def test_act_gives_the_places_on_the_timetable_the_rule_step_left(day):
    festival, matrix, config, _ = day
    fix = fixes_of(festival, matrix, config, 2)[0]
    with TestClient(app) as client:
        body = post(client, [step_of(fix)], act="g", limit=4).json()
    assert body["options"]["kind"] == "move_options" and body["options"]["act_id"] == "g"
    assert body["options"]["clash_budget_before"] == body["plan"]["budget"]


# --------------------------------------------------------------------------------------- the engine


def test_apply_plan_takes_a_group_and_reports_the_breaks_it_added(day):
    festival, matrix, config, _ = day
    fix = fixes_of(festival, matrix, config, 2)[0]
    group = PlanGroup(tuple(plan_move(m) for m in fix["moves"]), ("a", "b"))
    plan = apply_plan(festival, matrix, config, [group])
    assert plan.new_breaks == 0 and len(plan.steps) == 1
    assert [m.act_id for m in plan.steps[0].moves] == [m["act_id"] for m in fix["moves"]]
    assert plan.steps[0].rule == ("a", "b")
    assert apply_plan(festival, matrix, config, []).new_breaks == 0
    for broken in (
        PlanGroup((), ("a", "b")),
        PlanGroup((plan_move(fix["moves"][0]),) * 2, ("a", "b")),
        PlanGroup((PlanMove("a", "main", 0, 600),), ("a", "b")),
        PlanGroup((PlanMove("a", "main", 5, 700),), ("a", "b")),
        PlanGroup((PlanMove("a", "main", 0, -5),), ("a", "b")),
        PlanGroup((PlanMove("a", "side", 0, 630),), ("a", "b")),
        PlanGroup((PlanMove("zz", "main", 0, 700),), ("a", "b")),
    ):
        with pytest.raises(IllegalStep) as refused:
            apply_plan(festival, matrix, config, [broken])
        assert refused.value.step == 1


def test_the_nine_set_day_is_what_the_fixture_says(day):
    festival, _, _, _ = day
    assert [s.act_id for s in festival.timetable if s.locked] == ["i"]
    assert {s.act_id: s.stage_id for s in festival.timetable}["a"] == "main"
    assert HOURS["main"] == [(0, 600, 960)]
    assert shared_after(festival, "a", "b") == 30
