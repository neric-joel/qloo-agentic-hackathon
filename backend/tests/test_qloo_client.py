import asyncio
import json

import httpx
import pytest

from app.qloo.client import (
    QlooClient,
    QlooError,
    TTLCache,
    normalize_params,
    record_requests,
    request_key,
)


def make_client(handler, **kwargs) -> QlooClient:
    kwargs.setdefault("backoff", 0)
    return QlooClient("test-key", transport=httpx.MockTransport(handler), **kwargs)


def test_normalize_params_drops_empty_and_joins_lists():
    params = {
        "filter.type": "urn:entity:movie",
        "signal.interests.entities": ["a", "b"],
        "feature.explainability": True,
        "take": 5,
        "skip_none": None,
        "skip_empty": "",
        "skip_list": [],
    }
    assert normalize_params(params) == {
        "filter.type": "urn:entity:movie",
        "signal.interests.entities": "a,b",
        "feature.explainability": "true",
        "take": "5",
    }


async def test_get_sends_key_and_caches():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={"results": {"entities": []}})

    client = make_client(handler)
    first = await client.get("/v2/insights", {"filter.type": "urn:entity:artist"})
    second = await client.get("/v2/insights", {"filter.type": "urn:entity:artist"})

    assert first == second == {"results": {"entities": []}}
    assert len(calls) == 1
    assert calls[0].headers["X-Api-Key"] == "test-key"
    assert calls[0].url.params["filter.type"] == "urn:entity:artist"
    await client.aclose()


async def test_retries_on_429_then_succeeds():
    statuses = iter([429, 200])

    def handler(request: httpx.Request) -> httpx.Response:
        status = next(statuses)
        return httpx.Response(status, json={"ok": status == 200})

    client = make_client(handler)
    assert await client.get("/search", {"query": "x"}) == {"ok": True}
    await client.aclose()


async def test_gives_up_after_max_retries():
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(503, json={"error": "down"})

    client = make_client(handler, max_retries=2)
    with pytest.raises(QlooError) as info:
        await client.get("/search", {"query": "x"})
    assert info.value.status == 503
    assert calls == 3
    await client.aclose()


async def test_does_not_retry_client_errors():
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(400, json={"error": "bad param"})

    client = make_client(handler)
    with pytest.raises(QlooError) as info:
        await client.get("/v2/insights", {"filter.type": "urn:entity:place"})
    assert info.value.status == 400
    assert info.value.payload == {"error": "bad param"}
    assert calls == 1
    await client.aclose()


async def test_records_fixture_and_replays_it_when_api_fails(tmp_path):
    def ok(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": ["recorded"]})

    recorder = make_client(ok, fixtures_dir=tmp_path, record_fixtures=True)
    await recorder.get("/search", {"query": "radiohead"})
    await recorder.aclose()

    saved = list(tmp_path.glob("*.json"))
    assert len(saved) == 1
    assert json.loads(saved[0].read_text())["request"]["params"] == {"query": "radiohead"}

    def down(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    replayer = make_client(down, fixtures_dir=tmp_path, max_retries=0, cache=TTLCache())
    assert await replayer.get("/search", {"query": "radiohead"}) == {"results": ["recorded"]}
    await replayer.aclose()


async def test_without_key_uses_fixtures_or_fails_clearly(tmp_path):
    key = request_key("/search", {"query": "x"})
    (tmp_path / f"{key}.json").write_text(json.dumps({"request": {}, "response": {"hit": True}}))

    client = QlooClient(None, fixtures_dir=tmp_path)
    assert await client.get("/search", {"query": "x"}) == {"hit": True}
    with pytest.raises(QlooError):
        await client.get("/search", {"query": "missing"})
    await client.aclose()


async def test_concurrent_identical_requests_share_one_call():
    calls = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return httpx.Response(200, json={"call": calls})

    client = make_client(handler)
    first, second = await asyncio.gather(
        client.get("/search", {"query": "x"}), client.get("/search", {"query": "x"})
    )
    assert first == second == {"call": 1}
    assert calls == 1
    await client.aclose()


async def test_concurrent_callers_all_see_the_failure():
    async def handler(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(0.01)
        return httpx.Response(400, json={"error": {"reason": "bad"}})

    client = make_client(handler)
    results = await asyncio.gather(
        client.get("/search", {"query": "x"}),
        client.get("/search", {"query": "x"}),
        return_exceptions=True,
    )
    assert all(isinstance(r, QlooError) for r in results)
    await client.aclose()


def test_error_reason_parses_nested_and_flat_shapes():
    nested = QlooError("x", payload={"error": {"reason": "No API key found in request", "code": 401}})
    flat = QlooError("x", payload={"code": 404, "reason": "No path matching request parameters"})
    assert nested.reason == "No API key found in request"
    assert flat.reason == "No path matching request parameters"
    assert QlooError("x", payload="plain text").reason is None


async def test_error_keeps_qloo_request_id():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403, json={"error": {"reason": "forbidden"}}, headers={"x-qloo-request-id": "req-123"}
        )

    client = make_client(handler)
    with pytest.raises(QlooError) as info:
        await client.get("/v2/insights", {"filter.type": "urn:entity:locality"})
    assert info.value.request_id == "req-123"
    assert info.value.reason == "forbidden"
    await client.aclose()


async def test_records_every_request_made_in_context():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.params.get("query") == "missing":
            return httpx.Response(404, json={"reason": "nope"}, headers={"x-qloo-request-id": "r-404"})
        return httpx.Response(200, json={"ok": True}, headers={"x-qloo-request-id": "r-200"})

    client = make_client(handler)
    with record_requests() as records:
        await client.get("/search", {"query": "x"})
        await client.get("/search", {"query": "x"})  # cache hit
        with pytest.raises(QlooError):
            await client.get("/search", {"query": "missing"})

    assert [(r.status, r.cached, r.request_id) for r in records] == [
        (200, False, "r-200"),
        (200, True, None),
        (404, False, "r-404"),
    ]
    assert records[0].params == {"query": "x"}
    assert all(r.latency_ms >= 0 for r in records)

    await client.get("/search", {"query": "y"})  # outside the context: not recorded
    assert len(records) == 3
    await client.aclose()


async def test_insights_requires_filter_type():
    client = make_client(lambda request: httpx.Response(200, json={}))
    with pytest.raises(ValueError):
        await client.insights({"signal.interests.entities": "abc"})
    await client.aclose()
