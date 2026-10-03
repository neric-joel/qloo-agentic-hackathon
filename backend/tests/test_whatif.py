"""The human what-if: the moves endpoint (the agent's find_moves search on the published day, with the clashes
now and after each place) and the plan endpoint (kept moves priced stacked on the published day); no model,
no session, no Qloo request, the agent tool's data as is, and a cap on computed answers."""

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import whatif
from app.agent.clash_tools import FIND_MOVES, TRY_MOVE, compute_move_options
from app.agent.tools import ToolContext
from app.config import Settings, get_settings
from app.limits import RunLimiter, stamp_signature
from app.main import app, get_qloo
from app.presets import CACHE_CONTROL, get_presets
from app.qloo.client import QlooClient
from app.runs import published_state
from app.schedule.metrics import score_festival
from app.schedule.models import parse_minutes
from tests.test_clash_runs import write_preset
from tests.test_clash_tools import moved_to

AGENT_KEYS = {"kind", "act", "from", "movable", "clash_budget_before", "legal_places", "searched", "options"}
AGENT_OPTION_KEYS = {"move", "stage", "start", "clash_budget_after"}
AGENT_FROZEN_KEYS = {"kind", "act", "from", "movable", "why", "options"}
ENDPOINT_KEYS = AGENT_KEYS | {"act_id", "priced", "why", "clashes_now"}
ENDPOINT_OPTION_KEYS = AGENT_OPTION_KEYS | {"stage_id", "end", "day", "clashes_after"}
PLAN_KEYS = {"kind", "published_budget", "plan", "options"}
STEP_KEYS = {"act", "act_id", "move", "stage", "stage_id", "day", "start", "end", "budget_after"}
NO_STORE = "no-store"
ILLEGAL_STEP_1 = "Step 1 is not a legal place for that set after the steps before it."
ILLEGAL_STEP_2 = "Step 2 is not a legal place for that set after the steps before it."


def no_qloo() -> QlooClient:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise AssertionError("the moves endpoint never calls Qloo")

    return QlooClient("test-key", max_rps=None, transport=httpx.MockTransport(refuse))


@pytest.fixture
def preset(tmp_path, monkeypatch):
    data = write_preset(tmp_path)
    if not any(slot["locked"] for slot in data["festival"]["timetable"]):
        data["festival"]["timetable"][0]["locked"] = True
        (tmp_path / "day.json").write_text(json.dumps(data), encoding="utf-8")
    app.dependency_overrides[get_settings] = lambda: Settings(presets_dir=tmp_path, _env_file=None)
    app.dependency_overrides[get_qloo] = no_qloo
    # The limiter reads its caps from the settings the first time it is built: the defaults, not a local .env
    monkeypatch.setattr(whatif, "get_settings", lambda: Settings(presets_dir=tmp_path, _env_file=None))
    with whatif._cache_lock:
        whatif._cache.clear()
        whatif._plans.clear()
        whatif._illegal.clear()
    whatif._limiter = None  # a fresh cap per test
    yield get_presets(Settings(presets_dir=tmp_path, _env_file=None))["day"]
    app.dependency_overrides.clear()
    whatif._limiter = None


def movable_ids(preset) -> list[str]:
    return [slot.act_id for slot in preset.festival.timetable if not slot.locked]


def moves(client: TestClient, act: str, headers: dict[str, str] | None = None, **params):
    return client.get("/api/presets/day/moves", params={"act": act, **params}, headers=headers)


async def agent_find_moves(preset, act: str, limit: int) -> dict:
    ctx = ToolContext(qloo=no_qloo(), state=published_state(preset))
    return (await FIND_MOVES.handler({"act": act, "limit": limit}, ctx)).data


async def test_the_endpoint_lists_the_places_find_moves_finds_in_the_same_order(preset):
    with TestClient(app) as client:
        for act in movable_ids(preset):
            response = moves(client, act, limit=8)
            assert response.status_code == 200
            assert response.headers["cache-control"] == CACHE_CONTROL
            body = response.json()
            state = published_state(preset)
            plain = compute_move_options(state["festival"], state["matrix"], state["config"], act, 8)
            agent = await agent_find_moves(preset, act, 8)
            assert body["kind"] == "move_options" and body["act_id"] == act
            assert body["legal_places"] == plain["legal_places"] == agent["legal_places"]
            assert [o["move"] for o in body["options"]] == [o["move"] for o in plain["options"]]
            afters = [o["clash_budget_after"] for o in body["options"]]
            assert afters == sorted(afters)
            if body["options"]:
                first = body["options"][0]
                assert {key: first[key] for key in AGENT_OPTION_KEYS} == agent["options"][0]


