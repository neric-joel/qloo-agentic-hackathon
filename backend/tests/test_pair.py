"""The live pair check: three live Qloo requests, recomputed beside the saved value, never a cached or saved
answer served as live, refused before any request when it is off, the pair cannot be priced or the month is
below the floor, and capped per visitor and per day. Every preset, row and answer here is synthetic."""

import asyncio
import json
import logging
import random
import re
from dataclasses import dataclass

import httpx
import pytest
from fastapi.testclient import TestClient

from app import deps, pair
from app.config import Settings, get_settings
from app.deps import get_pair_limiter
from app.limits import PAIR_MESSAGES, RunLimiter
from app.main import app, get_qloo
from app.qloo.client import QlooClient, normalize_params, request_key
from app.qloo.overlap import percentiles, rank_position
from app.schedule.metrics import score_festival
from app.schedule.models import OverlapMatrix
from app.schedule.synthetic import synthetic_festival

CONTROLS = ("ctl:one", "ctl:two")
TAGS = [
    {"name": "Hearth Folk", "tag_id": "t:1", "subtype": "urn:tag:genre:music", "query": {"score": 0.61}},
    {"name": "Somewhere", "tag_id": "t:2", "subtype": "urn:tag:region:qloo", "query": {"score": 0.97}},
    {"name": "Longing", "tag_id": "t:3", "subtype": "urn:tag:theme:qloo", "query": {"score": 0.7}},
]


def affinity(signal: str, candidate: str) -> float:
    """A made-up, repeatable affinity of a candidate for a signal's audience (controls score low)."""
    low, high = (0.0, 0.1) if candidate in CONTROLS else (0.2, 1.0)
    return random.Random(f"{signal}|{candidate}").uniform(low, high)


@dataclass
class Day:
    preset: dict
    ids: list[str]  # festival act ids
    qloo_ids: dict[str, str]
    candidates: dict[str, list[str]]  # act id -> the Qloo ids its saved row ranks
    no_qloo_id: str
    no_signal: str
    no_row: str
    two_rows: str

    def pair(self) -> tuple[str, str]:
        return self.ids[0], self.ids[1]


def make_day(directory) -> Day:
    """A festival day whose matrix is built from ``affinity`` exactly as the preset build does it."""
    festival, _ = synthetic_festival(5, days=1, acts=12)
    ids = [act.id for act in festival.acts]
    no_qloo_id, no_signal, no_row, two_rows = ids[-1], ids[-2], ids[-3], ids[-4]
    qloo_ids = {act_id: f"q:{act_id}" for act_id in ids if act_id != no_qloo_id}
    usable = [act_id for act_id in ids if act_id not in (no_qloo_id, no_signal)]
    candidates = {x: [qloo_ids[y] for y in usable if y != x] + list(CONTROLS) for x in usable}
    rows = {x: percentiles({c: affinity(qloo_ids[x], c) for c in candidates[x]}) for x in usable}
    values = [
        [
            round((rows[x][qloo_ids[y]] + rows[y][qloo_ids[x]]) / 2, 4)
            if x != y and {x, y} <= rows.keys()
            else 0.0
            for y in ids
        ]
        for x in ids
    ]
    matrix = OverlapMatrix(
        act_ids=ids, values=values, coverage={no_qloo_id: "none", no_signal: "none"}, source="synthetic"
    )
    festival = festival.model_copy(
        update={"acts": [act.model_copy(update={"qloo_id": qloo_ids.get(act.id)}) for act in festival.acts]}
    )

    def saved(x: str) -> dict:
        params = {
            "filter.type": "urn:entity:artist",
            "signal.interests.entities": qloo_ids[x],
            "filter.results.entities": ",".join(candidates[x]),
            "take": str(len(candidates[x])),
        }
        return {"path": "/v2/insights", "params": params, "status": 200, "cached": False, "request_id": None}

    search = {"path": "/search", "params": {"query": "Some Act"}, "status": 200, "cached": False}
    requests = [search] + [saved(x) for x in usable if x != no_row] + [saved(two_rows)]
    preset = {
        "id": "day",
        "title": "Day",
        "festival": festival.model_dump(mode="json"),
        "matrix": matrix.model_dump(mode="json"),
        "report": score_festival(festival, matrix).model_dump(mode="json"),
        "requests": requests,
    }
    (directory / "day.json").write_text(json.dumps(preset), encoding="utf-8")
    return Day(preset, ids, qloo_ids, candidates, no_qloo_id, no_signal, no_row, two_rows)


