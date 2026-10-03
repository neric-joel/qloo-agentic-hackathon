"""The live pair check: three live Qloo requests, recomputed beside the saved value, never a cached or saved
answer served as live, refused before any request when it is off, the pair cannot be priced, the page does not
show it or the month is below the floor (or unknown for too long), and capped per visitor and per day. It is a
JSON POST only, never retried, and checks running at once never fail each other. Every preset, row and answer
here is synthetic."""

import asyncio
import itertools
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
from app.presets import Preset
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
    ranked: tuple[str, str]  # one of the day's ranked clashes, between two acts that can be checked
    partner: str  # a third act: (ranked[0], partner) is on the page as a clash receipt
    receipt_only: tuple[str, str]  # on the page only as a clash receipt
    off_page: tuple[str, str]  # two acts that can be checked, as a pair the page does not show

    def pair(self) -> tuple[str, str]:
        return self.ranked


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
    report = score_festival(festival, matrix).model_dump(mode="json")

    # The pairs the page shows: the ranked clashes, plus clash receipts for a few more
    ranked = [(c["a"]["act_id"], c["b"]["act_id"]) for c in report["clashes"]]
    checkable = [x for x in usable if x not in (no_row, two_rows)]
    first = next(p for p in ranked if set(p) <= set(checkable))
    partner = next(x for x in checkable if x not in first)
    shown = {frozenset(p) for p in ranked} | {frozenset((first[0], partner))}
    unshown = [p for p in itertools.combinations(checkable, 2) if frozenset(p) not in shown]
    receipt_only, off_page = unshown[0], unshown[1]
    receipts = {
        "|".join(p): {"shared_tags": [], "press": None}
        for p in ((first[0], partner), receipt_only, (no_row, first[0]), (first[0], two_rows))
    }
    preset = {
        "id": "day",
        "title": "Day",
        "festival": festival.model_dump(mode="json"),
        "matrix": matrix.model_dump(mode="json"),
        "report": report,
        "requests": requests,
        "evidence": {"receipts": receipts},
    }
    (directory / "day.json").write_text(json.dumps(preset), encoding="utf-8")
    return Day(
        preset,
        ids,
        qloo_ids,
        candidates,
        no_qloo_id,
        no_signal,
        no_row,
        two_rows,
        ranked=first,
        partner=partner,
        receipt_only=receipt_only,
        off_page=off_page,
    )


class FakeQloo:
    """A Qloo stand-in: answers rankings from an affinity function and comparisons with ``TAGS``."""

    def __init__(
        self,
        score=affinity,
        *,
        remaining: str | None = "9000",
        fail: str | None = None,
        drop=None,
        status: int | None = None,
        broken: bool = False,
    ):
        self.score = score
        self.remaining = remaining  # the allowance header, or None for answers without it
        self.fail = fail  # a path that answers 500
        self.drop = drop  # a Qloo id left out of every ranking
        self.status = status  # every request answers with this error status
        self.broken = broken  # every request fails before an answer (a transport error)
        self.seen: list[httpx.Request] = []
        self.delay = 0.0

    async def handler(self, request: httpx.Request) -> httpx.Response:
        self.seen.append(request)
        number = len(self.seen)  # before any delay, so requests out at the same time get their own ids
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.broken:
            raise httpx.ConnectError("unreachable", request=request)
        headers = {"x-qloo-request-id": f"req-{number}"}
        if self.remaining is not None:
            headers["x-month-ratelimit-remaining"] = self.remaining
        if self.status is not None or request.url.path == self.fail:
            return httpx.Response(self.status or 500, json={"error": {"reason": "down"}}, headers=headers)
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
    return client.post("/api/pair", json={"preset": preset, "a": a, "b": b}, headers=headers)


def no_store(response) -> bool:
    return response.headers.get("cache-control") == "no-store"


def counting_limiter() -> RunLimiter:
    return RunLimiter(100, 100, 100, messages=PAIR_MESSAGES)


def slots(limiter: RunLimiter) -> int:
    """How many checks the limiter has let through."""
    return len(limiter._all)


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
    first = day.pair()[0]  # each pair is on the page as a clash receipt
    with TestClient(app) as client:
        missing = check(client, day.no_row, first)
        two = check(client, first, day.two_rows)
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
            client.post("/api/pair", json={"preset": "day", "a": "x" * 81, "b": b}),
            client.post("/api/pair", json={"preset": "day", "a": a}),
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
    assert (limiter.per_hour, limiter.per_day, limiter.global_per_day) == (8, 20, 60)


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
    ) == (8, 20, 60, 1500)