async def test_the_agent_tool_data_keeps_its_shape(preset):
    locked = next(slot.act_id for slot in preset.festival.timetable if slot.locked)
    act = movable_ids(preset)[0]
    data = await agent_find_moves(preset, act, 5)
    assert set(data) == AGENT_KEYS
    assert data["options"] and all(set(o) == AGENT_OPTION_KEYS for o in data["options"])
    assert set(await agent_find_moves(preset, locked, 5)) == AGENT_FROZEN_KEYS


def test_the_endpoint_body_follows_the_contract(preset):
    act = movable_ids(preset)[0]
    with TestClient(app) as client:
        body = moves(client, act).json()
    assert set(body) == ENDPOINT_KEYS and body["why"] is None and body["movable"] is True
    assert body["searched"] == "every start on a 5-minute grid in the free time it may use"
    assert body["options"] and len(body["options"]) <= 8
    stages = {stage.id: stage.name for stage in preset.festival.stages}
    for option in body["options"]:
        assert set(option) == ENDPOINT_OPTION_KEYS
        assert stages[option["stage_id"]] == option["stage"] and option["day"] == 0
        assert option["move"].endswith(f"{option['stage']} {option['start']}-{option['end']}")
    assert "matrix" not in json.dumps(body) and "values" not in body


def test_partner_lists_are_index_points_at_most_three_largest_first(preset):
    with TestClient(app) as client:
        bodies = [moves(client, act, limit=12).json() for act in movable_ids(preset)]
    lists = [b["clashes_now"] for b in bodies] + [o["clashes_after"] for b in bodies for o in b["options"]]
    assert any(lists)
    for partners in lists:
        assert len(partners) <= 3
        assert all(set(p) == {"with", "points"} and round(p["points"], 1) == p["points"] for p in partners)
        points = [p["points"] for p in partners]
        assert points == sorted(points, reverse=True)


async def test_partner_points_match_what_try_move_gives_the_model(preset):
    act = movable_ids(preset)[0]
    with TestClient(app) as client:
        body = moves(client, act, limit=3).json()
    assert body["options"] and body["clashes_now"]
    ctx = ToolContext(qloo=no_qloo(), state=published_state(preset))
    for option in body["options"]:
        tried = await TRY_MOVE.handler(
            {"act": act, "stage": option["stage_id"], "start": option["start"]}, ctx
        )
        content = json.loads(tried.content)
        before = list(content["clash_index_points_before"].items())[:3]
        after = list(content["clash_index_points_after"].items())[:3]
        assert [(p["with"], p["points"]) for p in body["clashes_now"]] == before
        assert [(p["with"], p["points"]) for p in option["clashes_after"]] == after


def test_a_locked_set_cannot_move(preset):
    locked = next(slot.act_id for slot in preset.festival.timetable if slot.locked)
    with TestClient(app) as client:
        body = moves(client, locked).json()
    assert body["movable"] is False and body["options"] == [] and body["why"] == "locked in place"
    assert body["act_id"] == locked and "clashes_now" not in body and "legal_places" not in body


def test_unknown_presets_sets_and_bad_limits_are_refused(preset):
    act = movable_ids(preset)[0]
    with TestClient(app) as client:
        no_preset = client.get("/api/presets/nope/moves", params={"act": act})
        no_set = moves(client, "someone-else")
        hostile = moves(client, "<script>" + "x" * 60)
        long = moves(client, "x" * 81)
        bad = [moves(client, act, limit=value) for value in (0, 13, "many")]
        edges = [moves(client, act, limit=value) for value in (1, 12)]
    assert no_preset.status_code == 404 and no_preset.json() == {"detail": "No preset 'nope'."}
    for response in (no_set, hostile):
        assert response.status_code == 404
        assert response.json() == {"detail": "That set is not on this festival day."}
    assert "someone-else" not in no_set.text and "script" not in hostile.text
    for response in (long, *bad):
        assert response.status_code == 422
        assert all(set(error) == {"loc", "msg", "type"} for error in response.json()["detail"])
    assert [len(r.json()["options"]) for r in edges] == [1, min(12, edges[1].json()["legal_places"])]


