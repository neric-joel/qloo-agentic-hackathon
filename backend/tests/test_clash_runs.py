import json

from fastapi.testclient import TestClient

from app.agent.llm import ScriptedBackend
from app.config import Settings, get_settings
from app.limits import RunLimiter, visitor_key
from app.main import app, get_backend, get_limiter, get_qloo
from app.schedule.metrics import score_festival
from app.schedule.synthetic import synthetic_festival
from tests.test_agent import parse_sse, qloo_client


def write_preset(directory) -> dict:
    festival, matrix = synthetic_festival(5, days=1, acts=12)
    preset = {
        "id": "day",
        "title": "Day",
        "festival": festival.model_dump(mode="json"),
        "matrix": matrix.model_dump(mode="json"),
        "report": score_festival(festival, matrix).model_dump(mode="json"),
    }
    (directory / "day.json").write_text(json.dumps(preset), encoding="utf-8")
    return preset


def run(client: TestClient, body: dict) -> list[dict]:
    response = client.post("/api/runs", json={"scenario": "clash", "input": body})
    assert response.status_code == 200, response.text
    return parse_sse(response.text)


def setup(tmp_path, script, limiter=None):
    preset = write_preset(tmp_path)
    app.dependency_overrides[get_settings] = lambda: Settings(presets_dir=tmp_path, _env_file=None)
    app.dependency_overrides[get_backend] = lambda: ScriptedBackend(script)
    app.dependency_overrides[get_qloo] = qloo_client
    app.dependency_overrides[get_limiter] = lambda: limiter or RunLimiter(100, 100, 100)
    return preset


def test_clash_run_uses_engine_tools_and_returns_the_session(tmp_path):
    first_act = None
    script = [
        [{"text": "Recording that rule."}, {"tool": "clash_report", "input": {"limit": 3}}],
        [{"text": "Done."}],
    ]
    preset = setup(tmp_path, script)
    first_act = preset["festival"]["acts"][0]["id"]
    try:
        with TestClient(app) as client:
            events = run(client, {"preset_id": "day", "message": "What are the worst clashes?"})
        types = [e["type"] for e in events]
        assert types[0] == "run_started" and types[-1] == "run_finished"
        call = next(e for e in events if e["type"] == "tool_call")
        assert call["tool"] == "clash_report" and call["provenance"] == "derived"
        assert next(e for e in events if e["type"] == "tool_result")["ok"] is True
        result = next(e for e in events if e["type"] == "result")
        assert result["kind"] == "clash"
        session = result["data"]["session"]
        assert {s["act_id"] for s in session["timetable"]} >= {first_act}
        assert session["rules"] == []
    finally:
        app.dependency_overrides.clear()


def test_constraints_from_the_agent_come_back_in_the_session(tmp_path):
    preset = setup(tmp_path, [])
    act = next(s["act_id"] for s in preset["festival"]["timetable"] if not s["locked"])
    script = [
        [{"tool": "add_constraint", "input": {"kind": "lock", "act": act, "time": "", "other_act": ""}}],
        [{"text": "Locked."}],
    ]
    app.dependency_overrides[get_backend] = lambda: ScriptedBackend(script)
    try:
        with TestClient(app) as client:
            events = run(client, {"preset_id": "day", "message": f"Keep {act} where it is."})
        session = next(e for e in events if e["type"] == "result")["data"]["session"]
        assert next(s for s in session["timetable"] if s["act_id"] == act)["locked"] is True
        assert len(session["rules"]) == 1

        with TestClient(app) as client:
            again = run(client, {"preset_id": "day", "message": "And now?", **session})
        assert "result" in [e["type"] for e in again]
    finally:
        app.dependency_overrides.clear()


def test_bad_sessions_and_unknown_presets_are_reported(tmp_path):
    preset = setup(tmp_path, [[{"text": "x"}]])
    try:
        with TestClient(app) as client:
            missing = run(client, {"preset_id": "nope", "message": "hi"})
            assert missing[1]["type"] == "error" and "not available" in missing[1]["message"]
            short = preset["festival"]["timetable"][:-1]
            bad = run(client, {"preset_id": "day", "message": "hi", "timetable": short})
            assert bad[1]["type"] == "error" and "does not match" in bad[1]["message"]
    finally:
        app.dependency_overrides.clear()


def test_run_limits_return_429(tmp_path):
    setup(tmp_path, [[{"text": "ok"}]], limiter=RunLimiter(per_hour=1, per_day=5, global_per_day=5))
    try:
        with TestClient(app) as client:
            body = {"scenario": "clash", "input": {"preset_id": "day", "message": "hi"}}
            assert client.post("/api/runs", json=body).status_code == 200
            refused = client.post("/api/runs", json=body)
            assert refused.status_code == 429 and "this hour" in refused.json()["detail"]
    finally:
        app.dependency_overrides.clear()


def test_limiter_windows_and_visitor_key():
    now = [0.0]
    limiter = RunLimiter(per_hour=2, per_day=3, global_per_day=4, clock=lambda: now[0])
    assert limiter.try_acquire("a") is None and limiter.try_acquire("a") is None
    assert "this hour" in limiter.try_acquire("a")
    now[0] = 3601
    assert limiter.try_acquire("a") is None
    assert "today's limit of live" in limiter.try_acquire("a")
    assert limiter.try_acquire("b") is None
    assert "reached today's limit" in limiter.try_acquire("c")
    now[0] = 86400 + 3601
    assert limiter.try_acquire("a") is None
    assert visitor_key({"x-forwarded-for": "1.2.3.4, 10.0.0.1"}, "9.9.9.9") == "1.2.3.4"
    assert visitor_key({}, "9.9.9.9") == "9.9.9.9"