class FakeQloo:
    """A Qloo stand-in: answers rankings from an affinity function and comparisons with ``TAGS``."""

    def __init__(self, score=affinity, *, remaining: str | None = "9000", fail: str | None = None, drop=None):
        self.score = score
        self.remaining = remaining
        self.fail = fail  # a path that answers 500
        self.drop = drop  # a Qloo id left out of every ranking
        self.seen: list[httpx.Request] = []
        self.delay = 0.0

    async def handler(self, request: httpx.Request) -> httpx.Response:
        self.seen.append(request)
        if self.delay:
            await asyncio.sleep(self.delay)
        headers = {"x-qloo-request-id": f"req-{len(self.seen)}"}
        if self.remaining is not None:
            headers["x-month-ratelimit-remaining"] = self.remaining
        if request.url.path == self.fail:
            return httpx.Response(500, json={"error": {"reason": "down"}}, headers=headers)
        params = request.url.params
        if request.url.path == "/v2/analysis/compare":
            return httpx.Response(200, json={"results": {"tags": TAGS}}, headers=headers)
        signal = params["signal.interests.entities"]
        entities = [
            {"entity_id": c, "name": c, "query": {"affinity": self.score(signal, c)}}
            for c in reversed(params["filter.results.entities"].split(","))
            if c != self.drop
        ]
        return httpx.Response(200, json={"results": {"entities": entities}}, headers=headers)

    def client(self, **kwargs) -> QlooClient:
        kwargs.setdefault("backoff", 0)
        kwargs.setdefault("max_rps", None)
        return QlooClient("test-key", transport=httpx.MockTransport(self.handler), **kwargs)


@pytest.fixture
def day(tmp_path):
    yield make_day(tmp_path)
    app.dependency_overrides.clear()


def serve(tmp_path, qloo: QlooClient, limiter: RunLimiter | None = None, **settings) -> None:
    values = {"pair_check_enabled": True, "qloo_api_key": "test-key", **settings}
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None, presets_dir=tmp_path, **values)
    app.dependency_overrides[get_qloo] = lambda: qloo
    app.dependency_overrides[get_pair_limiter] = lambda: (
        limiter or RunLimiter(100, 100, 100, messages=PAIR_MESSAGES)
    )


def check(client: TestClient, a: str, b: str, preset: str = "day", **headers):
    return client.get("/api/pair", params={"preset": preset, "a": a, "b": b}, headers=headers)


def no_store(response) -> bool:
    return response.headers.get("cache-control") == "no-store"


# ------------------------------------------------------------------------------------------- answers