# ------------------------------------------------------------------------------ Qloo did not answer

NO_ANSWER = {
    "detail": "Qloo did not answer in time, so nothing was re-checked. The saved result is unchanged."
}


@pytest.mark.parametrize("path", ["/v2/insights", "/v2/analysis/compare"])
def test_a_qloo_error_is_503_and_takes_a_slot(tmp_path, day, path):
    fake = FakeQloo(fail=path)
    serve(tmp_path, fake.client(), RunLimiter(1, 5, 5, messages=PAIR_MESSAGES))  # the client would retry
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
    qloo = fake.client()
    serve(tmp_path, qloo)
    with TestClient(app) as client:
        response = check(client, *day.pair())
    assert response.status_code == 503 and response.json() == NO_ANSWER
    assert len(fake.seen) == 3 and qloo.blind_requests == 3  # sent, never answered: counted as blind


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


def test_extra_fields_are_refused_query_params_change_nothing_and_the_docs_stay_off(tmp_path, day):
    fake = FakeQloo()
    serve(tmp_path, fake.client())
    a, b = day.pair()
    with TestClient(app) as client:
        extra = client.post(
            "/api/pair", json={"preset": "day", "a": a, "b": b, "take": "999", "signal.location.query": "x"}
        )
        queried = client.post(
            "/api/pair?take=999&signal.location.query=x", json={"preset": "day", "a": a, "b": b}
        )
        docs = client.get("/openapi.json")
    assert extra.status_code == 422 and no_store(extra)
    assert queried.status_code == 200
    assert len(fake.seen) == 3  # only the check with a clean body reached Qloo
    assert all("signal.location.query" not in r.url.params for r in fake.seen)
    assert all(r.url.params.get("take") != "999" for r in fake.seen)
    assert docs.status_code == 404


# ------------------------------------------------------- safe to switch on: the five round-3 findings

PAUSED = {
    "detail": "Live checks are paused to protect this demo's monthly Qloo allowance. "
    "The saved result is unchanged."
}
NOT_ON_THE_PAGE = {"detail": "That pair is not one of this day's ranked clashes, so it cannot be re-checked."}


def asgi_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


@pytest.mark.parametrize("failure", ["500", "429", "transport"])
def test_a_failed_check_sends_three_requests_not_nine_and_takes_one_slot(tmp_path, day, failure):
    broken = failure == "transport"
    fake = FakeQloo(status=None if broken else int(failure), broken=broken)
    limiter = counting_limiter()
    serve(tmp_path, fake.client(), limiter)  # the client's own default retries each request twice
    with TestClient(app) as client:
        response = check(client, *day.pair())
    assert response.status_code == 503 and response.json() == NO_ANSWER and no_store(response)
    assert len(fake.seen) == 3 and slots(limiter) == 1


def test_without_the_allowance_header_checks_pause_after_six_blind_requests(tmp_path, day):
    fake = FakeQloo(remaining=None)
    qloo = fake.client()
    limiter = counting_limiter()
    serve(tmp_path, qloo, limiter)
    with TestClient(app) as client:
        responses = [check(client, *day.pair()) for _ in range(3)]
    assert [r.status_code for r in responses] == [200, 200, 503]
    assert responses[2].json() == PAUSED and no_store(responses[2])
    assert len(fake.seen) == 6  # the third check would have been the 7th blind request: it never left
    assert slots(limiter) == 2 and qloo.month_remaining is None


def test_blind_requests_pause_even_after_a_known_allowance(tmp_path, day):
    fake = FakeQloo(remaining="9000")
    qloo = fake.client()
    serve(tmp_path, qloo, counting_limiter())
    a, b = day.pair()
    with TestClient(app) as client:
        known = check(client, a, b)
        fake.remaining = None  # the host stops sending the header
        blind = [check(client, a, b), check(client, a, b)]
        paused = check(client, a, b)
    assert [r.status_code for r in (known, *blind)] == [200, 200, 200]
    assert paused.status_code == 503 and paused.json() == PAUSED
    assert len(fake.seen) == 9 and qloo.month_remaining == 9000


