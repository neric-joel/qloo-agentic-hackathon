"""The request-body caps of ``BodyLimit``: ``POST /api/runs`` (256 KB) and ``POST /api/schedule/score``
(512 KB) next to the what-if route, the pair check and grid pricing (16 KB). A body over its route's cap is a
readable 413 before anything parses it or takes a slot, also when it is chunked or the client keeps sending; a
body within the cap reaches the route unchanged. Synthetic days only; no Qloo request is possible (the client
is overridden by one that fails on any use).

The real-socket tests need ``uvicorn``, which is not a project dependency: run them with
``uv run --with uvicorn pytest tests/test_body_cap.py`` (without it they are skipped)."""

import asyncio
import collections
import http
import json
import random
import socket
import threading
import time
import urllib.error
import urllib.request

import httpx
import pytest
from fastapi.testclient import TestClient

from app import whatif
from app.main import app, get_backend, get_qloo
from app.runs import RunRequest
from app.schedule.api import ScoreRequest
from app.schedule.models import ScoringConfig
from app.schedule.synthetic import synthetic_festival

NO_STORE = "no-store"
REFUSED = {"detail": "Request too large."}
JSON = {"content-type": "application/json"}
THREE_MB = 3 * 1024 * 1024


class NoQloo:
    def __getattr__(self, name):
        raise AssertionError("no route in this file calls Qloo")


@pytest.fixture
def client():
    reached: list[str] = []

    def backend_probe():
        reached.append("run")
        return None  # the route answers 503 (not configured) after this: no run starts

    app.dependency_overrides[get_qloo] = NoQloo
    app.dependency_overrides[get_backend] = backend_probe
    with TestClient(app) as test_client:
        test_client.reached = reached
        yield test_client
    app.dependency_overrides.clear()


def padded(body: dict, size: int) -> bytes:
    """The JSON of ``body`` followed by spaces, exactly ``size`` bytes long."""
    head = json.dumps(body, separators=(",", ":")).encode()
    assert len(head) <= size
    return head + b" " * (size - len(head))


RUN_BODY = {"scenario": "clash", "input": {"preset_id": "nope", "message": "hello"}}


def score_body() -> dict:
    festival, matrix = synthetic_festival(7)
    return {
        "festival": festival.model_dump(mode="json"),
        "matrix": matrix.model_dump(mode="json"),
        "config": ScoringConfig(baseline_samples=5).model_dump(mode="json", exclude={"baseline"}),
    }


# ---------------------------------------------------------------------------- what the caps must admit


def long_ids_session(sets: int = 80) -> list[dict]:
    """The largest session the page can send back: 80 sets with every optional field and 20 allowed stages."""
    stage_ids = [f"stage-{n:02d}-" + "s" * 8 for n in range(20)]
    return [
        {
            "act_id": f"act-{n:03d}-" + "a" * 50,
            "day": 13,
            "stage_id": stage_ids[n % 20],
            "start": 600 + n,
            "end": 660 + n,
            "locked": True,
            "stage_locked": True,
            "not_before": 500,
            "not_after": 1300,
            "stages": stage_ids,
        }
        for n in range(sets)
    ]


def largest_run_body(character: str) -> dict:
    constraints = {
        "changeover_minutes": 240,
        "curfew": {str(day): 1400 for day in range(14)},
        "no_clash_with": [["a" * 64, "b" * 64]] * 50,
        "billing_rules": [{"billing_tier": 1, "max_stage_tier": 1, "last_slots": 2}] * 10,
        "allow_day_moves": True,
    }
    return {
        "scenario": "clash",
        "input": {
            "preset_id": "p" * 80,
            "message": character * 600,
            "history": [{"role": "user", "text": character * 4000} for _ in range(8)],
            "timetable": long_ids_session(),
            "constraints": constraints,
            "rules": ["r" * 200] * 30,
        },
    }


def test_the_runs_cap_holds_the_largest_body_the_page_can_send_with_room_to_spare():
    sizes = {}
    for label, character in {"ascii": "y", "three-byte": "中"}.items():
        body = largest_run_body(character)
        text = json.dumps(body, separators=(",", ":"), ensure_ascii=False)  # as JSON.stringify writes it
        RunRequest.model_validate_json(text)  # it is a body the route accepts
        sizes[label] = len(text.encode())
    assert sizes["ascii"] < whatif.MAX_RUN_BODY_BYTES // 2  # twice the largest ordinary body fits
    assert sizes["three-byte"] < whatif.MAX_RUN_BODY_BYTES  # and so does the same body in 3-byte characters
    assert whatif.MAX_RUN_BODY_BYTES == 256 * 1024