def test_a_check_returns_three_live_requests_in_order_and_the_saved_value(tmp_path, day):
    fake = FakeQloo()
    serve(tmp_path, fake.client())
    a, b = day.pair()
    with TestClient(app) as client:
        response = check(client, a, b)
    assert response.status_code == 200, response.text
    assert no_store(response)
    body = response.json()
    assert set(body) == {
        "preset_id",
        "fetched_at",
        "a",
        "b",
        "taste_overlap",
        "rankings",
        "tags",
        "requests",
    }
    acts = {act["id"]: act for act in day.preset["festival"]["acts"]}
    assert body["preset_id"] == "day"
    assert body["a"] == {"act_id": a, "name": acts[a]["name"]}
    assert body["b"] == {"act_id": b, "name": acts[b]["name"]}
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", body["fetched_at"])

    saved = OverlapMatrix.model_validate(day.preset["matrix"]).value(a, b)
    assert body["taste_overlap"] == {"live": saved, "saved": saved}

    requests = body["requests"]
    assert [r["path"] for r in requests] == ["/v2/insights", "/v2/insights", "/v2/analysis/compare"]
    assert [r["params"]["signal.interests.entities"] for r in requests[:2]] == [
        day.qloo_ids[a],
        day.qloo_ids[b],
    ]
    assert requests[2]["params"] == {
        "a.signal.interests.entities": day.qloo_ids[a],
        "b.signal.interests.entities": day.qloo_ids[b],
        "take": "50",
    }
    assert all(
        (r["status"], r["cached"], r["recorded"]) == (200, False, False) and r["latency_ms"] >= 0
        for r in requests
    )
    ids = [r["request_id"] for r in requests]
    assert all(ids) and len(set(ids)) == 3 and set(ids) == {"req-1", "req-2", "req-3"}

    def place(x: str, y: str) -> tuple[int, int]:
        scores = {c: affinity(day.qloo_ids[x], c) for c in day.candidates[x]}
        return rank_position(scores, day.qloo_ids[y])

    assert body["rankings"] == [
        {"for_act_id": a, "partner_act_id": b, "position": place(a, b)[0], "of": len(day.candidates[a])},
        {"for_act_id": b, "partner_act_id": a, "position": place(b, a)[0], "of": len(day.candidates[b])},
    ]
    assert body["tags"] == [
        {"name": "Longing", "kind": "urn:tag:theme:qloo", "score": 0.7},
        {"name": "Hearth Folk", "kind": "urn:tag:genre:music", "score": 0.61},
    ]
    text = response.text
    assert "affinity" not in text and "matrix" not in text and "test-key" not in text


def test_the_live_request_is_the_saved_request_and_nothing_is_cached(tmp_path, day):
    fake = FakeQloo()
    serve(tmp_path, fake.client())
    a, b = day.pair()
    with TestClient(app) as client:
        first, second = check(client, a, b), check(client, a, b)
    assert first.status_code == second.status_code == 200
    assert len(fake.seen) == 6  # the second check asked Qloo again
    saved = {
        r["params"]["signal.interests.entities"]: r["params"]
        for r in day.preset["requests"]
        if r["path"] == "/v2/insights"
    }
    for request in fake.seen[:2]:
        sent = dict(request.url.params)
        assert sent == saved[sent["signal.interests.entities"]]
        assert "x-api-key" in request.headers
    assert second.json()["requests"][0]["request_id"] not in {
        r["request_id"] for r in first.json()["requests"]
    }


def test_a_different_answer_gives_a_different_live_value_and_keeps_the_saved_one(tmp_path, day):
    fake = FakeQloo(lambda signal, candidate: -affinity(signal, candidate))  # every ranking reversed
    serve(tmp_path, fake.client())
    a, b = day.pair()
    preset_file = (tmp_path / "day.json").read_text(encoding="utf-8")
    with TestClient(app) as client:
        body = check(client, a, b).json()
        preset = client.get("/api/presets/day").json()
    saved = OverlapMatrix.model_validate(day.preset["matrix"]).value(a, b)
    assert body["taste_overlap"]["saved"] == saved != 0.5
    assert body["taste_overlap"]["live"] != saved
    assert body["taste_overlap"]["live"] == round(1 - saved, 4)
    assert (tmp_path / "day.json").read_text(encoding="utf-8") == preset_file
    assert preset["report"] == day.preset["report"]


# -------------------------------------------------------------------------------- refused requests


def test_unknown_presets_and_sets_are_404_and_echo_no_set(tmp_path, day):
    fake = FakeQloo()
    serve(tmp_path, fake.client())
    a, _ = day.pair()
    with TestClient(app) as client:
        preset = check(client, a, day.ids[1], preset="nope")
        act = check(client, a, "someone-else")
        hostile = check(client, "<script>Ünïcødé", a)
    assert preset.status_code == 404 and preset.json() == {"detail": "No preset 'nope'."}
    for response in (act, hostile):
        assert response.status_code == 404
        assert response.json() == {"detail": "That set is not on this festival day."}
    assert "someone-else" not in act.text and "script" not in hostile.text
    assert all(no_store(r) for r in (preset, act, hostile))
    assert fake.seen == []


def test_the_same_set_twice_is_422(tmp_path, day):
    serve(tmp_path, FakeQloo().client())
    with TestClient(app) as client:
        response = check(client, day.ids[0], day.ids[0])
    assert response.status_code == 422 and no_store(response)
    assert response.json() == {"detail": "Pick two different sets."}


