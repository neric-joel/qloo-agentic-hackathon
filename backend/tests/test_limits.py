"""The run and what-if limiter: idle visitors, the visitor stamp, and the key the agent route counts on."""

import hashlib
import hmac

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.limits import DAY, HOUR, SWEEP_EVERY, RunLimiter, stamp_signature, stamp_state, visitor_key
from app.main import app
from tests.test_clash_runs import setup as setup_presets

SECRET = "test-secret"
ADDRESS = "203.0.113.7"
# Computed in Python with hmac.new(b"test-secret", b"203.0.113.7", "sha256").hexdigest(); the web half
# pins the same pair (web/src/lib/visitor-stamp.test.ts), so the two languages sign alike.
VECTOR = "65c1c9038cd619567fd4f79d0326b88e06b7217ab60052ba5e47e65deb6f89fc"


def stamped(visitor: str = ADDRESS, secret: str = SECRET, **extra: str) -> dict[str, str]:
    return {"x-clash-visitor": visitor, "x-clash-sig": stamp_signature(secret, visitor), **extra}


# ---------------------------------------------------------------------------------------- memory


def test_a_returning_visitor_starts_a_fresh_queue():
    now = [0.0]
    limiter = RunLimiter(5, 10, 100, clock=lambda: now[0])
    assert limiter.try_acquire("a") is None
    assert limiter.try_acquire("b") is None
    assert set(limiter._visitors) == {"a", "b"}
    now[0] = DAY + 1  # everything has left the window
    assert limiter.try_acquire("a") is None  # a's emptied queue is dropped, then a starts afresh
    assert len(limiter._visitors["a"]) == 1
    assert limiter._visitors["b"] is not None  # b is only dropped when it returns or a sweep runs


def test_a_refused_request_stores_nothing_even_for_a_new_visitor():
    limiter = RunLimiter(per_hour=1, per_day=1, global_per_day=1)
    assert limiter.try_acquire("a") is None
    assert limiter.try_acquire("b") is not None  # the global day is used up
    assert "b" not in limiter._visitors


def test_every_500_acquisitions_the_visitors_with_nothing_left_are_swept():
    now = [0.0]
    limiter = RunLimiter(10, 10, 10_000, clock=lambda: now[0])
    for n in range(SWEEP_EVERY - 1):
        assert limiter.try_acquire(f"idle-{n}") is None
    assert len(limiter._visitors) == SWEEP_EVERY - 1
    now[0] = DAY + 1
    assert limiter.try_acquire("live") is None  # the 500th acquisition: a sweep runs
    assert set(limiter._visitors) == {"live"}
    assert len(limiter._all) == 1


def test_the_hour_and_day_windows_still_count():
    now = [0.0]
    limiter = RunLimiter(per_hour=1, per_day=2, global_per_day=10, clock=lambda: now[0])
    assert limiter.try_acquire("a") is None
    assert "this hour" in limiter.try_acquire("a")
    now[0] = HOUR + 1
    assert limiter.try_acquire("a") is None
    assert "today's limit" in limiter.try_acquire("a")
    now[0] = DAY + HOUR + 1
    assert limiter.try_acquire("a") is None


# ------------------------------------------------------------------------------ the visitor stamp


def test_the_signature_is_lowercase_hex_hmac_sha256_of_the_address():
    expected = hmac.new(SECRET.encode(), ADDRESS.encode(), hashlib.sha256).hexdigest()
    assert stamp_signature(SECRET, ADDRESS) == expected
    assert expected == expected.lower() and len(expected) == 64


def test_the_cross_language_vector_matches_the_one_the_web_test_pins():
    assert stamp_signature(SECRET, ADDRESS) == VECTOR


def test_a_valid_stamp_is_the_key_whatever_forwarded_for_says():
    headers = stamped(**{"x-forwarded-for": "198.51.100.1, 10.0.0.1", "x-real-ip": "198.51.100.2"})
    assert visitor_key(headers, "10.1.1.1", SECRET) == "stamp:" + ADDRESS
    assert visitor_key(stamped(ADDRESS), None, SECRET) == "stamp:" + ADDRESS
    assert visitor_key(stamped("2001:db8::7"), None, SECRET) == "stamp:2001:db8::7"
    assert stamp_state(headers, SECRET) == "ok"