def test_answers_are_cached_and_the_cache_stays_bounded(preset, monkeypatch):
    calls = []
    real = whatif.compute_move_options

    def counted(*args, **kwargs):
        calls.append(args[3:5])
        return real(*args, **kwargs)

    monkeypatch.setattr(whatif, "compute_move_options", counted)
    acts = movable_ids(preset)
    first = whatif.move_options(preset, acts[0], 8)
    assert whatif.move_options(preset, acts[0], 8) is first
    with TestClient(app) as client:
        assert moves(client, acts[0]).json() == json.loads(json.dumps(first))
        for i in range(500):  # unknown sets never reach the search or the cache
            assert moves(client, f"nobody-{i}").status_code == 404
    assert len(calls) == 1 and len(whatif._cache) == 1

    monkeypatch.setattr(whatif, "CACHE_SIZE", 3)
    for limit in range(1, 7):
        whatif.move_options(preset, acts[1], limit)
    assert len(whatif._cache) == 3
    assert list(whatif._cache) == [("day", acts[1], limit) for limit in (4, 5, 6)]


def test_moves_says_whether_the_set_is_priced(preset):
    unpriced = [a for a in movable_ids(preset) if preset.matrix.coverage_of(a) == "none"]
    priced = [a for a in movable_ids(preset) if a not in unpriced]
    locked = next(slot.act_id for slot in preset.festival.timetable if slot.locked)
    assert unpriced and priced
    with TestClient(app) as client:
        none = moves(client, unpriced[0], limit=12).json()
        some = moves(client, priced[0]).json()
        frozen = moves(client, locked).json()
    assert none["priced"] is False and some["priced"] is True and frozen["priced"] is True
    # Not priced: every place leaves the Clash Budget Index where it is, and no clash is listed
    assert none["options"] and {o["clash_budget_after"] for o in none["options"]} == {
        none["clash_budget_before"]
    }
    assert none["clashes_now"] == [] and all(o["clashes_after"] == [] for o in none["options"])


# --------------------------------------------------------------------------------------- the cap


def visits(client: TestClient) -> int:
    """Computed answers counted for the test client's own address."""
    return len(whatif.get_whatif_limiter()._visitors.get("testclient", ()))


def test_the_cap_is_per_visitor_and_per_day_with_the_planned_numbers(monkeypatch):
    for name in ("WHATIF_PER_VISITOR_HOUR", "WHATIF_PER_VISITOR_DAY", "WHATIF_PER_DAY"):
        monkeypatch.delenv(name, raising=False)
    settings = Settings(_env_file=None)
    caps = (settings.whatif_per_visitor_hour, settings.whatif_per_visitor_day, settings.whatif_per_day)
    assert caps == (300, 1_500, 5_000)
    monkeypatch.setattr(whatif, "get_settings", lambda: settings)
    whatif._limiter = None
    limiter = whatif.get_whatif_limiter()
    assert (limiter.per_hour, limiter.per_day, limiter.global_per_day) == (300, 1_500, 5_000)
    assert limiter.messages == whatif.WHATIF_MESSAGES
    assert whatif.get_whatif_limiter() is limiter
    assert not hasattr(whatif, "MOVES_PER_VISITOR_HOUR")  # the caps live in the settings only
    whatif._limiter = None


def test_the_caps_come_from_the_settings(monkeypatch):
    settings = Settings(_env_file=None, whatif_per_visitor_hour=7, whatif_per_visitor_day=8, whatif_per_day=9)
    monkeypatch.setattr(whatif, "get_settings", lambda: settings)
    whatif._limiter = None
    limiter = whatif.get_whatif_limiter()
    assert (limiter.per_hour, limiter.per_day, limiter.global_per_day) == (7, 8, 9)
    whatif._limiter = None


def test_the_301st_computed_moves_answer_in_an_hour_is_refused(preset):
    acts = movable_ids(preset)
    with TestClient(app) as client:
        assert moves(client, "nobody").status_code == 404
        assert client.get("/api/presets/nope/moves", params={"act": acts[0]}).status_code == 404
        assert moves(client, acts[0], limit=0).status_code == 422
        assert visits(client) == 0  # refused requests take no slot
        assert moves(client, acts[0]).status_code == 200
        assert moves(client, acts[0]).status_code == 200  # a cache hit takes no slot
        assert visits(client) == 1
        limiter = whatif.get_whatif_limiter()
        for _ in range(299):
            assert limiter.try_acquire("testclient") is None
        refused = moves(client, acts[1])
        assert refused.status_code == 429
        assert refused.json() == {"detail": "Too many what-if requests this hour. Please try again later."}
        assert refused.headers["cache-control"] == NO_STORE
        assert visits(client) == 300  # a refusal stores nothing
        assert moves(client, acts[0]).status_code == 200  # still served from the cache
        stacked = client.post("/api/presets/day/whatif", json={"moves": [], "act": acts[2]})
        assert stacked.status_code == 429 and stacked.headers["cache-control"] == NO_STORE
        elsewhere = moves(client, acts[1], headers={"X-Forwarded-For": "203.0.113.9"})
        assert elsewhere.status_code == 200  # another visitor has slots of their own


