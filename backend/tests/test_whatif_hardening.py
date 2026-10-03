"""Round-7 hardening of ``POST /whatif``: identical first requests are single-flight (one compute, one slot),
a plan written two ways is one cache entry, a request over 16 KB is a 413 before it is read, and the answer
still echoes the order the request used. Synthetic days only (the nine-set day of ``test_whatif_rule_steps``).
"""

import asyncio
import json
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app import whatif
from app.main import app
from tests import test_whatif_rule_steps as steps
from tests.test_whatif_rule_steps import NO_STORE, STEP_1, fixes_of, one, post, rule_step, step_of, visits

day = steps.day  # the fixture: the nine-set day with its rule

RACERS = 8
DELAY = 0.3


def slow_apply_plan(monkeypatch) -> list:
    """``apply_plan`` that counts its calls and takes long enough for every racer to arrive."""
    calls: list = []
    real = whatif.apply_plan

    def slow(*args, **kwargs):
        calls.append(args[3])
        time.sleep(DELAY)
        return real(*args, **kwargs)

    monkeypatch.setattr(whatif, "apply_plan", slow)
    return calls


def race(body: dict, n: int = RACERS) -> list:
    """``n`` identical POSTs released together; the responses in thread order."""
    client = TestClient(app)
    start = threading.Barrier(n)
    out: list = [None] * n

    def go(i: int) -> None:
        start.wait()
        out[i] = client.post("/api/presets/rules/whatif", json=body)

    threads = [threading.Thread(target=go, args=(i,)) for i in range(n)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    return out


# ------------------------------------------------------------------------------------ single-flight


def test_eight_racing_identical_plans_compute_once_take_one_slot_and_answer_alike(day, monkeypatch):
    festival, matrix, config, _ = day
    calls = slow_apply_plan(monkeypatch)
    body = {"moves": [step_of(fixes_of(festival, matrix, config, 2)[0])]}
    responses = race(body)
    assert [r.status_code for r in responses] == [200] * RACERS
    assert len({r.text for r in responses}) == 1
    assert len(calls) == 1
    assert sum(len(v) for v in whatif.get_whatif_limiter()._visitors.values()) == 1
    assert all(r.headers["cache-control"] == NO_STORE for r in responses)
    assert whatif._flights == {}  # no lock is kept once the requests are done


def test_eight_racing_identical_single_moves_compute_once_and_take_one_slot(day, monkeypatch):
    festival, matrix, config, _ = day
    calls = slow_apply_plan(monkeypatch)
    (m,) = fixes_of(festival, matrix, config, 1)[0]["moves"]
    responses = race({"moves": [one(m["act_id"], m["stage_id"], m["start"])]})
    assert [r.status_code for r in responses] == [200] * RACERS and len({r.text for r in responses}) == 1
    assert len(calls) == 1
    assert sum(len(v) for v in whatif.get_whatif_limiter()._visitors.values()) == 1


def test_eight_racing_identical_illegal_plans_compute_once_and_take_one_slot(day, monkeypatch):
    calls = slow_apply_plan(monkeypatch)
    responses = race({"moves": [rule_step([one("a", "nowhere", "11:00")])]})
    assert [r.status_code for r in responses] == [422] * RACERS
    assert all(r.json() == STEP_1 and r.headers["cache-control"] == NO_STORE for r in responses)
    assert len(calls) == 1
    assert sum(len(v) for v in whatif.get_whatif_limiter()._visitors.values()) == 1
    assert whatif._flights == {}


def test_different_plans_do_not_wait_for_each_other(day, monkeypatch):
    festival, matrix, config, _ = day
    calls = slow_apply_plan(monkeypatch)
    fixes = fixes_of(festival, matrix, config)[:2]
    client = TestClient(app)
    out: list = [None, None]
    start = threading.Barrier(2)

    def go(i: int) -> None:
        start.wait()
        out[i] = client.post("/api/presets/rules/whatif", json={"moves": [step_of(fixes[i])]})

    began = time.monotonic()
    threads = [threading.Thread(target=go, args=(i,)) for i in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert [r.status_code for r in out] == [200, 200] and len(calls) == 2
    assert time.monotonic() - began < 2 * DELAY + 0.25  # in parallel, not one after the other


def test_a_refused_first_request_leaves_the_plan_to_the_next_one(day, monkeypatch):
    festival, matrix, config, _ = day
    calls = slow_apply_plan(monkeypatch)
    body = {"moves": [step_of(fixes_of(festival, matrix, config)[0])]}
    app.dependency_overrides[whatif.get_whatif_limiter] = lambda: whatif.RunLimiter(
        0, 10, 10, messages=whatif.WHATIF_MESSAGES
    )
    with TestClient(app) as client:
        refused = client.post("/api/presets/rules/whatif", json=body)
    app.dependency_overrides.pop(whatif.get_whatif_limiter)
    assert refused.status_code == 429 and calls == [] and whatif._flights == {}
    with TestClient(app) as client:
        assert client.post("/api/presets/rules/whatif", json=body).status_code == 200
    assert len(calls) == 1


# --------------------------------------------------------------------------------- the canonical key


def reversed_step(step: dict) -> dict:
    """The same rule step written the other way round: the pair label and the two moves swapped."""
    return rule_step(list(reversed(step["moves"])), step["rule"]["b"], step["rule"]["a"])


def test_the_same_plan_written_two_ways_is_one_cache_entry_and_one_slot(day, monkeypatch):
    festival, matrix, config, _ = day
    swap = step_of(fixes_of(festival, matrix, config, 2)[0])
    other = reversed_step(swap)
    assert other["moves"] != swap["moves"] and other["rule"] == {"a": "b", "b": "a"}
    calls = slow_apply_plan(monkeypatch)
    with TestClient(app) as client:
        first = post(client, [swap])
        second = post(client, [other])
        assert visits(client) == 1
    assert len(calls) == 1 and len(whatif._plans) == 1
    assert first.status_code == second.status_code == 200
    a, b = first.json(), second.json()
    # Each answer echoes the order its own request used; nothing else differs
    assert a["plan"]["steps"][0]["rule"] == {
        k: b["plan"]["steps"][0]["rule"][o] for k, o in (("a", "b"), ("b", "a"))
    }
    assert a["plan"]["steps"][0]["moves"] == list(reversed(b["plan"]["steps"][0]["moves"]))
    assert [m["act_id"] for m in b["plan"]["steps"][0]["moves"]] == [m["act"] for m in other["moves"]]
    assert b["plan"]["steps"][0]["rule"]["a"]["act_id"] == "b"
    a["plan"]["steps"][0]["rule"], b["plan"]["steps"][0]["rule"] = None, None
    a["plan"]["steps"][0]["moves"], b["plan"]["steps"][0]["moves"] = None, None
    assert a == b


def test_an_answer_does_not_depend_on_which_spelling_computed_it(day):
    festival, matrix, config, _ = day
    swaps = fixes_of(festival, matrix, config, 2)[:3]
    assert swaps
    for fix in swaps:
        forward = step_of(fix)
        backward = reversed_step(forward)
        texts = []
        for order in ((forward, backward), (backward, forward)):
            with whatif._cache_lock:
                whatif._plans.clear()
            with TestClient(app) as client:
                texts.append([post(client, [s]).text for s in order])
        # forward asked first or second, the bytes of each spelling are the same
        assert texts[0][0] == texts[1][1] and texts[0][1] == texts[1][0]


def test_a_rule_step_in_a_longer_plan_is_echoed_in_the_requests_order(day):
    festival, matrix, config, _ = day
    swap = step_of(fixes_of(festival, matrix, config, 2)[0])
    with TestClient(app) as client:
        straight = post(client, [swap], act="g", limit=3).json()
        flipped = post(client, [reversed_step(swap)], act="g", limit=3).json()
    assert straight["options"] == flipped["options"]
    assert straight["published_budget"] == flipped["published_budget"]
    assert straight["plan"]["budget"] == flipped["plan"]["budget"]
    assert straight["plan"]["clashes"] == flipped["plan"]["clashes"]


def test_the_order_of_steps_still_matters(day):
    festival, matrix, config, _ = day
    fixes = fixes_of(festival, matrix, config, 1)
    first, second = step_of(fixes[0]), None
    for fix in fixes[1:]:
        if fix["moves"][0]["act_id"] != fixes[0]["moves"][0]["act_id"]:
            second = step_of(fix)
            break
    assert second is not None
    with TestClient(app) as client:
        post(client, [first, second])
        post(client, [second, first])
    assert len(whatif._plans) + len(whatif._illegal) == 2


def test_a_key_is_the_same_for_both_spellings_and_a_different_plan_is_not(day):
    festival, matrix, config, _ = day
    fix = fixes_of(festival, matrix, config, 2)[0]
    step = step_of(fix)
    plan = [
        whatif._canonical(whatif._plan_step(whatif.RuleStep.model_validate(s)))
        for s in (step, reversed_step(step))
    ]
    assert plan[0] == plan[1] and hash(plan[0]) == hash(plan[1])
    moved = whatif.RuleStep.model_validate(rule_step(step["moves"][:1], step["rule"]["a"], step["rule"]["b"]))
    assert whatif._canonical(whatif._plan_step(moved)) != plan[0]


# ------------------------------------------------------------------------------------- the size cap

PADDING = " " * 20 * 1024


def counted(client) -> int:
    return visits(client)


def test_a_20_kb_body_is_a_413_before_it_is_read_and_takes_no_slot(day, monkeypatch):
    calls = slow_apply_plan(monkeypatch)
    valid = json.dumps({"moves": []})
    with TestClient(app) as client:
        for body in (valid + PADDING, "x" * 20 * 1024, '{"moves": "' + "x" * 20 * 1024 + '"}'):
            refused = client.post(
                "/api/presets/rules/whatif", content=body, headers={"content-type": "application/json"}
            )
            assert refused.status_code == 413 and refused.json() == {"detail": "Request too large."}
            assert refused.headers["cache-control"] == NO_STORE
            assert body[:30] not in refused.text
        assert counted(client) == 0
    assert calls == []


def test_the_cap_is_16_kb_to_the_byte(day):
    head = '{"moves": []}'
    at = head + " " * (whatif.MAX_BODY_BYTES - len(head))
    over = at + " "
    assert len(at.encode()) == 16 * 1024 and len(over.encode()) == 16 * 1024 + 1
    with TestClient(app) as client:
        headers = {"content-type": "application/json"}
        ok = client.post("/api/presets/rules/whatif", content=at, headers=headers)
        refused = client.post("/api/presets/rules/whatif", content=over, headers=headers)
    assert ok.status_code == 200 and refused.status_code == 413


def test_a_chunked_body_over_the_cap_is_a_413_too(day):
    def chunks():
        for _ in range(40):
            yield b" " * 1024

    with TestClient(app) as client:
        refused = client.post(
            "/api/presets/rules/whatif", content=chunks(), headers={"content-type": "application/json"}
        )
        small = client.post(
            "/api/presets/rules/whatif",
            content=iter([b'{"moves"', b": []}"]),
            headers={"content-type": "application/json"},
        )
        assert counted(client) == 1  # the small plan's slot only
    assert refused.status_code == 413
    assert small.status_code == 200  # a small chunked body is replayed to the route unchanged


def test_a_huge_valid_body_padded_with_whitespace_is_refused_not_priced(day):
    body = '{"moves": []' + " " * 3_000_000 + "}"
    with TestClient(app) as client:
        refused = client.post(
            "/api/presets/rules/whatif", content=body, headers={"content-type": "application/json"}
        )
        assert counted(client) == 0
    assert refused.status_code == 413


def test_the_pair_check_and_only_the_two_routes_are_capped(day):
    big = json.dumps({"preset": "rules", "a": "a", "b": "b"}) + PADDING
    headers = {"content-type": "application/json"}
    with TestClient(app) as client:
        pair = client.post("/api/pair", content=big, headers=headers)
        pair_slash = client.post("/api/pair/", content=big, headers=headers, follow_redirects=False)
        other_preset = client.post("/api/presets/nope/whatif", content=big, headers=headers)
        # Not capped: a GET, and a POST to any other path (it falls through to the app's own answer)
        get = client.get("/api/presets/rules/moves?act=a")
        elsewhere = client.post("/api/runs", content=big, headers=headers)
    assert pair.status_code == pair_slash.status_code == other_preset.status_code == 413
    assert pair.json() == {"detail": "Request too large."} and pair.headers["cache-control"] == NO_STORE
    assert get.status_code == 200
    assert elsewhere.status_code != 413


def test_a_normal_plan_is_far_below_the_cap(day):
    """The largest legal plan: eight moves with the longest ids the route takes, pretty-printed."""
    long_id = "x" * 80
    move = {"act": long_id, "stage_id": long_id, "day": 13, "start": "23:59"}
    pair = {"a": long_id, "b": long_id[:-1] + "y"}
    singles = {"moves": [move] * 8, "act": long_id, "limit": 12}
    rules = {"moves": [{"rule": pair, "moves": [move, move]}] * 4, "act": long_id, "limit": 12}
    sizes = [len(json.dumps(b).encode()) for b in (singles, rules)]
    sizes += [len(json.dumps(b, indent=4).encode()) for b in (singles, rules)]
    assert max(sizes) < whatif.MAX_BODY_BYTES // 2
    assert max(len(json.dumps(b).encode()) for b in (singles, rules)) < 4_000


def test_the_body_limit_reads_a_body_once_and_replays_it_whole():
    """Straight ASGI: what the app receives is what arrived; an over-size body never reaches it."""
    seen: list[bytes] = []

    async def inner(scope, receive, send):
        body = b""
        while True:
            message = await receive()
            body += message.get("body", b"")
            if not message.get("more_body"):
                break
        seen.append(body)
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    async def run(parts: list[bytes], headers: list | None = None) -> list[dict]:
        queue = [
            {"type": "http.request", "body": part, "more_body": i < len(parts) - 1}
            for i, part in enumerate(parts)
        ]
        sent: list[dict] = []

        async def receive():
            return queue.pop(0) if queue else {"type": "http.disconnect"}

        async def send(message):
            sent.append(message)

        scope = {
            "type": "http",
            "method": "POST",
            "path": "/api/presets/day/whatif",
            "headers": headers or [],
        }
        await whatif.BodyLimit(inner, limit=10)(scope, receive, send)
        return sent

    small = asyncio.run(run([b"abc", b"def", b"gh"]))
    assert small[0]["status"] == 204 and seen == [b"abcdefgh"]
    big = asyncio.run(run([b"abcdef", b"ghijkl"]))
    assert big[0]["status"] == 413 and seen == [b"abcdefgh"]  # the app was not called again
    declared = asyncio.run(run([b"ab"], headers=[(b"content-length", b"11")]))
    assert declared[0]["status"] == 413 and len(seen) == 1
    lying = asyncio.run(run([b"abcdefghijkl"], headers=[(b"content-length", b"3")]))
    assert lying[0]["status"] == 413 and len(seen) == 1  # the count of what arrives decides


@pytest.mark.parametrize("path", ["/api/health", "/api/presets"])
def test_other_routes_are_not_touched_by_the_limit(day, path):
    with TestClient(app) as client:
        assert client.get(path).status_code == 200
