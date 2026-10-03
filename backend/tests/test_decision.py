"""The decision and the rule search routes: one worked decision on a preset day and the smallest changes this
search found that end an overlap between two sets. Saved data only: no Qloo request, no model, nothing on the
preset changes; the search runs once per preset object and pair, and only a computed answer takes a slot."""

import json
import threading

import httpx
import pytest
from fastapi.testclient import TestClient

from app import decision, whatif
from app.agent.clash_tools import PlanMove, apply_plan, compute_move_options
from app.audit import _priced_pairs
from app.config import Settings, get_settings
from app.limits import RunLimiter
from app.main import app, get_qloo
from app.presets import CACHE_CONTROL, get_presets
from app.qloo.client import QlooClient
from app.runs import published_state
from app.schedule import rulefix
from app.schedule.metrics import score_festival, shared_minutes
from app.schedule.models import ScoringConfig, parse_minutes
from tests.schedule_support import conflicts, make_festival, make_matrix

NO_STORE = "no-store"
HOURS = [(0, 540, 1100)]
MOVE_KEYS = {
    "act_id",
    "act",
    "from",
    "stage_id",
    "stage",
    "day",
    "start",
    "end",
    "minutes_moved",
    "legal_places",
    "stage_changed",
    "budget_after",
    "minutes_shared_after",
    "same_index_alternative",
}
ALTERNATIVE_KEYS = {"act_id", "act", "from", "stage_id", "stage", "day", "start", "end", "minutes_moved"}
RULE_KEYS = {
    "kind",
    "a",
    "b",
    "rule",
    "shared_minutes",
    "holds",
    "single_set_places",
    "fixes_found",
    "searched",
    "fixes",
}
FIX_KEYS = {
    "sets_moved",
    "minutes_moved",
    "stage_changes",
    "budget_after",
    "stage_fit_flags_now",
    "stage_fit_flags_after",
    "moves",
}


def no_qloo() -> QlooClient:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise AssertionError("these routes never call Qloo")

    return QlooClient("test-key", max_rps=None, transport=httpx.MockTransport(refuse))


def decision_day(lock_all: bool = False):
    """Three blocks. x and y (locked, the costliest clash), p (locked) and q (cannot start anywhere else:
    nothing to do), then r and s, which can move. z1, z2 and t are low-cost fillers."""
    sets = [
        ("x", 0, "main", 600, 660, {"locked": True}),
        ("y", 0, "tent", 600, 660, {"locked": True}),
        ("z1", 0, "side", 645, 705),
        ("p", 0, "main", 720, 780, {"locked": True}),
        ("q", 0, "side", 720, 780, {"not_before": 720, "not_after": 720}),
        ("z2", 0, "side", 795, 855),
        ("r", 0, "main", 900, 960),
        ("s", 0, "side", 900, 960),
        ("t", 0, "tent", 1000, 1060),
    ]
    if lock_all:
        sets = [(*row[:5], {"locked": True}) for row in sets]
    popularity = {"x": 0.95, "y": 0.95, "p": 0.9, "q": 0.9, "r": 0.7, "s": 0.7}
    festival = make_festival(
        sets,
        hours={"main": HOURS, "side": HOURS, "tent": HOURS},
        acts={act: {"popularity": value} for act, value in popularity.items()},
    )
    matrix = make_matrix(
        [row[0] for row in sets], {("x", "y"): 0.9, ("p", "q"): 0.8, ("r", "s"): 0.6}, default=0.05
    )
    return festival, matrix


def write_day(directory, preset_id="day", **kwargs):
    festival, matrix = decision_day(**kwargs)
    data = {
        "id": preset_id,
        "title": "Day",
        "festival": festival.model_dump(mode="json"),
        "matrix": matrix.model_dump(mode="json"),
        "report": score_festival(festival, matrix).model_dump(mode="json"),
    }
    (directory / f"{preset_id}.json").write_text(json.dumps(data), encoding="utf-8")


def clear_caches():
    with decision._lock:
        decision._rules.clear()
        decision._decisions.clear()
        decision._key_locks.clear()


def build_app(directory):
    """The real application (its own error handler never echoes a request back) with the saved day."""
    app.dependency_overrides[get_settings] = lambda: Settings(presets_dir=directory, _env_file=None)
    app.dependency_overrides[get_qloo] = no_qloo
    return app