def test_without_a_secret_or_a_valid_stamp_the_key_is_what_it_was():
    base = {"x-forwarded-for": "198.51.100.1, 10.0.0.1", "x-real-ip": "198.51.100.2"}
    tampered = {**stamped(), "x-clash-visitor": "203.0.113.8"}
    cases = {
        "no secret set": stamped(**base),
        "wrong secret": stamped(secret="other", **base),
        "no signature": {"x-clash-visitor": ADDRESS, **base},
        "no visitor": {"x-clash-sig": stamp_signature(SECRET, ADDRESS), **base},
        "tampered visitor": {**tampered, **base},
        "not an address": {**stamped("evil"), **base},
        "too long": {**stamped("1" * 65), **base},
        "uppercase signature": {**stamped(), "x-clash-sig": stamp_signature(SECRET, ADDRESS).upper(), **base},
    }
    for name, headers in cases.items():
        secret = None if name == "no secret set" else SECRET
        assert visitor_key(headers, "10.1.1.1", secret) == "198.51.100.1", name
    assert visitor_key({"x-real-ip": "198.51.100.2"}, "10.1.1.1", SECRET) == "198.51.100.2"
    assert visitor_key({}, "10.1.1.1", SECRET) == "10.1.1.1"
    assert visitor_key({}, None) == "unknown"


def test_the_stamp_state_names_what_the_request_carried():
    assert stamp_state({}, SECRET) == "none"
    assert stamp_state(stamped(), SECRET) == "ok"
    assert stamp_state(stamped(secret="other"), SECRET) == "bad"
    assert stamp_state({"x-clash-visitor": ADDRESS}, SECRET) == "bad"
    assert stamp_state(stamped(), None) == "bad"  # a stamp this side cannot verify
    assert stamp_state({}, None) == "none"


# --------------------------------------------------------------------- the agent route's key


@pytest.fixture
def runs_app(tmp_path):
    setup_presets(
        tmp_path, [[{"text": "ok"}]] * 6, limiter=RunLimiter(per_hour=1, per_day=5, global_per_day=5)
    )
    yield tmp_path
    app.dependency_overrides.clear()


def start_run(client: TestClient, headers: dict[str, str]):
    body = {"scenario": "clash", "input": {"preset_id": "day", "message": "What are the worst clashes?"}}
    return client.post("/api/runs", json=body, headers=headers)


def use_secret(tmp_path, secret: str | None) -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(
        presets_dir=tmp_path, visitor_stamp_secret=secret, _env_file=None
    )


def test_runs_count_on_the_signed_address_and_a_forged_stamp_falls_back(runs_app):
    use_secret(runs_app, SECRET)
    with TestClient(app) as client:
        first = start_run(client, stamped(**{"x-forwarded-for": "198.51.100.1"}))
        assert first.status_code == 200
        # Same signed address behind a different forwarded address: the same visitor, over the hourly cap
        same = start_run(client, stamped(**{"x-forwarded-for": "198.51.100.9"}))
        assert same.status_code == 429 and "this hour" in same.json()["detail"]
        # Another signed address has its own count
        other = start_run(client, stamped("203.0.113.8", **{"x-forwarded-for": "198.51.100.1"}))
        assert other.status_code == 200
        # A forged signature is ignored: the forwarded address counts (198.51.100.1 is new to the limiter)
        forged = start_run(
            client,
            {"x-clash-visitor": "203.0.113.99", "x-clash-sig": "0" * 64, "x-forwarded-for": "198.51.100.1"},
        )
        assert forged.status_code == 200
        again = start_run(
            client,
            {"x-clash-visitor": "203.0.113.98", "x-clash-sig": "f" * 64, "x-forwarded-for": "198.51.100.1"},
        )
        assert again.status_code == 429  # a different forged visitor did not buy a fresh count


def test_without_the_secret_the_stamp_is_ignored(runs_app):
    use_secret(runs_app, None)
    with TestClient(app) as client:
        assert start_run(client, stamped(**{"x-forwarded-for": "198.51.100.1"})).status_code == 200
        assert (
            start_run(client, stamped("203.0.113.8", **{"x-forwarded-for": "198.51.100.1"})).status_code
            == 429
        )
