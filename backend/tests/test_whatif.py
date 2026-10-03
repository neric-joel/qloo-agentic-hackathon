"""The moves endpoint behind the human what-if: the agent's find_moves search on the published day, with the
clashes now and after each place; no model, no session, no Qloo request, and the agent tool's data as is."""

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import whatif
from app.agent.clash_tools import FIND_MOVES, TRY_MOVE, compute_move_options
from app.agent.tools import ToolContext
from app.config import Settings, get_settings
from app.main import app, get_qloo
from app.presets import CACHE_CONTROL, get_presets
from app.qloo.client import QlooClient
from app.runs import published_state
from tests.test_clash_runs import write_preset

AGENT_KEYS = {"kind", "act", "from", "movable", "clash_budget_before", "legal_places", "searched", "options"}
AGENT_OPTION_KEYS = {"move", "stage", "start", "clash_budget_after"}
AGENT_FROZEN_KEYS = {"kind", "act", "from", "movable", "why", "options"}
ENDPOINT_KEYS = AGENT_KEYS | {"act_id", "why", "clashes_now"}
ENDPOINT_OPTION_KEYS = AGENT_OPTION_KEYS | {"stage_id", "end", "day", "clashes_after"}


def no_qloo() -> QlooClient:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise AssertionError("the moves endpoint never calls Qloo")

    return QlooClient("test-key", max_rps=None, transport=httpx.MockTransport(refuse))


@pytest.fixture
def preset(tmp_path):
    data = write_preset(tmp_path)
    if not any(slot["locked"] for slot in data["festival"]["timetable"]):
        data["festival"]["timetable"][0]["locked"] = True
        (tmp_path / "day.json").write_text(json.dumps(data), encoding="utf-8")
    app.dependency_overrides[get_settings] = lambda: Settings(presets_dir=tmp_path, _env_file=None)
    app.dependency_overrides[get_qloo] = no_qloo
    with whatif._cache_lock:
        whatif._cache.clear()
    yield get_presets(Settings(presets_dir=tmp_path, _env_file=None))["day"]
    app.dependency_overrides.clear()


def movable_ids(preset) -> list[str]:
    return [slot.act_id for slot in preset.festival.timetable if not slot.locked]


def moves(client: TestClient, act: str, **params):
    return client.get("/api/presets/day/moves", params={"act": act, **params})


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
