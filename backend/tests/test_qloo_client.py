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
    kwargs.setdefault("max_rps", None)
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


async def test_fixtures_first_serves_saved_response_without_calling_the_api(tmp_path):
    key = request_key("/search", {"query": "x"})
    (tmp_path / f"{key}.json").write_text(json.dumps({"request": {}, "response": {"saved": True}}))
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={"saved": False})

    client = make_client(handler, fixtures_dir=tmp_path, fixtures_first=True, record_fixtures=True)
    with record_requests() as log:
        assert await client.get("/search", {"query": "x"}) == {"saved": True}
        assert await client.get("/search", {"query": "y"}) == {"saved": False}
    assert len(calls) == 1
    assert [r.cached for r in log] == [True, False]
    assert len(list(tmp_path.glob("*.json"))) == 2  # the miss was saved for next time
    await client.aclose()


async def test_rate_limit_spaces_request_starts():
    starts = []

    def handler(request: httpx.Request) -> httpx.Response:
        starts.append(asyncio.get_running_loop().time())
        return httpx.Response(200, json={})

    client = make_client(handler, max_rps=20)
    t0 = asyncio.get_running_loop().time()
    await asyncio.gather(*(client.get("/search", {"query": str(i)}) for i in range(5)))
    # The k-th request may not start before k intervals have passed (timer resolution slack allowed).
    assert len(starts) == 5
    for k, started in enumerate(sorted(starts)):
        assert started - t0 >= k * 0.05 - 0.02
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


async def test_reads_the_months_remaining_requests_on_success_and_on_error():
    remaining = iter(["4321", "4320"])

    def handler(request: httpx.Request) -> httpx.Response:
        status = 500 if request.url.params["query"] == "down" else 200
        return httpx.Response(status, json={}, headers={"X-Month-RateLimit-Remaining": next(remaining)})

    client = make_client(handler, max_retries=0)
    assert client.month_remaining is None  # nothing learned before the first response
    await client.get("/search", {"query": "x"})
    assert client.month_remaining == 4321
    with pytest.raises(QlooError):
        await client.get("/search", {"query": "down"})
    assert client.month_remaining == 4320
    assert make_client(handler).month_remaining is None  # each client learns its own
    await client.aclose()


@pytest.mark.parametrize("value", ["-1", "12.5", "1e3", "lots", "", " ", "１２".encode(), None])
async def test_a_malformed_remaining_header_is_ignored(value):
    sent = iter(["900", value])

    def handler(request: httpx.Request) -> httpx.Response:
        header = next(sent)
        headers = {} if header is None else {"x-month-ratelimit-remaining": header}
        return httpx.Response(200, json={}, headers=headers)

    client = make_client(handler)
    await client.get("/search", {"query": "first"})
    await client.get("/search", {"query": "second"})
    assert client.month_remaining == 900
    await client.aclose()


# ----------------------------------------------- per-request retries, private requests, the allowance guard


@pytest.mark.parametrize("status", [500, 429])
async def test_max_retries_zero_sends_one_request_and_the_default_still_retries_twice(status):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(status, json={})

    client = make_client(handler)
    with pytest.raises(QlooError):
        await client.get("/search", {"query": "once"}, max_retries=0)
    assert len(calls) == 1
    with pytest.raises(QlooError):
        await client.get("/search", {"query": "default"})
    assert len(calls) == 4  # the default sent the request and retried it twice
    assert client.blind_requests == 4  # none of the answers said how many requests are left
    await client.aclose()


async def test_max_retries_zero_sends_one_request_on_a_transport_error():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        raise httpx.ConnectError("unreachable", request=request)

    client = make_client(handler)
    with pytest.raises(QlooError):
        await client.get("/search", {"query": "x"}, use_cache=False, max_retries=0)
    assert len(calls) == 1 and client.blind_requests == 1
    await client.aclose()


