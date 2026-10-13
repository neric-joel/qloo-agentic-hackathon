"""The preset build script, run against an invented Qloo (httpx MockTransport): no request leaves the test.

``--location`` (off by default) sends the festival's city with every audience ranking and the preset records
it; without it no ranking carries a location and the preset records null. A rebuild from the saved responses
sends nothing and keeps each saved answer's request id. Every answer, id and affinity here is invented."""

import argparse
import importlib.util
import random
from pathlib import Path

import httpx
import pytest

from app.config import Settings
from app.qloo.client import QlooClient
from app.schedule.synthetic import synthetic_festival

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "build_preset.py"
LOCATION = "signal.location.query"


def load_script():
    spec = importlib.util.spec_from_file_location("build_preset_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class InventedQloo:
    """Each searched name is its own artist; rankings use a made-up, repeatable affinity."""

    def __init__(self, *, refuse: bool = False):
        self.refuse = refuse  # any request fails the test (a rebuild must be served from the saved answers)
        self.seen: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.refuse:
            raise AssertionError(f"a request was sent: {request.url.path}")
        self.seen.append(request)
        headers = {
            "x-qloo-request-id": f"req-invented-{len(self.seen)}",
            "x-month-ratelimit-remaining": "9000",
        }
        params = request.url.params
        if request.url.path == "/search":
            name = params["query"]
            result = {"entity_id": f"q:{name}", "name": name, "popularity": 0.6, "tags": []}
            return httpx.Response(200, json={"results": [result]}, headers=headers)
        signal = params["signal.interests.entities"]
        entities = [
            {"entity_id": c, "name": c, "query": {"affinity": random.Random(f"{signal}|{c}").uniform(0.1, 1)}}
            for c in params["filter.results.entities"].split(",")
        ]
        return httpx.Response(200, json={"results": {"entities": entities}}, headers=headers)


@pytest.fixture
def script(monkeypatch):
    module = load_script()
    monkeypatch.setattr(module, "get_settings", lambda: Settings(_env_file=None, qloo_api_key="test-key"))
    return module


def build(script, monkeypatch, fake: InventedQloo, cache: Path, *, location: bool) -> dict:
    def client(*args, **kwargs):
        return QlooClient(
            *args, **{**kwargs, "max_rps": None, "transport": httpx.MockTransport(fake.handler)}
        )

    monkeypatch.setattr(script, "QlooClient", client)
    args = argparse.Namespace(
        festival="riot-fest-2026",
        day="Sun",
        stages="main",
        start_after=None,
        id=None,
        title=None,
        cache=cache,
        location=location,
    )
    return script.asyncio.run(script.build(args))


def rankings(fake: InventedQloo) -> list[httpx.Request]:
    return [request for request in fake.seen if request.url.path == "/v2/insights"]


def test_without_location_no_ranking_carries_one_and_the_preset_records_null(script, monkeypatch, tmp_path):
    fake = InventedQloo()
    preset = build(script, monkeypatch, fake, tmp_path / "cache", location=False)
    assert rankings(fake), "the build ranked the lineup"
    assert all(LOCATION not in request.url.params for request in fake.seen)
    assert preset["location"] is None
    assert all(LOCATION not in request["params"] for request in preset["requests"])


def test_with_location_every_ranking_carries_the_festivals_city_and_the_preset_records_it(
    script, monkeypatch, tmp_path
):
    fake = InventedQloo()
    preset = build(script, monkeypatch, fake, tmp_path / "cache", location=True)
    city = preset["festival"]["city"]
    assert city
    sent = rankings(fake)
    assert sent and all(request.url.params.get(LOCATION) == city for request in sent)
    searches = [request for request in fake.seen if request.url.path == "/search"]
    assert searches and all(LOCATION not in request.url.params for request in searches)
    assert preset["location"] == city
    saved = [request for request in preset["requests"] if request["path"] == "/v2/insights"]
    assert len(saved) == len(sent) and all(request["params"][LOCATION] == city for request in saved)


def test_a_rebuild_from_the_saved_answers_sends_nothing_and_keeps_each_request_id(
    script, monkeypatch, tmp_path
):
    cache = tmp_path / "cache"
    first = build(script, monkeypatch, InventedQloo(), cache, location=False)
    again = build(script, monkeypatch, InventedQloo(refuse=True), cache, location=False)
    assert first["requests"] and all(not request["cached"] for request in first["requests"])
    assert all(request["cached"] for request in again["requests"])
    ids = {(r["path"], tuple(sorted(r["params"].items()))): r["request_id"] for r in first["requests"]}
    assert all(r["request_id"] and r["request_id"].startswith("req-invented-") for r in again["requests"])
    assert all(
        ids[(r["path"], tuple(sorted(r["params"].items())))] == r["request_id"] for r in again["requests"]
    )
    assert again["matrix"] == first["matrix"]


def test_location_needs_a_city(script):
    festival, _ = synthetic_festival(3, days=1, acts=6)
    festival = festival.model_copy(update={"city": None})
    assert script.festival_location(festival, False) is None
    with pytest.raises(SystemExit, match="needs a city"):
        script.festival_location(festival, True)