def test_the_day_and_global_caps_have_their_own_texts(preset):
    acts = movable_ids(preset)
    day = RunLimiter(100, 2, 1_000, messages=whatif.WHATIF_MESSAGES)
    app.dependency_overrides[whatif.get_whatif_limiter] = lambda: day
    with TestClient(app) as client:
        assert moves(client, acts[0]).status_code == 200
        assert client.post("/api/presets/day/whatif", json={"moves": []}).status_code == 200
        refused = moves(client, acts[1])
    assert refused.status_code == 429 and refused.headers["cache-control"] == NO_STORE
    assert refused.json() == {
        "detail": "You have reached today's limit of what-if requests. Please try again tomorrow."
    }
    everyone = RunLimiter(100, 100, 2, messages=whatif.WHATIF_MESSAGES)
    app.dependency_overrides[whatif.get_whatif_limiter] = lambda: everyone
    with TestClient(app) as client:
        for limit, address in enumerate(("198.51.100.1", "198.51.100.2"), start=1):
            got = moves(client, acts[2], limit=limit, headers={"X-Forwarded-For": address})
            assert got.status_code == 200
        refused = client.post(
            "/api/presets/day/whatif", json={"moves": [], "act": acts[3]}, headers={"X-Forwarded-For": "x"}
        )
    assert refused.status_code == 429 and refused.headers["cache-control"] == NO_STORE
    assert refused.json() == {
        "detail": "What-if requests have reached today's limit. Please try again tomorrow."
    }


# ------------------------------------------------------------------------------------- the plan


def plan(client: TestClient, moves_: list[dict], preset_id: str = "day", **extra):
    return client.post(f"/api/presets/{preset_id}/whatif", json={"moves": moves_, **extra})


def kept(act: str, option: dict) -> dict:
    """A place ``GET /moves`` lists, as a kept move."""
    return {"act": act, "stage_id": option["stage_id"], "day": option["day"], "start": option["start"]}


def test_an_empty_plan_is_the_published_day(preset):
    act = movable_ids(preset)[0]
    with TestClient(app) as client:
        response = plan(client, [])
        bare = client.post("/api/presets/day/whatif", json={})
        listed = moves(client, act).json()
    assert response.status_code == 200 and response.headers["cache-control"] == NO_STORE
    body = response.json()
    assert bare.json() == body
    assert set(body) == PLAN_KEYS and body["kind"] == "whatif" and body["options"] is None
    assert set(body["plan"]) == {"budget", "steps", "clashes"} and body["plan"]["steps"] == []
    state = published_state(preset)
    report = score_festival(state["festival"], state["matrix"], state["config"])
    index = report.metrics.clash_budget_index
    assert body["published_budget"] == body["plan"]["budget"] == index == listed["clash_budget_before"]
    clashes = body["plan"]["clashes"]
    assert clashes == [
        {"a": c.a.name, "b": c.b.name, "points": round(c.regret_share * index, 1)} for c in report.clashes[:5]
    ]
    assert len(clashes) == 5 and [c["points"] for c in clashes] == sorted(
        (c["points"] for c in clashes), reverse=True
    )
    assert "matrix" not in response.text and "values" not in response.text


def test_one_kept_move_is_the_place_moves_lists(preset):
    with TestClient(app) as client:
        for act in movable_ids(preset):
            listed = moves(client, act, limit=3).json()
            for option in listed["options"]:
                response = plan(client, [kept(act, option)], act=act)
                assert response.status_code == 200 and response.headers["cache-control"] == NO_STORE
                body = response.json()
                (step,) = body["plan"]["steps"]
                assert set(step) == STEP_KEYS and step["act"] == listed["act"] and step["act_id"] == act
                assert body["plan"]["budget"] == step["budget_after"] == option["clash_budget_after"]
                same = ("move", "stage", "stage_id", "day", "start", "end")
                assert {key: step[key] for key in same} == {key: option[key] for key in same}
                # The set's places on the moved timetable start from there, with its clashes after the move
                places = body["options"]
                assert places["kind"] == "move_options" and places["act_id"] == act
                assert places["clash_budget_before"] == body["plan"]["budget"]
                assert places["clashes_now"] == option["clashes_after"]