async def test_private_requests_at_once_each_go_out_and_nothing_is_kept():
    calls = []

    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        await asyncio.sleep(0.02)
        return httpx.Response(200, json={"ok": True}, headers={"x-month-ratelimit-remaining": "900"})

    client = make_client(handler)
    with record_requests() as records:
        first, second = await asyncio.gather(
            client.get("/search", {"query": "x"}, use_cache=False),
            client.get("/search", {"query": "x"}, use_cache=False),
        )
    assert first == second == {"ok": True}
    assert len(calls) == 2
    assert [(r.status, r.cached, r.recorded) for r in records] == [(200, False, False)] * 2
    assert client._inflight == {} and len(client.cache) == 0
    await client.get("/search", {"query": "x"})  # a later shared call finds nothing cached
    assert len(calls) == 3
    await client.aclose()


async def test_a_private_request_beside_shared_ones_leaves_their_sharing_intact():
    calls = []

    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        await asyncio.sleep(0.02)
        return httpx.Response(200, json={"n": len(calls)})

    client = make_client(handler)
    with record_requests() as records:
        await asyncio.gather(
            client.get("/search", {"query": "x"}),
            client.get("/search", {"query": "x"}, use_cache=False),
            client.get("/search", {"query": "x"}),
        )
    assert len(calls) == 2  # one shared request, one private
    assert sorted(r.cached for r in records) == [False, False, True]
    assert client._inflight == {}
    await client.aclose()


async def test_blind_requests_count_answers_without_the_header_and_failures_and_reset_on_one_with_it():
    plan = iter(
        [
            ("ok", None),
            ("ok", ""),
            ("error", "4000"),  # an error answer that says counts like any answer that says
            ("ok", None),
            ("down", None),
            ("timeout", None),
            ("ok", "lots"),
            ("ok", "1500"),
            ("ok", None),
        ]
    )

    def handler(request: httpx.Request) -> httpx.Response:
        kind, remaining = next(plan)
        if kind == "down":
            raise httpx.ConnectError("unreachable", request=request)
        if kind == "timeout":
            raise httpx.ReadTimeout("slow", request=request)
        headers = {} if remaining is None else {"x-month-ratelimit-remaining": remaining}
        return httpx.Response(500 if kind == "error" else 200, json={}, headers=headers)

    client = make_client(handler, max_retries=0)
    counts = []
    for i in range(9):
        try:
            await client.get("/search", {"query": str(i)})
        except QlooError:
            pass
        counts.append(client.blind_requests)
    assert counts == [1, 2, 0, 1, 2, 3, 4, 0, 1]
    assert client.month_remaining == 1500
    await client.aclose()


async def test_a_request_given_up_on_counts_as_blind():
    async def handler(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(1)
        return httpx.Response(200, json={}, headers={"x-month-ratelimit-remaining": "900"})

    client = make_client(handler)
    with pytest.raises(TimeoutError):
        async with asyncio.timeout(0.02):
            await client.get("/search", {"query": "slow"}, use_cache=False)
    assert client.blind_requests == 1 and client._inflight == {}
    await client.aclose()


async def test_six_blind_requests_lower_the_allowance_even_after_a_known_value():
    headers = iter([{"x-month-ratelimit-remaining": "9000"}] + [{}] * 6)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={}, headers=next(headers))

    client = make_client(handler)
    await client.get("/search", {"query": "known"})
    assert client.allowance_low(1500) is False
    for i in range(5):
        await client.get("/search", {"query": f"blind {i}"})
    assert client.blind_requests == 5 and client.allowance_low(1500) is False
    await client.get("/search", {"query": "blind 5"})
    assert client.blind_requests == 6 and client.month_remaining == 9000
    assert client.allowance_low(1500) is True and client.allowance_low(1500, 3) is True
    assert client.allowance_low(None) is False  # no floor, no pause
    await client.aclose()


async def test_allowance_low_compares_the_requests_left_with_the_floor_plus_what_is_needed():
    client = make_client(lambda request: httpx.Response(200, json={}))
    assert client.allowance_low(1500) is False  # not known yet, and nothing sent blind
    client.month_remaining = 1502
    assert client.allowance_low(1500, 3) is True
    client.month_remaining = 1503
    assert client.allowance_low(1500, 3) is False
    assert client.allowance_low(1500) is False
    client.month_remaining = 1499
    assert client.allowance_low(1500) is True
    assert client.allowance_low(None) is False
    await client.aclose()


async def test_insights_requires_filter_type():
    client = make_client(lambda request: httpx.Response(200, json={}))
    with pytest.raises(ValueError):
        await client.insights({"signal.interests.entities": "abc"})
    await client.aclose()