def test_with_the_allowance_header_checks_go_on_and_an_answer_with_it_resets_the_blind_count(tmp_path, day):
    fake = FakeQloo()
    qloo = fake.client()
    serve(tmp_path, qloo, counting_limiter())
    a, b = day.pair()
    with TestClient(app) as client:
        codes = [check(client, a, b).status_code for _ in range(4)]
        assert qloo.blind_requests == 0
        fake.remaining = None
        codes.append(check(client, a, b).status_code)  # 3 blind
        fake.remaining = "8999"
        codes.append(check(client, a, b).status_code)  # back to 0
        fake.remaining = None
        codes += [check(client, a, b).status_code for _ in range(2)]  # 6 blind
        codes.append(check(client, a, b).status_code)
    assert codes == [200] * 8 + [503]
    assert len(fake.seen) == 24


@pytest.mark.parametrize("method", ["GET", "HEAD", "PUT", "DELETE"])
def test_only_post_is_answered_and_any_other_method_costs_nothing(tmp_path, day, method):
    fake = FakeQloo()
    limiter = counting_limiter()
    serve(tmp_path, fake.client(), limiter)
    a, b = day.pair()
    with TestClient(app) as client:
        response = client.request(method, "/api/pair", params={"preset": "day", "a": a, "b": b})
    assert response.status_code == 405 and no_store(response)
    assert response.headers.get("allow") == "POST"
    assert fake.seen == [] and slots(limiter) == 0


@pytest.mark.parametrize(
    "content_type",
    ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", None],
)
def test_a_body_not_sent_as_json_is_422_and_costs_nothing(tmp_path, day, content_type):
    fake = FakeQloo()
    limiter = counting_limiter()
    serve(tmp_path, fake.client(), limiter)
    a, b = day.pair()
    headers = {} if content_type is None else {"content-type": content_type}
    raw = json.dumps({"preset": "day", "a": a, "b": b}).encode()
    with TestClient(app) as client:
        response = client.post("/api/pair", content=raw, headers=headers)
    assert response.status_code == 422 and no_store(response)
    assert a not in response.text
    assert fake.seen == [] and slots(limiter) == 0


def test_no_response_lets_another_site_read_it(tmp_path, day):
    serve(tmp_path, FakeQloo().client())
    elsewhere = {"origin": "https://elsewhere.example"}
    with TestClient(app) as client:
        preflight = client.options(
            "/api/pair",
            headers={
                **elsewhere,
                "access-control-request-method": "POST",
                "access-control-request-headers": "content-type",
            },
        )
        posted = check(client, *day.pair(), **elsewhere)
    assert preflight.status_code == 405 and no_store(preflight)
    assert posted.status_code == 200
    for response in (preflight, posted):
        assert not [name for name in response.headers if name.lower().startswith("access-control-")]


async def test_five_identical_checks_at_once_all_answer_live(tmp_path, day):
    fake = FakeQloo()
    fake.delay = 0.05  # every request is still out when the next check starts
    qloo = fake.client()
    limiter = counting_limiter()
    serve(tmp_path, qloo, limiter)
    a, b = day.pair()
    async with asgi_client() as client:
        responses = await asyncio.gather(
            *(client.post("/api/pair", json={"preset": "day", "a": a, "b": b}) for _ in range(5))
        )
    assert [r.status_code for r in responses] == [200] * 5
    assert len(fake.seen) == 15 and slots(limiter) == 5
    records = [record for response in responses for record in response.json()["requests"]]
    assert not any(record["cached"] or record["recorded"] for record in records)
    assert len({record["request_id"] for record in records}) == 15
    assert qloo._inflight == {} and len(qloo.cache) == 0  # nothing shared, nothing kept


async def test_checks_that_share_an_act_at_once_both_answer_live(tmp_path, day):
    fake = FakeQloo()
    fake.delay = 0.05
    limiter = counting_limiter()
    serve(tmp_path, fake.client(), limiter)
    a, b = day.pair()
    async with asgi_client() as client:
        first, second = await asyncio.gather(
            client.post("/api/pair", json={"preset": "day", "a": a, "b": b}),
            client.post("/api/pair", json={"preset": "day", "a": a, "b": day.partner}),
        )
    assert first.status_code == second.status_code == 200
    assert len(fake.seen) == 6 and slots(limiter) == 2
    assert not any(r["cached"] for response in (first, second) for r in response.json()["requests"])
    rows_for_a = [r for r in fake.seen if r.url.params.get("signal.interests.entities") == day.qloo_ids[a]]
    assert len(rows_for_a) == 2  # a's saved ranking went out once for each check