@pytest.fixture
def limiter():
    return RunLimiter(100, 100, 100, messages=whatif.WHATIF_MESSAGES)


@pytest.fixture
def client(tmp_path, limiter, monkeypatch):
    write_day(tmp_path)
    build_app(tmp_path)
    app.dependency_overrides[whatif.get_whatif_limiter] = lambda: limiter
    monkeypatch.setattr(whatif, "get_settings", lambda: Settings(presets_dir=tmp_path, _env_file=None))
    with whatif._cache_lock:
        whatif._plans.clear()
        whatif._cache.clear()
    clear_caches()
    with TestClient(app) as test_client:
        clear_caches()  # the application's startup already warmed the day; most tests start cold
        test_client.preset = get_presets(Settings(presets_dir=tmp_path, _env_file=None))["day"]
        yield test_client
    clear_caches()
    app.dependency_overrides.clear()


def visits(limiter: RunLimiter) -> int:
    """Computed answers counted for the test client's own address."""
    return len(limiter._visitors.get("testclient", ()))


def floats_outside_budgets(value, key=None) -> list[tuple[str | None, float]]:
    if isinstance(value, float):
        return [] if key in {"budget_after", "published_budget"} else [(key, value)]
    if isinstance(value, dict):
        return [f for k, v in value.items() for f in floats_outside_budgets(v, k)]
    if isinstance(value, list):
        return [f for v in value for f in floats_outside_budgets(v, key)]
    return []


def rules_url(a: str, b: str, **extra) -> str:
    query = "&".join(f"{k}={v}" for k, v in {"a": a, "b": b, **extra}.items())
    return f"/api/presets/day/rule-fixes?{query}"


# ----------------------------------------------------------------------------------------- decision


def test_the_decision_skips_what_cannot_move_and_says_how_many(client):
    response = client.get("/api/presets/day/decision")
    assert response.status_code == 200 and response.headers["cache-control"] == CACHE_CONTROL
    body = response.json()
    state = published_state(client.preset)
    order = [key for key, _, _ in _priced_pairs(state["festival"], state["matrix"], 0)]
    assert order[:3] == [("x", "y"), ("p", "q"), ("r", "s")]  # the day's own ranking
    assert body["kind"] == "decision" and body["day"] == 0
    assert body["skipped_locked"] == 1  # x and y are both locked
    assert body["skipped_no_place"] == 1  # p is locked and q has nowhere else to start
    assert body["clash"] == {"a_id": "r", "b_id": "s", "rank": 3, "minutes": 60}
    report = score_festival(state["festival"], state["matrix"], state["config"])
    assert body["published_budget"] == report.metrics.clash_budget_index


def test_the_body_follows_the_contract_and_carries_no_taste_value(client):
    body = client.get("/api/presets/day/decision").json()
    assert set(body) == {
        "kind",
        "day",
        "skipped_locked",
        "skipped_no_place",
        "clash",
        "published_budget",
        "move",
        "rule",
    }
    move = body["move"]
    assert set(move) == MOVE_KEYS and move["act_id"] in {"r", "s"}
    assert isinstance(move["legal_places"], int) and move["legal_places"] >= 1
    assert move["budget_after"] < body["published_budget"]
    assert move["minutes_shared_after"] < body["clash"]["minutes"]
    assert move["minutes_moved"] == abs(parse_minutes(move["start"]) - 900)
    assert move["stage_changed"] == (move["stage_id"] != {"r": "main", "s": "side"}[move["act_id"]])
    alternative = move["same_index_alternative"]
    assert alternative is None or set(alternative) == ALTERNATIVE_KEYS
    rule = body["rule"]
    assert set(rule) == RULE_KEYS and rule["kind"] == "rule_fixes"
    assert rule["rule"] == f"{rule['a']['act']} and {rule['b']['act']} must not overlap"
    assert all(set(fix) == FIX_KEYS for fix in rule["fixes"]) and len(rule["fixes"]) <= decision.HERO_LIMIT
    assert floats_outside_budgets(body) == []
    text = json.dumps(body)
    for banned in ("matrix", "affinity", '"values"', "popularity", "audience_overlap", "taste_overlap"):
        assert banned not in text