def test_a_greedy_plan_reproduces_the_search_step_by_step(preset):
    state = published_state(preset)
    festival, matrix, config = state["festival"], state["matrix"], state["config"]
    chosen: list[dict] = []
    budgets: list[float] = []
    for _ in range(6):
        best = None
        for slot in festival.timetable:
            if slot.act_id in {move["act"] for move in chosen}:
                continue
            found = compute_move_options(festival, matrix, config, slot.act_id, 1, partners=True)
            if found["options"] and (
                best is None or found["options"][0]["clash_budget_after"] < best[1]["clash_budget_after"]
            ):
                best = (slot.act_id, found["options"][0])
        assert best is not None
        act, option = best
        chosen.append(kept(act, option))
        budgets.append(option["clash_budget_after"])
        festival = moved_to(festival, act, option)
    with TestClient(app) as client:
        body = plan(client, chosen).json()
        halfway = plan(client, chosen[:3]).json()
    assert [step["budget_after"] for step in body["plan"]["steps"]] == budgets
    assert body["plan"]["budget"] == budgets[-1] and body["published_budget"] > budgets[-1]
    assert [step["act_id"] for step in body["plan"]["steps"]] == [move["act"] for move in chosen]
    assert [step["budget_after"] for step in halfway["plan"]["steps"]] == budgets[:3]


def test_act_gives_its_places_on_the_moved_timetable(preset):
    first, second = movable_ids(preset)[:2]
    with TestClient(app) as client:
        option = moves(client, first).json()["options"][0]
        body = plan(client, [kept(first, option)], act=second, limit=5).json()
        unmoved = plan(client, [], act=second, limit=5).json()
        listed = moves(client, second, limit=5).json()
    state = published_state(preset)
    festival = moved_to(state["festival"], first, option)
    expected = compute_move_options(festival, state["matrix"], state["config"], second, 5, partners=True)
    assert body["options"] == json.loads(json.dumps({"kind": "move_options", **expected}))
    assert body["options"]["clash_budget_before"] == body["plan"]["budget"]
    assert len(body["options"]["options"]) <= 5
    assert unmoved["options"] == listed  # with no kept move, the places are the ones GET /moves lists


def test_each_set_is_kept_once(preset):
    act = movable_ids(preset)[0]
    with TestClient(app) as client:
        options = moves(client, act).json()["options"]
        response = plan(client, [kept(act, options[0]), kept(act, options[1])])
    assert response.status_code == 422 and response.headers["cache-control"] == NO_STORE
    assert response.json() == {"detail": "Pick each set once."}


def test_an_illegal_place_names_its_step_and_nothing_else(preset):
    acts = movable_ids(preset)
    slots = {slot.act_id: slot for slot in preset.festival.timetable}
    locked = next(slot for slot in preset.festival.timetable if slot.locked)
    first, second = acts[0], acts[1]
    other = next(slots[a] for a in acts[2:] if slots[a].stage_id != slots[second].stage_id)
    state = published_state(preset)
    with TestClient(app) as client:
        option = moves(client, first).json()["options"][0]
        moved = moved_to(state["festival"], first, option)
        legal = compute_move_options(moved, state["matrix"], state["config"], second, 1_000, partners=True)
        places = {(o["stage_id"], parse_minutes(o["start"])) for o in legal["options"]}
        here = slots[second]
        off_grid = next(
            here.start + minutes
            for minutes in range(1, 300)
            if (here.start + minutes) % 5 and (here.stage_id, here.start + minutes) not in places
        )

        def at(act: str, stage_id: str, minutes: int) -> dict:
            return {
                "act": act,
                "stage_id": stage_id,
                "day": 0,
                "start": f"{minutes // 60:02d}:{minutes % 60:02d}",
            }

        for bad in (
            at(second, other.stage_id, other.start),  # a taken slot
            at(second, "nowhere", here.start),  # no such stage
            at(second, here.stage_id, off_grid),  # off the grid
            at(locked.act_id, locked.stage_id, locked.start + 30),  # a locked set
            at(second, here.stage_id, here.start),  # where it already is
            {**at(second, here.stage_id, here.start), "day": 1},  # a day the set does not play
        ):
            response = plan(client, [kept(first, option), bad])
            assert response.status_code == 422 and response.headers["cache-control"] == NO_STORE
            assert response.json() == {"detail": ILLEGAL_STEP_2}
        first_bad = plan(client, [at(second, other.stage_id, other.start)])
        assert first_bad.json() == {"detail": ILLEGAL_STEP_1}
        # The GET /moves above, and one slot for each of the seven illegal plans: a plan is metered first
        assert visits(client) == 8