def test_a_pair_the_page_does_not_show_is_422_and_costs_nothing(tmp_path, day):
    fake = FakeQloo()
    serve(tmp_path, fake.client(), RunLimiter(1, 1, 1, messages=PAIR_MESSAGES))
    x, y = day.off_page
    with TestClient(app) as client:
        refused = [check(client, x, y), check(client, y, x)]
        allowed = check(client, *day.pair())  # the refusals took no slot
    for response in refused:
        assert response.status_code == 422 and no_store(response)
        assert response.json() == NOT_ON_THE_PAGE
    assert allowed.status_code == 200 and len(fake.seen) == 3


def test_a_pair_shown_only_as_a_clash_receipt_can_be_checked(tmp_path, day):
    serve(tmp_path, FakeQloo().client())
    x, y = day.receipt_only
    ranked = {frozenset((c["a"]["act_id"], c["b"]["act_id"])) for c in day.preset["report"]["clashes"]}
    assert frozenset((x, y)) not in ranked
    with TestClient(app) as client:
        forward, backward = check(client, x, y), check(client, y, x)
    assert forward.status_code == backward.status_code == 200
    saved = OverlapMatrix.model_validate(day.preset["matrix"]).value(x, y)
    assert forward.json()["taste_overlap"]["saved"] == backward.json()["taste_overlap"]["saved"] == saved


def test_saved_is_the_taste_overlap_the_page_prints_for_each_ranked_clash(tmp_path, day):
    serve(tmp_path, FakeQloo().client())
    unusable = {day.no_row, day.two_rows, day.no_qloo_id, day.no_signal}
    clashes = [
        c for c in day.preset["report"]["clashes"] if not {c["a"]["act_id"], c["b"]["act_id"]} & unusable
    ]
    assert len(clashes) >= 3
    with TestClient(app) as client:
        for clash in clashes:
            a, b = clash["a"]["act_id"], clash["b"]["act_id"]
            for x, y in ((a, b), (b, a)):
                response = check(client, x, y)
                assert response.status_code == 200
                assert response.json()["taste_overlap"]["saved"] == clash["audience_overlap"]


def test_page_pairs_reads_ranked_clashes_and_receipt_keys_and_skips_anything_else(day):
    preset = Preset.model_validate(
        {
            **day.preset,
            "report": {"clashes": [{"a": {"act_id": "p"}, "b": {"act_id": "q"}}, {"a": {}}, "junk", None]},
            "evidence": {"receipts": {"x|y": {}, "y|x": {}, "x": {}, "x|y|z": {}, "w|w": {}, "": {}}},
        }
    )
    assert pair.page_pairs(preset) == {frozenset(("p", "q")), frozenset(("x", "y"))}
    bare = preset.model_copy(update={"report": {"clashes": "none"}, "evidence": None})
    assert pair.page_pairs(bare) == set()


def test_hostile_bodies_are_refused_before_any_request_and_echo_nothing(tmp_path, day):
    fake = FakeQloo()
    limiter = counting_limiter()
    serve(tmp_path, fake.client(), limiter)
    a, b = day.pair()
    shapes = [
        {"preset": "day", "a": "x" * 100_000, "b": b},
        {"preset": "day", "a": a, "b": b, "extra": True},
        {"preset": "day", "a": 7, "b": b},
        {"preset": ["day", "other"], "a": a, "b": b},
        {"preset": None, "a": a, "b": b},
        [a, b],
        "day",
        {},
    ]
    two_presets = '{"preset": "day", "a": "' + a + '", "b": "' + b + '", "preset": "nope"}'
    with TestClient(app) as client:
        shaped = [client.post("/api/pair", json=body) for body in shapes]
        unknown = [
            check(client, "\x00", b),
            check(client, a, "‮Ünïcødé"),
            check(client, a, b, preset="../day"),
            client.post("/api/pair", content=two_presets, headers={"content-type": "application/json"}),
        ]
    assert [r.status_code for r in shaped] == [422] * len(shapes)
    assert [r.status_code for r in unknown] == [404] * 4
    assert unknown[3].json() == {"detail": "No preset 'nope'."}  # the last of a repeated key is the one read
    assert all(no_store(r) for r in shaped + unknown)
    assert all("xxxxxxxxxx" not in r.text and len(r.text) < 2000 for r in shaped)
    assert fake.seen == [] and slots(limiter) == 0