def test_the_moves_budget_is_what_post_whatif_answers_for_the_same_move(client):
    body = client.get("/api/presets/day/decision").json()
    move = body["move"]
    plan = client.post(
        "/api/presets/day/whatif",
        json={
            "moves": [{"act": move["act_id"], "stage_id": move["stage_id"], "day": 0, "start": move["start"]}]
        },
    )
    assert plan.status_code == 200
    answer = plan.json()
    assert answer["published_budget"] == body["published_budget"]
    assert answer["plan"]["steps"][0]["budget_after"] == answer["plan"]["budget"] == move["budget_after"]
    # the same place is the first one /moves lists for that set
    listed = client.get("/api/presets/day/moves", params={"act": move["act_id"], "limit": 1}).json()
    assert listed["legal_places"] == move["legal_places"]
    first = listed["options"][0]
    assert (first["stage_id"], first["start"], first["end"]) == (move["stage_id"], move["start"], move["end"])
    # minutes shared after, from the moved timetable
    festival = client.preset.festival
    data = festival.model_dump()
    slot = next(s for s in data["timetable"] if s["act_id"] == move["act_id"])
    slot.update(stage_id=move["stage_id"], start=parse_minutes(move["start"]), end=parse_minutes(move["end"]))
    moved = type(festival).model_validate(data)
    slots = {s.act_id: s for s in moved.timetable}
    assert shared_minutes(slots["r"], slots["s"]) == move["minutes_shared_after"]


def test_the_chosen_set_is_the_one_with_the_lower_index_and_the_other_is_named_when_close(client):
    body = client.get("/api/presets/day/decision").json()
    state = published_state(client.preset)
    indexes = {}
    for act in ("r", "s"):
        first = compute_move_options(
            state["festival"], state["matrix"], state["config"], act, 1, partners=True
        )["options"][0]
        plan = apply_plan(
            state["festival"],
            state["matrix"],
            state["config"],
            [PlanMove(act, first["stage_id"], 0, parse_minutes(first["start"]))],
        )
        indexes[act] = plan.report.metrics.regret  # the index before rounding, in regret units
    lower = min(indexes, key=lambda act: (indexes[act], act))
    assert body["move"]["act_id"] == lower
    other = "s" if lower == "r" else "r"
    ratio = 100 * (indexes[other] - indexes[lower]) / state["config"].baseline.mean_regret
    alternative = body["move"]["same_index_alternative"]
    assert (alternative is not None) == (ratio <= decision.SAME_INDEX)
    if alternative:
        assert alternative["act_id"] == other


def test_every_clash_between_locked_sets_gives_an_empty_decision(tmp_path, limiter):
    write_day(tmp_path, lock_all=True)
    build_app(tmp_path)
    app.dependency_overrides[whatif.get_whatif_limiter] = lambda: limiter
    clear_caches()
    with TestClient(app) as client:
        body = client.get("/api/presets/day/decision").json()
    app.dependency_overrides.clear()
    assert body["clash"] is None and body["move"] is None and body["rule"] is None
    state = published_state(get_presets(Settings(presets_dir=tmp_path, _env_file=None))["day"])
    priced = _priced_pairs(state["festival"], state["matrix"], 0)
    assert body["skipped_locked"] == min(len(priced), decision.RANKED) >= 3
    assert body["skipped_no_place"] == 0
    clear_caches()