def freed_place(preset) -> tuple[dict, dict] | None:
    """A kept move, then a place for another set that overlaps the first set's published slot on its stage:
    legal only once the first set has moved."""
    state = published_state(preset)
    festival, matrix, config = state["festival"], state["matrix"], state["config"]
    movable = [slot for slot in festival.timetable if not slot.locked]
    for a in movable:
        for option in compute_move_options(festival, matrix, config, a.act_id, 3, partners=True)["options"]:
            freed = moved_to(festival, a.act_id, option)
            for b in (slot for slot in movable if slot.act_id != a.act_id):
                legal = compute_move_options(freed, matrix, config, b.act_id, 1_000, partners=True)
                for place in legal["options"]:
                    start, end = parse_minutes(place["start"]), parse_minutes(place["end"])
                    if place["stage_id"] == a.stage_id and start < a.end and a.start < end:
                        return kept(a.act_id, option), kept(b.act_id, place)
    return None


def test_a_place_freed_by_an_earlier_step_is_legal_only_in_order(preset):
    found = freed_place(preset)
    assert found is not None
    with TestClient(app) as client:
        in_order = plan(client, list(found))
        reversed_ = plan(client, list(reversed(found)))
    assert in_order.status_code == 200 and len(in_order.json()["plan"]["steps"]) == 2
    assert reversed_.status_code == 422 and reversed_.json() == {"detail": ILLEGAL_STEP_1}


def test_unknown_presets_and_sets_are_404_and_echo_no_id(preset):
    act = movable_ids(preset)[0]
    with TestClient(app) as client:
        option = moves(client, act).json()["options"][0]
        no_preset = plan(client, [], preset_id="nope")
        no_set = plan(client, [kept(act, option), kept("someone-else", option)])
        no_act = plan(client, [], act="someone-else")
        long_preset = plan(client, [], preset_id="p" * 81)
        not_post = client.get("/api/presets/day/whatif")
    assert no_preset.status_code == 404 and no_preset.json() == {"detail": "No preset 'nope'."}
    for response in (no_set, no_act):
        assert response.status_code == 404 and response.json() == {
            "detail": "That set is not on this festival day."
        }
        assert "someone-else" not in response.text
    for response in (no_preset, no_set, no_act, long_preset):
        assert response.headers["cache-control"] == NO_STORE
    assert long_preset.status_code == 422 and "p" * 81 not in long_preset.text
    assert not_post.status_code == 405


def test_bad_bodies_are_422_echo_nothing_and_take_no_slot(preset):
    act = movable_ids(preset)[0]
    marker = "HOSTILE"
    move = {"act": act, "stage_id": "main", "day": 0, "start": "12:00"}
    bodies = [
        {"moves": [{**move, "act": f"a{i}"} for i in range(9)]},  # more than 8 moves
        {"moves": [{**move, "act": marker * 2_000}]},
        {"moves": [{**move, "stage_id": marker * 2_000}]},
        {"moves": [], "act": marker * 2_000},
        {"moves": [{**move, "act": f"{marker}\x00x"}]},
        {"moves": [], "act": f"{marker}\x00"},
        {"moves": [{**move, "act": f"{marker}/../x"}]},
        *({"moves": [{**move, "day": day}]} for day in (-1, 14, "0", 1.5, True, None, 10**30)),
        *({"moves": [{**move, "start": start}]} for start in ("25:61", "noon", "1:5", "123:00", 1230, "")),
        *({"moves": [], "act": act, "limit": limit} for limit in (0, 13, "8", 2.5, None)),
        {"moves": [], "extra": marker},
        {"moves": [{**move, "extra": marker}]},
        {"moves": "all"},
        [],
    ]
    with TestClient(app) as client:
        responses = [client.post("/api/presets/day/whatif", json=body) for body in bodies]
        raw = [
            client.post(
                "/api/presets/day/whatif",
                content=b'{"moves": [{"act": "a", "stage_id": "b", "day": NaN, "start": "12:00"}]}',
                headers={"Content-Type": "application/json"},
            ),
            client.post(
                "/api/presets/day/whatif",
                content=json.dumps({"moves": []}).encode(),
                headers={"Content-Type": "text/plain"},
            ),
            client.post("/api/presets/day/whatif", content=b"{not json"),
        ]
        assert visits(client) == 0
    for response in [*responses, *raw]:
        assert response.status_code == 422, response.text
        assert response.headers["cache-control"] == NO_STORE
        assert marker not in response.text and "\\u0000" not in response.text
        assert all(set(error) == {"loc", "msg", "type"} for error in response.json()["detail"])
        assert len(response.text) < 4_000


