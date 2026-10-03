"""The limiter probe: silent without its token, and with it the same key the caps use, hashed."""

import hashlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.limits import stamp_signature, visitor_key
from app.main import app
from app.probe import LimiterProbe, install_probe

TOKEN = "probe-token"
SECRET = "test-secret"
PROBE_HEADERS = ("x-probe-key", "x-probe-hops", "x-probe-src", "x-probe-stamp")


def health_app(**settings) -> FastAPI:
    """A small app with a health route in the same place, the probe installed from the settings given."""
    small = FastAPI()

    @small.api_route("/api/health", methods=["GET", "HEAD"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @small.get("/api/other")
    async def other() -> dict[str, str]:
        return {"status": "other"}

    install_probe(small, Settings(_env_file=None, **settings))
    return small


def probed(**settings) -> TestClient:
    return TestClient(health_app(limiter_probe_token=TOKEN, **settings))


def probe_headers(response) -> dict[str, str]:
    return {name: response.headers[name] for name in PROBE_HEADERS if name in response.headers}


def get(client: TestClient, forwarded: str | None = None, token: str | None = TOKEN, **extra: str):
    headers = dict(extra)
    if token is not None:
        headers["x-probe"] = token
    if forwarded is not None:
        headers["x-forwarded-for"] = forwarded
    return client.get("/api/health", headers=headers)


def test_the_probe_is_silent_without_the_token_with_a_wrong_one_or_with_the_setting_unset():
    unset = TestClient(health_app())
    assert unset.app.user_middleware == []  # nothing is added when no token is set
    responses = [
        get(unset, "203.0.113.7"),
        get(unset, "203.0.113.7", token=None),
        get(probed(), "203.0.113.7", token=None),
        get(probed(), "203.0.113.7", token="wrong"),
        get(probed(), "203.0.113.7", token=TOKEN + "x"),
        get(probed(), "203.0.113.7", token=""),
        get(probed(), "203.0.113.7", token=TOKEN.upper()),
    ]
    for response in responses:
        assert response.status_code == 200 and response.json() == {"status": "ok"}
        assert probe_headers(response) == {}
        assert not any(name.startswith("x-probe") for name in response.headers)


def test_the_probe_answers_on_the_health_path_only():
    client = probed()
    other = client.get("/api/other", headers={"x-probe": TOKEN, "x-forwarded-for": "203.0.113.7"})
    assert other.status_code == 200 and probe_headers(other) == {}


def test_the_same_forwarded_address_gives_the_same_key_and_another_gives_another():
    client = probed()
    first = get(client, "203.0.113.7")
    again = get(client, "203.0.113.7, 10.0.0.1")  # only the first hop is the key
    other = get(client, "203.0.113.8")
    assert first.headers["x-probe-key"] == again.headers["x-probe-key"]
    assert first.headers["x-probe-key"] != other.headers["x-probe-key"]
    assert first.headers["x-probe-key"] == hashlib.sha256((TOKEN + "203.0.113.7").encode()).hexdigest()[:8]
    assert len(first.headers["x-probe-key"]) == 8


def test_the_key_is_hashed_and_nothing_else_carries_the_address():
    client = probed()
    response = get(client, "203.0.113.7")
    assert set(probe_headers(response)) == set(PROBE_HEADERS)
    shown = response.text + "".join(f"{name}={value}" for name, value in response.headers.items())
    assert "203.0.113.7" not in shown and "203.0.113" not in shown
    int(response.headers["x-probe-key"], 16)  # hex


def test_the_key_is_the_one_the_caps_compute():
    client = probed(visitor_stamp_secret=SECRET)
    stamp = {"x-clash-visitor": "203.0.113.7", "x-clash-sig": stamp_signature(SECRET, "203.0.113.7")}
    response = get(client, "198.51.100.1", **stamp)
    expected = visitor_key({"x-forwarded-for": "198.51.100.1", **stamp}, "testclient", SECRET)
    assert expected == "stamp:203.0.113.7"
    assert response.headers["x-probe-key"] == hashlib.sha256((TOKEN + expected).encode()).hexdigest()[:8]
    # Without the stamp the same request is keyed on the forwarded address, which the probe shows differently
    unsigned = get(client, "198.51.100.1")
    assert unsigned.headers["x-probe-key"] != response.headers["x-probe-key"]


def test_hops_source_and_stamp_say_where_the_key_came_from():
    client = probed(visitor_stamp_secret=SECRET)
    signed = {"x-clash-visitor": "203.0.113.7", "x-clash-sig": stamp_signature(SECRET, "203.0.113.7")}
    forged = {"x-clash-visitor": "203.0.113.7", "x-clash-sig": "0" * 64}
    cases = [
        (get(client, "203.0.113.7"), ("1", "xff", "none")),
        (get(client, "203.0.113.7, 10.0.0.1, ,10.0.0.2"), ("3", "xff", "none")),
        (get(client, None, **{"x-real-ip": "203.0.113.7"}), ("0", "real-ip", "none")),
        (get(client), ("0", "peer", "none")),
        (get(client, "203.0.113.7", **signed), ("1", "xff", "ok")),
        (get(client, "203.0.113.7", **forged), ("1", "xff", "bad")),
    ]
    for response, (hops, src, stamp) in cases:
        assert (
            response.headers["x-probe-hops"],
            response.headers["x-probe-src"],
            response.headers["x-probe-stamp"],
        ) == (hops, src, stamp)
    # A stamp sent to a server with no secret cannot be verified
    assert get(probed(), "203.0.113.7", **signed).headers["x-probe-stamp"] == "bad"


def test_head_returns_200_with_the_same_headers():
    client = probed()
    headers = {"x-probe": TOKEN, "x-forwarded-for": "203.0.113.7"}
    got = client.get("/api/health", headers=headers)
    head = client.head("/api/health", headers=headers)
    assert head.status_code == 200 and head.content == b""
    assert probe_headers(head) == probe_headers(got) and set(probe_headers(head)) == set(PROBE_HEADERS)
    assert client.head("/api/health").status_code == 200
    assert probe_headers(client.head("/api/health")) == {}


@pytest.fixture
def real_health():
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None)
    yield
    app.dependency_overrides.clear()


def test_the_real_health_route_answers_get_and_head_and_the_probe_wraps_it(real_health):
    plain = TestClient(app)
    assert plain.head("/api/health").status_code == 200
    assert plain.get("/api/health").json()["status"] == "ok"
    wrapped = TestClient(LimiterProbe(app, TOKEN, None))
    response = wrapped.head("/api/health", headers={"x-probe": TOKEN, "x-forwarded-for": "203.0.113.7"})
    assert response.status_code == 200 and set(probe_headers(response)) == set(PROBE_HEADERS)
    assert probe_headers(plain.head("/api/health", headers={"x-probe": TOKEN})) == {}
    health_paths = app.openapi()["paths"]["/api/health"]
    assert set(health_paths) == {"get"}  # HEAD is not in the schema, so there is one operation id