@pytest.mark.parametrize("which", ["no_qloo_id", "no_signal"])
def test_a_pair_that_is_not_priced_is_422(tmp_path, day, which):
    fake = FakeQloo()
    serve(tmp_path, fake.client())
    with TestClient(app) as client:
        forward = check(client, getattr(day, which), day.ids[0])
        backward = check(client, day.ids[0], getattr(day, which))
    expected = (
        "Qloo has no usable signal for one of these acts, so this pair is not priced "
        "and cannot be re-checked."
    )
    for response in (forward, backward):
        assert response.status_code == 422 and no_store(response)
        assert response.json() == {"detail": expected}
    assert fake.seen == []


def test_a_pair_without_its_saved_rankings_is_422(tmp_path, day):
    fake = FakeQloo()
    serve(tmp_path, fake.client())
    expected = {
        "detail": "This pair's saved audience rankings are not available, so it cannot be re-checked."
    }
    with TestClient(app) as client:
        missing = check(client, day.no_row, day.ids[0])
        two = check(client, day.ids[0], day.two_rows)
    assert missing.status_code == two.status_code == 422
    assert missing.json() == two.json() == expected
    assert fake.seen == []


def test_a_partner_outside_the_saved_candidates_is_422(tmp_path, day):
    a, b = day.pair()
    for request in day.preset["requests"]:
        if request["params"].get("signal.interests.entities") == day.qloo_ids[a]:
            kept = [
                c for c in request["params"]["filter.results.entities"].split(",") if c != day.qloo_ids[b]
            ]
            request["params"]["filter.results.entities"] = ",".join(kept)
    (tmp_path / "day.json").write_text(json.dumps(day.preset), encoding="utf-8")
    serve(tmp_path, FakeQloo().client())
    with TestClient(app) as client:
        response = check(client, a, b)
    assert response.status_code == 422
    assert "saved audience rankings are not available" in response.json()["detail"]