def test_a_bad_single_move_reports_its_kind_in_the_error_path_and_nothing_else_changed(preset):
    move = {"act": "x", "stage_id": "main", "day": 0, "start": "12:00"}
    with TestClient(app) as client:
        response = client.post("/api/presets/day/whatif", json={"moves": [{**move, "start": "noon"}]})
    assert response.status_code == 422
    (error,) = response.json()["detail"]
    assert error["loc"] == ["body", "moves", 0, "move", "start"] and set(error) == {"loc", "msg", "type"}
    assert "noon" not in response.text


def test_plans_are_cached_and_the_cache_stays_bounded(preset, monkeypatch):
    app.dependency_overrides[whatif.get_whatif_limiter] = lambda: RunLimiter(
        10_000, 10_000, 10_000, messages=whatif.WHATIF_MESSAGES
    )
    calls = []
    real = whatif.apply_plan

    def counted(*args, **kwargs):
        calls.append(args[3])
        return real(*args, **kwargs)

    monkeypatch.setattr(whatif, "apply_plan", counted)
    state = published_state(preset)
    places = [
        kept(slot.act_id, option)
        for slot in state["festival"].timetable
        for option in compute_move_options(
            state["festival"], state["matrix"], state["config"], slot.act_id, 1_000, partners=True
        )["options"]
    ]
    assert len(places) >= 170
    with TestClient(app) as client:
        first = plan(client, [places[0]])
        again = plan(client, [places[0]])
        assert first.json() == again.json() and len(calls) == 1
        # Cheap places for the rest: the plan's set pricing is not what this test measures
        monkeypatch.setattr(whatif, "compute_move_options", lambda *args, **kwargs: {"stub": True})
        bodies = [
            {"moves": [place], "act": act}
            for act in (None, movable_ids(preset)[0], movable_ids(preset)[1])
            for place in places
        ][:500]
        assert len({json.dumps(body, sort_keys=True) for body in bodies}) == 500
        for body in bodies:
            assert client.post("/api/presets/day/whatif", json=body).status_code == 200
    assert len(whatif._plans) == whatif.PLAN_CACHE_SIZE == 256
    assert len(calls) == 500  # the first plan was answered from the cache the second time


def test_a_reloaded_preset_is_never_answered_from_an_older_plan(preset):
    with TestClient(app) as client:
        assert plan(client, []).status_code == 200
    (key,) = list(whatif._plans)
    assert whatif._cached_plan(preset, key) is not None
    assert whatif._cached_plan(preset.model_copy(), key) is None


def test_eight_kept_moves_is_the_most_a_plan_holds(preset):
    state = published_state(preset)
    festival, matrix, config = state["festival"], state["matrix"], state["config"]
    chosen: list[dict] = []
    for slot in [s for s in festival.timetable if not s.locked]:
        options = compute_move_options(festival, matrix, config, slot.act_id, 1, partners=True)["options"]
        if options and len(chosen) < 8:
            chosen.append(kept(slot.act_id, options[0]))
            festival = moved_to(festival, slot.act_id, options[0])
    assert len(chosen) == 8
    spare = next(s.act_id for s in festival.timetable if s.act_id not in {m["act"] for m in chosen})
    with TestClient(app) as client:
        full = plan(client, chosen, act=chosen[0]["act"])
        ninth = plan(client, [*chosen, {**chosen[0], "act": spare}])
    assert full.status_code == 200
    body = full.json()
    assert len(body["plan"]["steps"]) == 8
    assert body["plan"]["budget"] == body["plan"]["steps"][-1]["budget_after"]
    # A kept set may be priced again: its places start from where the plan put it
    assert body["options"]["from"] == body["plan"]["steps"][0]["move"].split(" -> ")[1]
    assert ninth.status_code == 422 and ninth.headers["cache-control"] == NO_STORE


# ------------------------------------------------------------- illegal plans: metered before the engine works


def counted_apply_plan(monkeypatch) -> list:
    calls: list = []
    real = whatif.apply_plan

    def counted(*args, **kwargs):
        calls.append(args[3])
        return real(*args, **kwargs)

    monkeypatch.setattr(whatif, "apply_plan", counted)
    return calls