def test_the_decision_is_computed_once_per_preset_object_even_when_requests_arrive_together(
    client, monkeypatch
):
    calls = {"decision": 0, "search": 0}
    real_decision, real_search = decision.compute_decision, rulefix.rule_fixes

    def counted_decision(*args, **kwargs):
        calls["decision"] += 1
        return real_decision(*args, **kwargs)

    def counted_search(*args, **kwargs):
        calls["search"] += 1
        return real_search(*args, **kwargs)

    monkeypatch.setattr(decision, "compute_decision", counted_decision)
    monkeypatch.setattr(rulefix, "rule_fixes", counted_search)
    results: list[dict] = []

    def ask():
        results.append(client.get("/api/presets/day/decision").json())

    threads = [threading.Thread(target=ask) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert calls == {"decision": 1, "search": 1} and len(results) == 8
    assert all(r == results[0] for r in results)
    for _ in range(5):
        assert client.get("/api/presets/day/decision").json() == results[0]
        assert client.get("/api/presets/day/decision", params={"day": 0}).json() == results[0]
    assert calls == {"decision": 1, "search": 1}
    # the hero pair is already searched: the rule route is a hit, no slot, no engine call
    pair = results[0]["clash"]
    got = client.get(rules_url(pair["a_id"], pair["b_id"], limit=3))
    assert got.status_code == 200 and got.json() == results[0]["rule"]
    assert calls["search"] == 1


def test_a_reloaded_preset_object_replaces_its_entries(client, monkeypatch):
    first = client.get("/api/presets/day/decision").json()
    reloaded = client.preset.model_copy()
    assert reloaded is not client.preset
    calls = []
    real = rulefix.rule_fixes
    monkeypatch.setattr(rulefix, "rule_fixes", lambda *a, **k: calls.append(1) or real(*a, **k))
    assert decision.decision(reloaded, 0) == first
    assert len(calls) == 1  # computed again for the new object, then cached
    assert decision.decision(reloaded, 0) is decision.decision(reloaded, 0)
    assert len(decision._decisions) == 1 and decision._decisions[("day", 0)][0] is reloaded


def test_the_decision_refuses_what_it_cannot_answer_without_echoing(client):
    missing = client.get("/api/presets/nope/decision")
    assert missing.status_code == 404 and missing.json() == {"detail": "No preset 'nope'."}
    assert missing.headers["cache-control"] == NO_STORE
    no_day = client.get("/api/presets/day/decision", params={"day": 7})
    assert no_day.status_code == 422 and no_day.json() == {"detail": "That day has no sets."}
    assert no_day.headers["cache-control"] == NO_STORE
    for bad in ({"day": "<script>alert(1)</script>"}, {"day": "1e9"}, {"day": "x" * 300}):
        response = client.get("/api/presets/day/decision", params=bad)
        assert response.status_code == 422
        assert "script" not in response.text and "x" * 20 not in response.text
        assert all(set(error) == {"loc", "msg", "type"} for error in response.json()["detail"])
    long_id = client.get("/api/presets/" + "p" * 200 + "/decision")
    assert long_id.status_code == 422 and "pppp" not in long_id.text
    odd = client.get("/api/presets/<script>/decision")
    assert odd.status_code in (404, 422) and "script" not in odd.text


# --------------------------------------------------------------------------------------- rule-fixes


def test_the_rule_route_body_follows_the_contract(client, limiter):
    response = client.get(rules_url("r", "s"))
    assert response.status_code == 200 and response.headers["cache-control"] == CACHE_CONTROL
    body = response.json()
    assert set(body) == RULE_KEYS and body["kind"] == "rule_fixes"
    assert body["a"]["act_id"] == "r" and body["b"]["act_id"] == "s"
    assert set(body["a"]) == {"act_id", "act", "locked", "place"}
    assert body["a"]["place"] == "Main 15:00-16:00" and body["b"]["place"] == "Side 15:00-16:00"
    assert body["rule"] == "R and S must not overlap" and body["shared_minutes"] == 60
    assert body["holds"] is False and body["fixes_found"] >= len(body["fixes"]) == min(3, body["fixes_found"])
    assert "5-minute grid" in body["searched"] and "every rule" not in body["searched"].lower()
    assert all(set(fix) == FIX_KEYS for fix in body["fixes"])
    assert floats_outside_budgets(body) == []
    assert visits(limiter) == 1
    festival = client.preset.festival
    for fix in body["fixes"]:  # every listed change, re-checked
        data = festival.model_dump()
        for move in fix["moves"]:
            slot = next(s for s in data["timetable"] if s["act_id"] == move["act_id"])
            slot.update(
                stage_id=move["stage_id"], start=parse_minutes(move["start"]), end=parse_minutes(move["end"])
            )
        moved = type(festival).model_validate(data)
        slots = {s.act_id: s for s in moved.timetable}
        assert shared_minutes(slots["r"], slots["s"]) == 0
        assert set(conflicts(moved)) <= set(conflicts(festival))


def test_a_computed_answer_takes_one_slot_and_a_hit_or_a_holding_pair_takes_none(client, limiter):
    assert client.get(rules_url("r", "s")).status_code == 200 and visits(limiter) == 1
    assert client.get(rules_url("r", "s")).status_code == 200 and visits(limiter) == 1  # a hit
    reverse = client.get(rules_url("s", "r"))
    assert reverse.status_code == 200 and visits(limiter) == 1  # the unordered pair: a hit
    assert reverse.json()["a"]["act_id"] == "s" and reverse.json()["rule"] == "S and R must not overlap"
    assert reverse.json()["fixes"] == client.get(rules_url("r", "s")).json()["fixes"]
    holds = client.get(rules_url("r", "q"))
    body = holds.json()
    assert (
        holds.status_code == 200
        and body["holds"] is True
        and body["fixes"] == []
        and body["fixes_found"] == 0
    )
    assert body["shared_minutes"] == 0 and visits(limiter) == 1  # nothing was searched: no slot
    both_locked = client.get(rules_url("x", "y"))
    assert both_locked.status_code == 200 and both_locked.json()["fixes"] == []
    assert visits(limiter) == 1  # two locked sets: nothing is searched, no slot
    one_free = client.get(rules_url("p", "q"))  # q can move in principle, so this is searched: one slot
    assert one_free.status_code == 200 and visits(limiter) == 2
    for refused in (
        client.get(rules_url("r", "r")),
        client.get(rules_url("r", "nobody")),
        client.get(rules_url("r", "s", limit=0)),
        client.get(rules_url("r", "s", limit=6)),
        client.get("/api/presets/nope/rule-fixes?a=r&b=s"),
    ):
        assert refused.status_code in (404, 422)
    assert visits(limiter) == 2  # refusals take no slot


def test_limit_trims_the_list_and_never_changes_the_count(client, limiter):
    bodies = {limit: client.get(rules_url("r", "s", limit=limit)).json() for limit in (1, 2, 3, 5)}
    assert visits(limiter) == 1  # computed once, sliced four times
    found = bodies[5]["fixes_found"]
    assert all(b["fixes_found"] == found for b in bodies.values())
    assert [len(bodies[n]["fixes"]) for n in (1, 2, 3, 5)] == [min(n, found, 5) for n in (1, 2, 3, 5)]
    assert bodies[1]["fixes"] == bodies[5]["fixes"][:1] and bodies[3]["fixes"] == bodies[5]["fixes"][:3]
    default = client.get(rules_url("r", "s")).json()
    assert default["fixes"] == bodies[5]["fixes"][:3]  # the default is 3


def test_both_locked_gives_no_fixes_and_a_note_the_page_can_show(client):
    body = client.get(rules_url("x", "y")).json()
    assert body["a"]["locked"] and body["b"]["locked"] and body["holds"] is False
    assert body["fixes"] == [] and body["fixes_found"] == 0 and body["single_set_places"] == 0
    one = client.get(rules_url("p", "q")).json()  # p is locked: only q could move, and q has nowhere to go
    assert one["a"]["locked"] and not one["b"]["locked"] and one["fixes"] == []


def test_the_cap_refuses_the_next_computed_answer_and_still_serves_hits(client, limiter):
    tight = RunLimiter(1, 100, 100, messages=whatif.WHATIF_MESSAGES)
    client.app.dependency_overrides[whatif.get_whatif_limiter] = lambda: tight
    assert client.get(rules_url("r", "s")).status_code == 200
    refused = client.get(rules_url("p", "q"))
    assert refused.status_code == 429 and refused.headers["cache-control"] == NO_STORE
    assert refused.json() == {"detail": "Too many what-if requests this hour. Please try again later."}
    assert client.get(rules_url("s", "r")).status_code == 200  # a hit
    assert client.get(rules_url("r", "q")).status_code == 200  # a pair that holds
    assert len(tight._visitors["testclient"]) == 1  # the refusal stored nothing
    assert decision.cached_rule_search(client.preset, "p", "q") is None  # and computed nothing


def test_unknown_things_and_hostile_values_are_refused_and_never_echoed(client):
    missing = client.get("/api/presets/nope/rule-fixes", params={"a": "r", "b": "s"})
    assert missing.status_code == 404 and missing.json() == {"detail": "No preset 'nope'."}
    assert missing.headers["cache-control"] == NO_STORE
    same = client.get(rules_url("zzz", "zzz"))  # equal ids are refused before anything is looked up
    assert same.status_code == 422 and same.json() == {"detail": "Pick two different sets."}
    assert same.headers["cache-control"] == NO_STORE
    for pair in (("r", "nobody"), ("nobody", "r")):
        unknown = client.get(rules_url(*pair))
        assert unknown.status_code == 404
        assert unknown.json() == {"detail": "That set is not on this festival day."}
        assert "nobody" not in unknown.text and unknown.headers["cache-control"] == NO_STORE
    hostile = ["x" * 200, "<script>alert(1)</script>", "a b", "r;s", "%00", "r" * 81, ""]
    for value in hostile:
        for params in ({"a": value, "b": "s"}, {"a": "r", "b": value}):
            response = client.get("/api/presets/day/rule-fixes", params=params)
            assert response.status_code == 422, (value, response.status_code)
            assert "script" not in response.text and "xxxx" not in response.text
            assert all(set(error) == {"loc", "msg", "type"} for error in response.json()["detail"])
    for params in ({}, {"a": "r"}, {"b": "s"}, {"a": "r", "b": "s", "limit": "many"}):
        assert client.get("/api/presets/day/rule-fixes", params=params).status_code == 422
    long_preset = client.get("/api/presets/" + "p" * 200 + "/rule-fixes", params={"a": "r", "b": "s"})
    assert long_preset.status_code == 422 and "pppp" not in long_preset.text


def test_the_rule_cache_is_bounded_and_keyed_on_the_unordered_pair(client, monkeypatch):
    preset = client.preset
    first = decision.rule_search(preset, "s", "r")
    assert decision.rule_search(preset, "r", "s") is first
    assert list(decision._rules) == [("day", ("r", "s"))]
    monkeypatch.setattr(decision, "CACHE_SIZE", 2)
    for pair in (("x", "y"), ("r", "z1"), ("p", "q"), ("x", "z1")):  # the first two are never stored
        decision.rule_search(preset, *pair)
    assert len(decision._rules) == 2
    assert [key[1] for key in decision._rules] == [("p", "q"), ("x", "z1")]  # the oldest went first


def test_no_qloo_request_is_made_by_either_route(client):
    # build_app overrides get_qloo with a client whose transport fails the test on any request
    assert client.get("/api/presets/day/decision").status_code == 200
    assert client.get(rules_url("r", "s")).status_code == 200
    assert client.app.dependency_overrides[get_qloo] is no_qloo


def test_the_search_leaves_the_preset_as_it_was(client):
    before = client.preset.model_dump_json()
    client.get("/api/presets/day/decision")
    client.get(rules_url("r", "s"))
    client.get(rules_url("x", "y"))
    assert client.preset.model_dump_json() == before
    assert client.preset.festival.constraints.no_clash_with == []


def test_the_config_baseline_is_the_published_one(client):
    state = published_state(client.preset)
    assert isinstance(state["config"], ScoringConfig) and state["config"].baseline is not None


# ------------------------------------------------------------------ single flight, metering, the cache


def test_racing_first_requests_for_one_pair_take_one_slot_and_run_one_search(client, limiter, monkeypatch):
    calls = []
    real = rulefix.rule_fixes

    def slow_search(*args, **kwargs):
        calls.append(1)
        threading.Event().wait(0.15)  # a forced delay: every racer has arrived before the first finishes
        return real(*args, **kwargs)

    monkeypatch.setattr(rulefix, "rule_fixes", slow_search)
    tight = RunLimiter(1, 100, 100, messages=whatif.WHATIF_MESSAGES)  # one slot: a second one would be a 429
    client.app.dependency_overrides[whatif.get_whatif_limiter] = lambda: tight
    start = threading.Barrier(8)
    results: list = []

    def ask(a: str, b: str):
        start.wait()
        response = client.get(rules_url(a, b))
        results.append((response.status_code, response.json()))

    threads = [threading.Thread(target=ask, args=("r", "s") if n % 2 else ("s", "r")) for n in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(calls) == 1
    assert len(tight._visitors["testclient"]) == 1
    assert [status for status, _ in results] == [200] * 8
    assert {json.dumps(body["fixes"]) for _, body in results} == {json.dumps(results[0][1]["fixes"])}


def test_answers_that_cost_nothing_never_enter_the_cache_and_cannot_evict_a_computed_one(tmp_path):
    """700 distinct pairs that share no minute leave the computed answers where they were."""
    locked = {"locked": True}  # the fillers cannot move: the two searches stay small
    sets = [(f"s{k:02d}", 0, "main", 60 + 30 * k, 90 + 30 * k, locked if k > 1 else {}) for k in range(40)]
    sets += [("u", 0, "side", 60, 90), ("v", 0, "side", 90, 120)]  # each overlaps one of the sets above
    ids = [row[0] for row in sets]
    festival = make_festival(sets, hours={"main": [(0, 0, 1440)], "side": [(0, 0, 1440)]})
    matrix = make_matrix(ids, {("s00", "u"): 0.5, ("s01", "v"): 0.5}, default=0.05)
    data = {
        "id": "big",
        "title": "Big",
        "festival": festival.model_dump(mode="json"),
        "matrix": matrix.model_dump(mode="json"),
        "report": score_festival(festival, matrix).model_dump(mode="json"),
    }
    (tmp_path / "big.json").write_text(json.dumps(data), encoding="utf-8")
    preset = get_presets(Settings(presets_dir=tmp_path, _env_file=None))["big"]
    clear_caches()
    try:
        computed = [decision.rule_search(preset, "s00", "u"), decision.rule_search(preset, "s01", "v")]
        assert all(not answer["holds"] for answer in computed) and len(decision._rules) == 2
        distinct = [
            (a, b)
            for i, a in enumerate(ids)
            for b in ids[i + 1 :]
            if rulefix.published_shared(festival, a, b) == 0
        ]
        assert len(distinct) >= 700
        for a, b in distinct[:700]:
            answer = decision.rule_search(preset, a, b)
            assert answer["holds"] is True and answer["fixes"] == []
        assert len(decision._rules) == 2  # nothing free was stored
        assert decision.rule_search(preset, "u", "s00") is computed[0]  # still a hit: no engine call
        assert decision.cached_rule_search(preset, "s01", "v") is computed[1]
        assert len(decision._key_locks) == 2  # and none of them took a lock
    finally:
        clear_caches()


# ----------------------------------------------------------------------------------------- warm step


def test_warm_computes_every_day_with_sets_and_the_request_is_then_a_hit(client, monkeypatch):
    clear_caches()
    took = decision.warm({"day": client.preset})
    assert set(took) == {"day"} and took["day"] >= 0
    assert set(decision._decisions) == {("day", 0)}
    calls = []
    monkeypatch.setattr(decision, "compute_decision", lambda *a, **k: calls.append(1))
    assert client.get("/api/presets/day/decision").status_code == 200 and calls == []


def test_application_startup_warms_the_presets_it_serves(tmp_path):
    write_day(tmp_path)
    build_app(tmp_path)
    clear_caches()
    try:
        with TestClient(app):
            assert set(decision._decisions) == {("day", 0)}
    finally:
        clear_caches()
        app.dependency_overrides.clear()


def test_a_cold_request_for_one_day_never_waits_for_another_or_for_a_rule_search(client, monkeypatch):
    preset = client.preset
    release, entered = threading.Event(), threading.Event()
    real = decision.compute_decision

    def slow_day_zero(p, day):
        if day == 0:
            entered.set()
            assert release.wait(10)
        return real(p, 0) if day == 0 else {"kind": "decision", "day": day}

    monkeypatch.setattr(decision, "compute_decision", slow_day_zero)
    clear_caches()
    first = threading.Thread(target=decision.decision, args=(preset, 0))
    first.start()
    assert entered.wait(10)
    try:
        # day 1 is another key: it returns while day 0 is still computing
        assert decision.decision(preset, 1) == {"kind": "decision", "day": 1}
        # a rule search for a pair is another key too
        assert decision.rule_search(preset, "p", "q")["a"]["act_id"] == "p"
        waiting = threading.Thread(target=decision.decision, args=(preset, 0))
        waiting.start()
        waiting.join(0.2)
        assert waiting.is_alive()  # the same day waits on its own lock
    finally:
        release.set()
        first.join(10)
    waiting.join(10)
    assert not waiting.is_alive() and decision.decision(preset, 0)["kind"] == "decision"