def test_the_score_cap_holds_the_largest_legal_timetable_with_room_to_spare():
    """80 sets on 20 stages, 80 acts, every field longest, an 80 x 80 matrix of full-precision floats."""
    rng = random.Random(1)
    ids = [f"act-{n:03d}-" + "a" * 40 for n in range(80)]
    stage_ids = [f"s{n:02d}" for n in range(20)]
    values = [[0.0] * 80 for _ in range(80)]
    for i in range(80):
        for k in range(i):
            values[i][k] = values[k][i] = rng.random()
    festival = {
        "id": "f" * 64,
        "name": "n" * 160,
        "city": "c" * 40,
        "days": [f"Day {n}" for n in range(14)],
        "stages": [
            {
                "id": sid,
                "name": "S" * 120,
                "tier": 1,
                "capacity": 50000,
                "hours": [{"day": d, "open": 480, "close": 1400} for d in range(14)],
            }
            for sid in stage_ids
        ],
        "acts": [
            {
                "id": act,
                "name": "N" * 160,
                "qloo_id": "urn:entity:" + "q" * 36,
                "popularity": rng.random(),
                "genre": "g" * 80,
                "billing_tier": 3,
                "rarity": rng.random(),
            }
            for act in ids
        ],
        "timetable": [
            {
                "act_id": act,
                "day": n // 40,
                "stage_id": stage_ids[n % 20],
                "start": 600 + 90 * ((n % 40) // 20),
                "end": 660 + 90 * ((n % 40) // 20),
                "locked": True,
                "stage_locked": True,
                "not_before": 500,
                "not_after": 1300,
                "stages": stage_ids,
            }
            for n, act in enumerate(ids)
        ],
        "constraints": {"curfew": {str(d): 1400 for d in range(14)}},
    }
    matrix = {"act_ids": ids, "values": values, "coverage": dict.fromkeys(ids, "strong"), "source": "derived"}
    text = json.dumps({"festival": festival, "matrix": matrix, "config": {}}, separators=(",", ":"))
    ScoreRequest.model_validate_json(text)
    assert len(text.encode()) < whatif.MAX_SCORE_BODY_BYTES // 2
    assert whatif.MAX_SCORE_BODY_BYTES == 512 * 1024


# ----------------------------------------------------------------------------------------- the routes


def test_runs_cap_is_256_kb_to_the_byte_and_an_over_size_body_never_reaches_the_route(client):
    cap = whatif.MAX_RUN_BODY_BYTES
    at = client.post("/api/runs", content=padded(RUN_BODY, cap), headers=JSON)
    assert at.status_code == 503 and client.reached == ["run"]  # parsed, validated, then "not configured"
    over = client.post("/api/runs", content=padded(RUN_BODY, cap + 1), headers=JSON)
    assert over.status_code == 413 and over.json() == REFUSED
    assert over.headers["cache-control"] == NO_STORE and over.headers["connection"] == "close"
    assert client.reached == ["run"]  # the route was not entered again
    slash = client.post("/api/runs/", content=padded(RUN_BODY, cap + 1), headers=JSON, follow_redirects=False)
    assert slash.status_code == 413
    huge = client.post("/api/runs", content=b" " * THREE_MB, headers=JSON)
    assert huge.status_code == 413 and client.reached == ["run"]


def test_score_cap_is_512_kb_to_the_byte(client):
    cap = whatif.MAX_SCORE_BODY_BYTES
    body = score_body()
    at = client.post("/api/schedule/score", content=padded(body, cap), headers=JSON)
    assert at.status_code == 200 and "metrics" in at.json()
    over = client.post("/api/schedule/score", content=padded(body, cap + 1), headers=JSON)
    assert over.status_code == 413 and over.json() == REFUSED
    assert over.headers["cache-control"] == NO_STORE and over.headers["connection"] == "close"
    huge = client.post("/api/schedule/score", content=b" " * THREE_MB, headers=JSON)
    assert huge.status_code == 413


def test_a_chunked_body_over_either_cap_is_a_413_and_one_within_it_is_replayed(client):
    def chunks(total: int, size: int = 4096):
        for _ in range(total // size):
            yield b" " * size

    over_runs = client.post("/api/runs", content=chunks(whatif.MAX_RUN_BODY_BYTES + 4096), headers=JSON)
    over_score = client.post(
        "/api/schedule/score", content=chunks(whatif.MAX_SCORE_BODY_BYTES + 4096), headers=JSON
    )
    assert over_runs.status_code == over_score.status_code == 413
    assert client.reached == []
    text = json.dumps(score_body()).encode()
    parts = [text[i : i + 5000] for i in range(0, len(text), 5000)]
    ok = client.post("/api/schedule/score", content=iter(parts), headers=JSON)
    assert ok.status_code == 200


def test_get_and_other_posts_are_not_capped_and_the_older_routes_keep_their_16_kb(client):
    assert client.get("/api/schedule/demo").status_code == 200
    pair = client.post("/api/pair", content=b" " * (16 * 1024 + 1), headers=JSON)
    plan = client.post("/api/presets/x/whatif", content=b" " * (16 * 1024 + 1), headers=JSON)
    grid = client.post("/api/price-grid", content=b" " * (16 * 1024 + 1), headers=JSON)
    assert pair.status_code == plan.status_code == grid.status_code == 413
    other = client.post("/api/presets/x/whatif", content=padded({"moves": []}, 16 * 1024), headers=JSON)
    assert other.status_code != 413  # within its cap: the route's own answer (the preset is unknown)


# ----------------------------------------------------------------------------- the middleware itself


def drive(parts, *, path="/api/runs", headers=None, limits=None, never_ends=False, passed=None):
    """Run ``BodyLimit`` over a scripted ASGI exchange; return what it sent and how many reads it made."""
    queue = [
        {"type": "http.request", "body": part, "more_body": i < len(parts) - 1}
        for i, part in enumerate(parts)
    ]
    sent: list[dict] = []
    reads = 0

    async def inner(scope, receive, send):
        body = b""
        while True:
            message = await receive()
            body += message.get("body", b"")
            if not message.get("more_body"):
                break
        (passed if passed is not None else []).append(body)
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    async def receive():
        nonlocal reads
        reads += 1
        if queue:
            return queue.pop(0)
        if never_ends:
            await asyncio.sleep(3600)
        return {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "method": "POST", "path": path, "headers": headers or []}
    asyncio.run(whatif.BodyLimit(inner, **(limits or {}))(scope, receive, send))
    return sent, reads


def test_each_route_has_its_own_cap():
    limits = {"limit": 5, "runs_limit": 10, "score_limit": 20}
    for path, cap in (
        ("/api/presets/day/whatif", 5),
        ("/api/pair", 5),
        ("/api/runs", 10),
        ("/api/schedule/score", 20),
        ("/api/schedule/score/", 20),
    ):
        passed: list[bytes] = []
        sent, _ = drive([b"a" * cap], path=path, limits=limits, passed=passed)
        assert sent[0]["status"] == 204 and passed == [b"a" * cap], path
        sent, _ = drive([b"a" * (cap + 1)], path=path, limits=limits, passed=passed)
        assert sent[0]["status"] == 413 and len(passed) == 1, path


def test_a_refusal_is_sent_at_once_with_connection_close_then_the_rest_of_the_body_is_read_and_dropped():
    parts = [b"x" * 6] * 5
    sent, reads = drive(parts, limits={"runs_limit": 10})
    assert [m["type"] for m in sent] == ["http.response.start", "http.response.body", "http.response.body"]
    start, answer, end = sent
    headers = dict(start["headers"])
    assert start["status"] == 413 and headers[b"connection"] == b"close"
    assert headers[b"cache-control"] == b"no-store" and headers[b"content-type"] == b"application/json"
    assert int(headers[b"content-length"]) == len(answer["body"]) and json.loads(answer["body"]) == REFUSED
    assert answer["more_body"] is True and end == {"type": "http.response.body", "body": b""}
    assert reads == len(parts)  # all five were read (and none kept) before the response was ended
    # a declared length over the cap answers before anything is read, then drains the same way
    sent, reads = drive([b"ab", b"cd"], headers=[(b"content-length", b"999")], limits={"runs_limit": 10})
    assert sent[0]["status"] == 413 and sent[1]["more_body"] is True and reads == 2
    # a body already complete when it crosses the cap is answered in one piece
    sent, _ = drive([b"x" * 11], limits={"runs_limit": 10})
    assert [m.get("more_body") for m in sent[1:]] == [False]


def test_draining_is_bounded_in_bytes_and_in_time(monkeypatch):
    monkeypatch.setattr(whatif, "DRAIN_BYTES", 100)
    sent, reads = drive([b"x" * 60] * 200, limits={"runs_limit": 10})
    assert sent[0]["status"] == 413 and sent[-1]["body"] == b"" and reads < 10  # it stopped reading early
    monkeypatch.setattr(whatif, "DRAIN_SECONDS", 0.05)
    started = time.perf_counter()
    sent, _ = drive([b"x" * 11, b"y"], limits={"runs_limit": 10}, never_ends=True)  # the client goes quiet
    assert sent[0]["status"] == 413 and sent[-1] == {"type": "http.response.body", "body": b""}
    assert time.perf_counter() - started < 2


# ------------------------------------------------------------------------------------ a real socket


def uvicorn_server():
    uvicorn = pytest.importorskip("uvicorn")
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error", lifespan="off")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.02)
    assert server.started
    return server, thread, port


def raw_exchange(port: int, path: str, body: bytes, chunked: bool) -> str:
    """Send the whole body before reading anything, as a simple client does; the status line it then reads."""
    head = f"POST {path} HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n"
    head += "Transfer-Encoding: chunked\r\n\r\n" if chunked else f"Content-Length: {len(body)}\r\n\r\n"
    with socket.create_connection(("127.0.0.1", port), timeout=15) as sock:
        try:
            sock.sendall(head.encode())
            if chunked:
                for i in range(0, len(body), 65536):
                    part = body[i : i + 65536]
                    sock.sendall(b"%x\r\n%s\r\n" % (len(part), part))
                sock.sendall(b"0\r\n\r\n")
            else:
                sock.sendall(body)
        except OSError as error:
            return f"send failed: {type(error).__name__}"
        try:
            data = sock.recv(8192)
        except OSError as error:
            return f"read failed: {type(error).__name__}"
    return data.split(b"\r\n")[0].decode() if data else "closed with no answer"


@pytest.mark.parametrize(
    "path", ["/api/runs", "/api/schedule/score", "/api/presets/x/whatif", "/api/price-grid"]
)
def test_a_3_mb_body_gets_a_readable_413_from_a_real_uvicorn_with_common_clients(path):
    """httpx (declared and chunked), urllib and a raw socket, five times each: every one reads the 413."""
    app.dependency_overrides[get_qloo] = NoQloo
    server, thread, port = uvicorn_server()
    try:
        base = f"http://127.0.0.1:{port}"
        body = b'{"pad":"' + b"a" * THREE_MB + b'"}'

        def streamed():
            for i in range(0, len(body), 65536):
                yield body[i : i + 65536]

        seen: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
        for _ in range(5):
            reply = httpx.post(base + path, content=body, headers=JSON, timeout=15)
            seen["httpx declared"][(reply.status_code, reply.headers.get("connection"), reply.text)] += 1
            reply = httpx.post(base + path, content=streamed(), headers=JSON, timeout=15)
            seen["httpx chunked"][(reply.status_code, reply.headers.get("connection"), reply.text)] += 1
            request = urllib.request.Request(base + path, data=body, headers=JSON, method="POST")
            try:
                urllib.request.urlopen(request, timeout=15)
            except urllib.error.HTTPError as error:
                seen["urllib"][(error.code, error.headers.get("connection"), error.read().decode())] += 1
            seen["raw declared"][raw_exchange(port, path, body, False)] += 1
            seen["raw chunked"][raw_exchange(port, path, body, True)] += 1
        answer = (413, "close", json.dumps(REFUSED, separators=(",", ":")))
        for name in ("httpx declared", "httpx chunked", "urllib"):
            assert seen[name] == {answer: 5}, (name, seen[name])
        for name in ("raw declared", "raw chunked"):
            # Python's own reason phrase: "Request Entity Too Large" to 3.12, "Content Too Large" from 3.13
            assert seen[name] == {f"HTTP/1.1 413 {http.HTTPStatus(413).phrase}": 5}, (name, seen[name])
        # the server still answers an ordinary request afterwards
        assert httpx.get(base + "/api/health", timeout=15).status_code == 200
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        app.dependency_overrides.clear()


def test_a_lying_content_length_with_a_short_body_is_still_answered_at_once():
    """A client that declares 99,999,999 bytes, sends 10 and waits: it reads the 413 without waiting."""
    app.dependency_overrides[get_qloo] = NoQloo
    server, thread, port = uvicorn_server()
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=15) as sock:
            sock.sendall(
                b"POST /api/runs HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n"
                b"Content-Length: 99999999\r\n\r\n0123456789"
            )
            started = time.perf_counter()
            data = b""
            while b"Request too large." not in data:
                chunk = sock.recv(8192)
                assert chunk, data
                data += chunk
        assert data.startswith(b"HTTP/1.1 413")
        assert time.perf_counter() - started < 2  # answered at once, not after the drain ends
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        app.dependency_overrides.clear()