def nowhere(act: str, i: int = 0) -> dict:
    """A kept move to a stage the day does not have: always an illegal first step."""
    return {"act": act, "stage_id": f"nowhere-{i}", "day": 0, "start": "12:00"}


def test_the_same_illegal_plan_twice_is_worked_out_once_and_takes_one_slot(preset, monkeypatch):
    calls = counted_apply_plan(monkeypatch)
    act = movable_ids(preset)[0]
    with TestClient(app) as client:
        first = plan(client, [nowhere(act)])
        again = plan(client, [nowhere(act)])
        assert visits(client) == 1
    for response in (first, again):
        assert response.status_code == 422 and response.headers["cache-control"] == NO_STORE
        assert response.json() == {"detail": ILLEGAL_STEP_1}
    assert len(calls) == 1


def test_the_failing_step_is_remembered_per_preset_and_the_memory_stays_bounded(preset):
    app.dependency_overrides[whatif.get_whatif_limiter] = lambda: RunLimiter(
        10_000, 10_000, 10_000, messages=whatif.WHATIF_MESSAGES
    )
    act = movable_ids(preset)[0]
    with TestClient(app) as client:
        for i in range(300):
            assert plan(client, [nowhere(act, i)]).status_code == 422
    assert len(whatif._illegal) == whatif.ILLEGAL_CACHE_SIZE == 256
    key = next(iter(whatif._illegal))
    assert whatif._known_illegal(preset, key) == 1
    assert whatif._known_illegal(preset.model_copy(), key) is None  # a reloaded preset works it out again


def test_a_legal_plan_refused_with_429_never_reaches_the_engine(preset, monkeypatch):
    calls = counted_apply_plan(monkeypatch)
    act = movable_ids(preset)[0]
    full = RunLimiter(0, 10, 10, messages=whatif.WHATIF_MESSAGES)
    app.dependency_overrides[whatif.get_whatif_limiter] = lambda: full
    option = whatif.move_options(preset, act, 8)["options"][0]
    with TestClient(app) as client:
        legal = plan(client, [kept(act, option)])
        illegal = plan(client, [nowhere(act)])
    for response in (legal, illegal):
        assert response.status_code == 429 and response.headers["cache-control"] == NO_STORE
        assert response.json() == {"detail": "Too many what-if requests this hour. Please try again later."}
    assert calls == []


def test_650_illegal_plans_from_one_visitor_are_300_422s_then_429s(preset, monkeypatch):
    calls = counted_apply_plan(monkeypatch)
    act = movable_ids(preset)[0]
    with TestClient(app) as client:
        codes = [plan(client, [nowhere(act, i)]).status_code for i in range(650)]
        assert visits(client) == 300
    assert codes == [422] * 300 + [429] * 350
    assert len(calls) == 300  # a refused plan never reaches the engine


def test_the_301st_cached_legal_answer_takes_no_slot(preset):
    act = movable_ids(preset)[0]
    option = whatif.move_options(preset, act, 8)["options"][0]
    with TestClient(app) as client:
        first = plan(client, [kept(act, option)])
        assert first.status_code == 200 and visits(client) == 1
        limiter = whatif.get_whatif_limiter()
        for _ in range(299):
            assert limiter.try_acquire("testclient") is None
        assert plan(client, [nowhere(act)]).status_code == 429  # the hour is used up
        again = plan(client, [kept(act, option)])
        assert visits(client) == 300
    assert again.status_code == 200 and again.json() == first.json()


def test_the_cap_keys_on_a_valid_visitor_stamp(preset, tmp_path):
    act = movable_ids(preset)[0]
    secret, visitor = "test-secret", "203.0.113.7"
    stamp = {"x-clash-visitor": visitor, "x-clash-sig": stamp_signature(secret, visitor)}
    app.dependency_overrides[get_settings] = lambda: Settings(
        presets_dir=tmp_path, visitor_stamp_secret=secret, _env_file=None
    )
    with TestClient(app) as client:
        assert moves(client, act, headers={**stamp, "X-Forwarded-For": "198.51.100.4"}).status_code == 200
        forged = {**stamp, "x-clash-sig": "0" * 64}
        assert moves(client, act, limit=3, headers=forged).status_code == 200
    counted = whatif.get_whatif_limiter()._visitors
    assert set(counted) == {"stamp:203.0.113.7", "testclient"}  # a forged stamp falls back to the address