def test_off_by_default_and_health_says_so(tmp_path, day, monkeypatch):
    for name in ("PAIR_CHECK_ENABLED", "QLOO_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    fake = FakeQloo()
    serve(tmp_path, fake.client())
    off = Settings(_env_file=None, presets_dir=tmp_path)
    keyless = Settings(_env_file=None, presets_dir=tmp_path, pair_check_enabled=True)
    on = Settings(_env_file=None, presets_dir=tmp_path, pair_check_enabled=True, qloo_api_key="test-key")
    a, b = day.pair()
    results = {}
    with TestClient(app) as client:
        for name, settings in (("off", off), ("keyless", keyless), ("on", on)):
            app.dependency_overrides[get_settings] = lambda settings=settings: settings
            results[name] = (check(client, a, b, preset="nope"), client.get("/api/health").json())
    assert off.pair_check_enabled is False
    for name in ("off", "keyless"):
        response, health = results[name]
        assert response.status_code == 503 and no_store(response)  # before even the preset is looked up
        assert response.json() == {"detail": "Live checks are switched off on this server."}
        assert health["pair_check"] is False
    assert results["on"][1]["pair_check"] is True and results["on"][0].status_code == 404
    assert fake.seen == []


def test_below_the_floor_no_request_leaves_and_no_slot_is_taken(tmp_path, day):
    fake = FakeQloo()
    qloo = fake.client()
    qloo.month_remaining = 1502  # 3 more would leave less than the floor of 1,500
    limiter = RunLimiter(1, 1, 1, messages=PAIR_MESSAGES)
    serve(tmp_path, qloo, limiter)
    a, b = day.pair()
    with TestClient(app) as client:
        paused = check(client, a, b)
        qloo.month_remaining = 1503
        allowed = check(client, a, b)
    assert paused.status_code == 503 and no_store(paused)
    assert paused.json() == {
        "detail": "Live checks are paused to protect this demo's monthly Qloo allowance. "
        "The saved result is unchanged."
    }
    assert allowed.status_code == 200  # the paused request took no limiter slot
    assert len(fake.seen) == 3


def test_the_floor_is_learned_from_qloos_answers(tmp_path, day):
    fake = FakeQloo(remaining="1503")
    qloo = fake.client()
    serve(tmp_path, qloo)
    a, b = day.pair()
    with TestClient(app) as client:
        assert qloo.month_remaining is None
        assert check(client, a, b).status_code == 200
        assert qloo.month_remaining == 1503
        fake.remaining = "1502"
        assert check(client, a, b).status_code == 200
        assert qloo.month_remaining == 1502
        assert check(client, a, b).status_code == 503
    assert len(fake.seen) == 6


def test_the_ninth_check_in_an_hour_is_refused_and_bad_requests_take_no_slot(tmp_path, day, monkeypatch):
    settings = Settings(
        _env_file=None, presets_dir=tmp_path, pair_check_enabled=True, qloo_api_key="test-key"
    )
    monkeypatch.setattr(deps, "get_settings", lambda: settings)
    monkeypatch.setattr(deps, "_pair_limiter", None)
    serve(tmp_path, FakeQloo().client())
    del app.dependency_overrides[get_pair_limiter]  # the limiter the settings build
    a, b = day.pair()
    with TestClient(app) as client:
        refused = [
            client.get("/api/pair", params={"preset": "day", "a": "x" * 81, "b": b}),
            client.get("/api/pair", params={"preset": "day", "a": a}),
            check(client, a, a),
            check(client, a, "nobody"),
            check(client, day.no_qloo_id, b),
        ]
        codes = [check(client, a, b).status_code for _ in range(9)]
        other = check(client, a, b, **{"x-forwarded-for": "203.0.113.9"})
    assert [r.status_code for r in refused] == [422, 422, 422, 404, 422]
    assert all(no_store(r) for r in refused)
    assert codes == [200] * 8 + [429]
    assert other.status_code == 200
    with TestClient(app) as client:
        last = check(client, a, b)
    assert last.json() == {"detail": "Too many live checks this hour. Please try again later."}
    assert no_store(last)
    limiter = deps.get_pair_limiter()
    assert (limiter.per_hour, limiter.per_day, limiter.global_per_day) == (8, 20, 100)


def test_the_day_caps_have_their_own_words():
    now = [0.0]
    limiter = RunLimiter(
        per_hour=5, per_day=2, global_per_day=3, clock=lambda: now[0], messages=PAIR_MESSAGES
    )
    assert limiter.try_acquire("a") is None and limiter.try_acquire("a") is None
    assert (
        limiter.try_acquire("a")
        == "You have reached today's limit of live checks. Please try again tomorrow."
    )
    assert limiter.try_acquire("b") is None
    assert limiter.try_acquire("c") == "Live checks have reached today's limit. Please try again tomorrow."
    assert "c" not in limiter._visitors  # a refusal stores nothing for that visitor


def test_cap_defaults(monkeypatch):
    for name in (
        "PAIR_CHECK_ENABLED",
        "PAIR_CHECKS_PER_VISITOR_HOUR",
        "PAIR_CHECKS_PER_VISITOR_DAY",
        "PAIR_CHECKS_PER_DAY",
        "QLOO_QUOTA_FLOOR",
    ):
        monkeypatch.delenv(name, raising=False)
    settings = Settings(_env_file=None)
    assert settings.pair_check_enabled is False
    assert (
        settings.pair_checks_per_visitor_hour,
        settings.pair_checks_per_visitor_day,
        settings.pair_checks_per_day,
        settings.qloo_quota_floor,
    ) == (8, 20, 100, 1500)


# ------------------------------------------------------------------------------ Qloo did not answer

NO_ANSWER = {
    "detail": "Qloo did not answer in time, so nothing was re-checked. The saved result is unchanged."
}


@pytest.mark.parametrize("path", ["/v2/insights", "/v2/analysis/compare"])
def test_a_qloo_error_is_503_and_takes_a_slot(tmp_path, day, path):
    fake = FakeQloo(fail=path)
    serve(tmp_path, fake.client(max_retries=0), RunLimiter(1, 5, 5, messages=PAIR_MESSAGES))
    a, b = day.pair()
    with TestClient(app) as client:
        failed = check(client, a, b)
        again = check(client, a, b)
    assert failed.status_code == 503 and failed.json() == NO_ANSWER and no_store(failed)
    assert again.status_code == 429  # the failed check reached Qloo, so it counted
    assert len(fake.seen) == 3


def test_a_saved_fixture_is_never_served_as_live(tmp_path, day):
    a, b = day.pair()
    compare = normalize_params(
        {
            "a.signal.interests.entities": [day.qloo_ids[a]],
            "b.signal.interests.entities": [day.qloo_ids[b]],
            "take": 50,
        }
    )
    fixtures = tmp_path / "fixtures"
    fixtures.mkdir()
    key = request_key("/v2/analysis/compare", compare)
    fixture = {"request": {}, "response": {"results": {"tags": TAGS}}}
    (fixtures / f"{key}.json").write_text(json.dumps(fixture), encoding="utf-8")

    failing = FakeQloo(fail="/v2/analysis/compare")  # the client falls back to the saved answer
    serve(tmp_path, failing.client(max_retries=0, fixtures_dir=fixtures))
    with TestClient(app) as client:
        recorded = check(client, a, b)
    serve(tmp_path, FakeQloo().client(fixtures_dir=fixtures, fixtures_first=True))  # served as cached
    with TestClient(app) as client:
        cached = check(client, a, b)
    assert recorded.status_code == cached.status_code == 503
    assert recorded.json() == cached.json() == NO_ANSWER


def test_a_slow_qloo_is_503(tmp_path, day, monkeypatch):
    monkeypatch.setattr(pair, "QLOO_TIMEOUT_SECONDS", 0.05)
    fake = FakeQloo()
    fake.delay = 1.0
    serve(tmp_path, fake.client())
    with TestClient(app) as client:
        response = check(client, *day.pair())
    assert response.status_code == 503 and response.json() == NO_ANSWER


def test_an_answer_without_the_partner_or_in_another_shape_is_503(tmp_path, day):
    a, b = day.pair()
    serve(tmp_path, FakeQloo(drop=day.qloo_ids[b]).client())
    with TestClient(app) as client:
        missing = check(client, a, b)

    def odd(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": ["not", "a", "ranking"]})

    serve(tmp_path, QlooClient("test-key", max_rps=None, transport=httpx.MockTransport(odd)))
    with TestClient(app) as client:
        shaped = check(client, a, b)

    serve(
        tmp_path,
        QlooClient(
            "test-key",
            max_rps=None,
            transport=httpx.MockTransport(lambda request: httpx.Response(200, text="not json")),
        ),
    )
    with TestClient(app) as client:
        text = check(client, a, b)
    assert [r.status_code for r in (missing, shaped, text)] == [503, 503, 503]
    assert all(r.json() == NO_ANSWER for r in (missing, shaped, text))


# --------------------------------------------------------------------------------------- the surface


def test_the_log_line_names_the_check_and_the_allowance_but_no_qloo_detail(tmp_path, day, caplog):
    serve(tmp_path, FakeQloo(remaining="8123").client())
    a, b = day.pair()
    with caplog.at_level(logging.INFO, logger="app.pair"), TestClient(app) as client:
        assert check(client, a, b).status_code == 200
    lines = [r.getMessage() for r in caplog.records if r.name == "app.pair"]
    assert len(lines) == 1
    assert "day" in lines[0] and a in lines[0] and b in lines[0] and "8123" in lines[0]
    assert not any(secret in lines[0] for secret in ("q:", "req-", "test-key", "filter."))


def test_extra_and_repeated_params_change_nothing_and_the_docs_stay_off(tmp_path, day):
    fake = FakeQloo()
    serve(tmp_path, fake.client())
    a, b = day.pair()
    with TestClient(app) as client:
        extra = client.get(
            "/api/pair", params={"preset": "day", "a": a, "b": b, "take": "999", "signal.location.query": "x"}
        )
        repeated = client.get(f"/api/pair?preset=nope&preset=day&a={a}&b={b}")
        docs = client.get("/openapi.json")
    assert extra.status_code == 200
    assert all("signal.location.query" not in r.url.params for r in fake.seen)
    assert repeated.status_code in (200, 404)
    assert docs.status_code == 404
