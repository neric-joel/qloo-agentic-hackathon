"""Guards on the public API: bad requests are refused before they take a run slot, every input is bounded,
422s never echo the request, and the agent's runs are capped per turn and per run."""

import copy
import json
import re

import pytest
from fastapi.testclient import TestClient

from app.agent import llm
from app.agent.events import EventChannel
from app.agent.llm import GATEWAY_BASE_URL, AnthropicBackend, ScriptedBackend, build_backend, llm_configured
from app.agent.loop import run_agent
from app.agent.qloo_tools import GENERAL_TOOLS
from app.agent.tools import ENGINE_BUDGET_USED, QLOO_BUDGET_USED, TOO_MANY_CALLS, ToolContext
from app.config import Settings, get_settings
from app.limits import RunLimiter
from app.main import _docs_urls, app, get_backend, get_qloo
from app.presets import get_presets
from app.runs import CLASH_SYSTEM, ExploreInput, RunRequest, execute_run
from app.schedule.metrics import score_festival
from app.schedule.models import format_minutes
from app.schedule.synthetic import synthetic_festival
from tests.schedule_support import with_random_constraints
from tests.test_agent import parse_sse, qloo_client
from tests.test_clash_runs import run, write_preset
from tests.test_clash_runs import setup as setup_presets

LLM_ENV = ("LLM_PROVIDER", "ANTHROPIC_API_KEY", "AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN")
FORBIDDEN = re.compile(r"optimi[sz]|optimal")


class RecordingBackend(ScriptedBackend):
    """A scripted backend that keeps the messages it was sent on each turn."""

    def __init__(self, turns) -> None:
        super().__init__(turns)
        self.seen: list[list[dict]] = []

    async def turn(self, *, system, messages, tools, on_text):
        self.seen.append(list(messages))
        return await super().turn(system=system, messages=messages, tools=tools, on_text=on_text)


@pytest.fixture
def overrides():
    yield app.dependency_overrides
    app.dependency_overrides.clear()


def provide(settings: Settings):
    return lambda: settings


def post_raw(client: TestClient, path: str, text: str):
    return client.post(path, content=text.encode(), headers={"content-type": "application/json"})


def clash(body: dict) -> dict:
    return {"scenario": "clash", "input": body}


def assert_no_echo(response) -> None:
    assert response.status_code == 422
    errors = response.json()["detail"]
    assert errors and all(set(error) == {"loc", "msg", "type"} for error in errors)


# ------------------------------------------------------------------- refuse before spending a slot


def test_bad_requests_never_take_a_limiter_slot(tmp_path, overrides):
    preset = setup_presets(
        tmp_path, [[{"text": "ok"}]], limiter=RunLimiter(per_hour=1, per_day=5, global_per_day=5)
    )
    short = preset["festival"]["timetable"][:-1]
    nan_start = json.dumps(
        clash({"preset_id": "day", "message": "hi", "timetable": [{"start": float("nan")}]})
    )
    with TestClient(app) as client:
        codes = [
            client.post("/api/runs", json=clash({"preset_id": "nope", "message": "hi"})).status_code,
            client.post(
                "/api/runs", json=clash({"preset_id": "day", "message": "hi", "timetable": short})
            ).status_code,
            client.post(
                "/api/runs", json=clash({"preset_id": "day", "message": "hi", "rules": ["x" * 201]})
            ).status_code,
            client.post("/api/runs", json={"scenario": "explore", "input": {"favorites": ["x"]}}).status_code,
            post_raw(client, "/api/runs", nan_start).status_code,
        ]
        good = client.post("/api/runs", json=clash({"preset_id": "day", "message": "hi"}))
        again = client.post("/api/runs", json=clash({"preset_id": "day", "message": "hi"}))
    assert codes == [404, 422, 422, 404, 422]
    assert good.status_code == 200
    assert again.status_code == 429  # the limiter itself still works


@pytest.mark.parametrize(
    "body",
    [
        clash({"preset_id": "day", "message": "hi", "rules": ["x" * 201]}),
        clash(
            {
                "preset_id": "day",
                "message": "hi",
                "timetable": [
                    {"act_id": f"a{i}", "day": 0, "stage_id": "main", "start": 0, "end": 10}
                    for i in range(81)
                ],
            }
        ),
        clash({"preset_id": "day", "message": "hi", "constraints": {"no_clash_with": [["a", "b"]] * 51}}),
        clash(
            {
                "preset_id": "day",
                "message": "hi",
                "constraints": {"billing_rules": [{"billing_tier": 1}] * 11},
            }
        ),
        {"scenario": "explore", "input": {"favorites": ["x" * 81]}},
        {"scenario": "explore", "input": {"favorites": ["x"], "location": "x" * 81}},
        {"scenario": "explore", "input": {"favorites": ["x"], "target": "x" * 61}},
    ],
    ids=["rule", "timetable", "no-clash-pairs", "billing-rules", "favorite", "location", "target"],
)
def test_oversize_inputs_are_rejected(body, overrides):
    overrides[get_settings] = lambda: Settings(_env_file=None, allow_explore=True)
    overrides[get_backend] = lambda: ScriptedBackend([])
    overrides[get_qloo] = qloo_client
    with TestClient(app) as client:
        assert_no_echo(client.post("/api/runs", json=body))


def test_a_422_does_not_echo_a_huge_body(overrides):
    overrides[get_backend] = lambda: None
    with TestClient(app) as client:
        response = client.post(
            "/api/runs", json=clash({"preset_id": "day", "message": "hi", "rules": ["y" * 100_000]})
        )
    assert_no_echo(response)
    assert len(response.content) < 4000 and "y" * 300 not in response.text


# -------------------------------------------------------------------------- no NaN 500s, no echo


def score_body(**config) -> dict:
    festival, matrix = synthetic_festival(5, days=1, acts=6)
    return {
        "festival": festival.model_dump(mode="json"),
        "matrix": matrix.model_dump(mode="json"),
        "config": config,
    }


@pytest.mark.parametrize("where", ["popularity", "matrix", "start"])
@pytest.mark.parametrize("value", [float("nan"), float("inf")])
def test_non_finite_numbers_on_score_are_a_clean_422(where, value):
    body = score_body(baseline_samples=0)
    if where == "popularity":
        body["festival"]["acts"][0]["popularity"] = value
    elif where == "matrix":
        body["matrix"]["values"][0][1] = body["matrix"]["values"][1][0] = value
    else:
        body["festival"]["timetable"][0]["start"] = value
    with TestClient(app) as client:
        response = post_raw(client, "/api/schedule/score", json.dumps(body))
    assert_no_echo(response)


def test_non_finite_numbers_on_runs_are_a_clean_422(tmp_path, overrides):
    setup_presets(tmp_path, [[{"text": "ok"}]])
    with TestClient(app) as client:
        raw = '{"preset_id": "day", "message": "hi", "timetable": [{"start": NaN}]}'
        assert_no_echo(post_raw(client, "/api/runs", '{"scenario": "clash", "input": ' + raw + "}"))
        assert_no_echo(post_raw(client, "/api/runs", '{"input": {"favorites": [Infinity]}}'))
        assert_no_echo(post_raw(client, "/api/runs", "{not json"))


def test_score_caps_the_baseline_and_demo_is_cached():
    with TestClient(app) as client:
        assert client.post("/api/schedule/score", json=score_body(baseline_samples=2000)).status_code == 422
        assert client.post("/api/schedule/score", json=score_body(baseline_samples=20)).status_code == 200
        assert client.get("/api/schedule/demo", params={"seed": 100}).status_code == 422
        demo = client.get("/api/schedule/demo", params={"seed": 7})
    assert demo.status_code == 200 and demo.headers["cache-control"] == "public, s-maxage=3600"


# ------------------------------------------------------------------------------- public surface


def test_docs_and_the_reslot_route_are_not_public():
    with TestClient(app) as client:
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert client.get(path).status_code == 404
        assert client.post("/api/schedule/optimize", json={}).status_code in (404, 405)
    assert app.title == "Clash Control API"
    routes = " ".join(f"{getattr(r, 'path', '')} {getattr(r, 'name', '')}" for r in app.routes)
    assert not FORBIDDEN.search(routes.lower())
    # What /openapi.json would serve with DOCS_ENABLED=true
    assert not FORBIDDEN.search(json.dumps(app.openapi()).lower())
    assert _docs_urls(Settings(_env_file=None, docs_enabled=True)) == {}


def test_preset_json_omits_the_matrix_but_the_server_keeps_it(tmp_path, overrides):
    write_preset(tmp_path)
    overrides[get_settings] = lambda: Settings(presets_dir=tmp_path, _env_file=None)
    with TestClient(app) as client:
        served = client.get("/api/presets/day").json()
    assert "matrix" not in served and served["festival"]["id"]
    assert len(get_presets(Settings(presets_dir=tmp_path, _env_file=None))["day"].matrix.act_ids) == 12


# ----------------------------------------------------------------------------------- run caps


def test_a_normal_run_fits_inside_the_default_caps(tmp_path, overrides):
    preset = setup_presets(tmp_path, [])
    movable = [s for s in preset["festival"]["timetable"] if not s["locked"]]
    a, b, c = (s["act_id"] for s in movable[:3])
    move = {"act": a, "stage": movable[0]["stage_id"], "start": format_minutes(movable[0]["start"])}
    script = [
        [{"tool": "clash_report", "input": {"limit": 3}}],
        [
            {"tool": "explain_clash", "input": {"act_a": a, "act_b": b}},
            {"tool": "explain_clash", "input": {"act_a": a, "act_b": c}},
            {"tool": "find_moves", "input": {"act": a}},
            {"tool": "find_moves", "input": {"act": b}},
        ],
        [{"tool": "try_move", "input": move}, {"tool": "try_move", "input": {**move, "act": b}}],
        [{"tool": "explain_clash", "input": {"act_a": b, "act_b": c}}],
        [{"text": "Here is what moving them would do."}],
    ]
    overrides[get_backend] = lambda: ScriptedBackend(script)
    with TestClient(app) as client:
        events = run(client, {"preset_id": "day", "message": "Where could these sets go?"})
    results = [e for e in events if e["type"] == "tool_result"]
    assert len(results) == 8 and all(r["ok"] for r in results)
    assert "result" in [e["type"] for e in events] and "error" not in [e["type"] for e in events]


def test_tool_calls_past_the_turn_cap_are_skipped(tmp_path, overrides):
    setup_presets(tmp_path, [])
    eight = [{"tool": "clash_report", "input": {"limit": 1}} for _ in range(8)]
    backend = RecordingBackend([eight, [{"text": "Done."}]])
    overrides[get_backend] = lambda: backend
    with TestClient(app) as client:
        events = run(client, {"preset_id": "day", "message": "What are the worst clashes?"})
    results = [e for e in events if e["type"] == "tool_result"]
    assert [r["ok"] for r in results] == [True] * 6 + [False] * 2
    sent_back = backend.seen[1][-1]["content"]
    assert [block.get("is_error", False) for block in sent_back] == [False] * 6 + [True] * 2
    assert all(block["content"] == TOO_MANY_CALLS for block in sent_back[6:])
    assert "result" in [e["type"] for e in events]


def test_turn_cap_comes_from_settings(tmp_path, overrides):
    setup_presets(tmp_path, [])
    overrides[get_settings] = lambda: Settings(presets_dir=tmp_path, _env_file=None, agent_max_turns=1)
    overrides[get_backend] = lambda: ScriptedBackend([[{"tool": "clash_report", "input": {"limit": 1}}]])
    with TestClient(app) as client:
        events = run(client, {"preset_id": "day", "message": "hi"})
    error = next(e for e in events if e["type"] == "error")
    assert "ran out of steps" in error["message"]


def resolve(name: str) -> dict:
    return {"tool": "resolve_entities", "input": {"names": [name], "entity_type": "urn:entity:artist"}}


async def test_qloo_backed_tools_stop_at_the_run_budget():
    backend = RecordingBackend([[resolve("A"), resolve("B")], [resolve("C")], [{"text": "Done."}]])
    ctx = ToolContext(qloo=qloo_client(), qloo_budget=2)
    events = []

    async def emit(event):
        events.append(event)

    outcome = await run_agent(backend, system=[], user_content="hi", tools=GENERAL_TOOLS, ctx=ctx, emit=emit)
    results = [e for e in events if e["type"] == "tool_result"]
    assert outcome.stop == "done"
    assert [r["ok"] for r in results] == [True, True, False]
    assert results[2]["requests"] == []  # refused before any request went out
    refused = backend.seen[2][-1]["content"][0]
    assert refused["is_error"] and refused["content"] == QLOO_BUDGET_USED
    assert ctx.state["qloo_calls"] == 2
    await ctx.qloo.aclose()


async def test_execute_run_applies_the_qloo_budget():
    recommend = {
        "tool": "recommend",
        "input": {"signal_entity_ids": ["A1"], "target_type": "urn:entity:place", "location": "", "take": 3},
    }
    channel = EventChannel()
    qloo = qloo_client()
    request = RunRequest(scenario="explore", input=ExploreInput(favorites=["Phoebe Bridgers"]))
    script = [[resolve("Phoebe Bridgers")], [recommend], [{"text": "Done."}]]
    await execute_run(channel, ScriptedBackend(script), qloo, request, max_qloo_calls=1)
    events = parse_sse("".join([frame async for frame in channel.frames()]))
    results = [e for e in events if e["type"] == "tool_result"]
    assert [r["ok"] for r in results] == [True, False]
    assert events[-1]["qloo_calls"] == 1
    await qloo.aclose()


def test_run_budget_defaults(monkeypatch):
    for name in (
        "AGENT_MAX_TOKENS",
        "AGENT_EFFORT",
        "AGENT_MAX_TURNS",
        "AGENT_MAX_TOOL_CALLS_PER_TURN",
        "AGENT_MAX_QLOO_CALLS_PER_RUN",
        "AGENT_MAX_RESLOTS_PER_RUN",
        "AGENT_MAX_ENGINE_SECONDS",
        "ALLOW_EXPLORE",
        "DOCS_ENABLED",
    ):
        monkeypatch.delenv(name, raising=False)
    settings = Settings(_env_file=None)
    assert settings.agent_max_tokens == 2500 and settings.agent_effort == "low"
    assert settings.agent_max_turns == 6
    assert settings.agent_max_tool_calls_per_turn == 6 and settings.agent_max_qloo_calls_per_run == 12
    assert settings.agent_max_reslots_per_run == 1 and settings.agent_max_engine_seconds == 20.0
    assert settings.allow_explore is False and settings.docs_enabled is False


# --------------------------------------------------------------------------------------- wording


def test_agent_prompt_and_limit_messages_make_no_false_claims():
    assert "same people" not in CLASH_SYSTEM and "optimal" not in CLASH_SYSTEM
    assert "Never describe taste overlap as a percentage of fans or a headcount." in CLASH_SYSTEM
    assert "suggestions graded by the same measure used to find them" in CLASH_SYSTEM
    assert "call find_moves once" in CLASH_SYSTEM
    now = [0.0]
    limiter = RunLimiter(per_hour=1, per_day=2, global_per_day=3, clock=lambda: now[0])
    assert limiter.try_acquire("a") is None
    hour = limiter.try_acquire("a")
    now[0] = 3601
    assert limiter.try_acquire("a") is None
    day = limiter.try_acquire("a")
    assert limiter.try_acquire("b") is None
    everyone = limiter.try_acquire("c")
    assert "this hour" in hour and "today's limit of live" in day and "reached today's limit" in everyone
    assert not any("recorded run" in message.lower() for message in (hour, day, everyone))


# ----------------------------------------------------------------------------------- health


def test_health_reports_the_llm_without_building_a_client(monkeypatch, overrides):
    def no_client(*args, **kwargs):
        raise AssertionError("health must not construct an LLM client")

    for name in LLM_ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(llm, "AsyncAnthropic", no_client)
    cases = [
        (Settings(_env_file=None), {}, False),
        (Settings(_env_file=None, llm_provider="anthropic", anthropic_api_key="k"), {}, True),
        (Settings(_env_file=None, llm_provider="gateway"), {}, False),
        (Settings(_env_file=None, llm_provider="gateway"), {"x-vercel-oidc-token": "t"}, True),
    ]
    with TestClient(app) as client:
        for settings, headers, expected in cases:
            overrides[get_settings] = provide(settings)
            assert client.get("/api/health", headers=headers).json()["llm_configured"] is expected
            assert llm_configured(settings, headers) is expected


def test_backends_share_one_client_per_credential(monkeypatch):
    for name in LLM_ENV:
        monkeypatch.delenv(name, raising=False)
    settings = Settings(_env_file=None, llm_provider="anthropic", anthropic_api_key="k1")
    first, second = build_backend(settings), build_backend(settings)
    other = build_backend(Settings(_env_file=None, llm_provider="anthropic", anthropic_api_key="k2"))
    gateway = build_backend(Settings(_env_file=None, llm_provider="gateway"), {"x-vercel-oidc-token": "t"})
    assert all(isinstance(b, AnthropicBackend) for b in (first, second, other, gateway))
    assert first.client is second.client and other.client is not first.client
    assert str(gateway.client.base_url).startswith(GATEWAY_BASE_URL)
    assert build_backend(Settings(_env_file=None)) is None


# ------------------------------------------------------------------------------- session trust


def windowed_preset(tmp_path, script, limiter=None) -> dict:
    """The clash-run preset, rewritten with locks, stage locks, start windows, stage lists, a curfew and a
    rider pair, as the real presets have them."""
    setup_presets(tmp_path, script, limiter=limiter)
    base, matrix = synthetic_festival(5, days=1, acts=12)
    festival = with_random_constraints(
        base,
        5,
        lock_share=0.3,
        stage_lock_share=0.3,
        allow_day_moves=False,
        window_share=1.0,
        stage_list_share=1.0,
    )
    preset = {
        "id": "day",
        "title": "Day",
        "festival": festival.model_dump(mode="json"),
        "matrix": matrix.model_dump(mode="json"),
        "report": score_festival(festival, matrix).model_dump(mode="json"),
    }
    (tmp_path / "day.json").write_text(json.dumps(preset), encoding="utf-8")
    return preset


def published_session(preset: dict) -> dict:
    return copy.deepcopy(
        {"timetable": preset["festival"]["timetable"], "constraints": preset["festival"]["constraints"]}
    )


def tampered(preset: dict) -> dict[str, dict]:
    """The red team's edits to the published session, each loosening or moving something."""
    stage_ids = [stage["id"] for stage in preset["festival"]["stages"]]
    cases: dict[str, dict] = {}

    def case(name: str, edit) -> None:
        session = published_session(preset)
        edit(session)
        assert session != published_session(preset), name
        cases[name] = session

    def each(field: str, change):
        return lambda session: [change(slot) for slot in session["timetable"] if slot.get(field) is not None]

    case("locks removed", each("locked", lambda slot: slot.update(locked=False)))
    case("stage locks removed", each("stage_locked", lambda slot: slot.update(stage_locked=False)))
    case("windows widened", each("not_after", lambda slot: slot.update(not_after=slot["not_after"] + 30)))
    case(
        "earliest starts widened",
        each("not_before", lambda slot: slot.update(not_before=slot["not_before"] - 30)),
    )
    case("windows removed", each("not_after", lambda slot: slot.update(not_before=None, not_after=None)))
    case("stage lists removed", each("stages", lambda slot: slot.update(stages=None)))
    case("stage lists widened", each("stages", lambda slot: slot.update(stages=list(stage_ids))))
    case(
        "an extra stage",
        lambda session: next(
            slot["stages"].append(next(s for s in stage_ids if s not in slot["stages"]))
            for slot in session["timetable"]
            if len(slot["stages"]) < len(stage_ids)
        ),
    )
    case("sets shortened to a minute", each("end", lambda slot: slot.update(end=slot["start"] + 1)))

    def swap(session: dict) -> None:
        first, second = [slot for slot in session["timetable"] if not slot["locked"]][:2]
        for key in ("stage_id", "start", "end", "stages"):
            first[key], second[key] = second[key], first[key]

    case("two sets swapped", swap)
    case("curfew changed", lambda session: session["constraints"]["curfew"].update({"0": 1440}))
    case("changeover changed", lambda session: session["constraints"].update(changeover_minutes=0))
    case("day moves allowed", lambda session: session["constraints"].update(allow_day_moves=True))
    case("rider pair dropped", lambda session: session["constraints"].update(no_clash_with=[]))
    return cases


def test_a_session_that_loosens_the_published_day_is_refused_before_the_run(tmp_path, overrides):
    limiter = RunLimiter(per_hour=1, per_day=5, global_per_day=5)
    preset = windowed_preset(tmp_path, [[{"text": "ok"}]], limiter=limiter)
    cases = tampered(preset)
    with TestClient(app) as client:
        refused = {
            name: client.post("/api/runs", json=clash({"preset_id": "day", "message": "hi", **session}))
            for name, session in cases.items()
        }
        good = client.post(
            "/api/runs", json=clash({"preset_id": "day", "message": "hi", **published_session(preset)})
        )
        again = client.post("/api/runs", json=clash({"preset_id": "day", "message": "hi"}))
    for name, response in refused.items():
        assert response.status_code == 422, name
        detail = response.json()["detail"]
        assert detail in (
            "The timetable does not match this festival day.",
            "The timetable is not valid for this festival day.",
        ), name
    assert (
        sum(r.json()["detail"].endswith("does not match this festival day.") for r in refused.values()) >= 12
    )
    assert good.status_code == 200  # the tampered sessions took no limiter slot
    assert again.status_code == 429


def test_a_session_built_by_the_agents_own_rules_round_trips(tmp_path, overrides):
    preset = windowed_preset(tmp_path, [])
    slots = preset["festival"]["timetable"]
    free = [slot for slot in slots if not slot["locked"] and not slot["stage_locked"]]
    bounded = next(slot for slot in free if slot["not_before"] is not None)
    other = next(slot for slot in free if slot["act_id"] != bounded["act_id"])
    earlier = format_minutes(bounded["not_before"] - 60)
    later = format_minutes(bounded["not_after"] + 60)

    def rule(kind: str, act: str, time: str = "", other_act: str = "") -> dict:
        return {
            "tool": "add_constraint",
            "input": {"kind": kind, "act": act, "time": time, "other_act": other_act},
        }

    script = [
        [
            rule("lock", other["act_id"]),
            rule("keep_stage", bounded["act_id"]),
            rule("not_before", bounded["act_id"], earlier),
            rule("not_after", bounded["act_id"], later),
            rule("keep_apart", bounded["act_id"], other_act=other["act_id"]),
        ],
        [{"text": "Recorded."}],
    ]
    overrides[get_backend] = lambda: ScriptedBackend(script)
    with TestClient(app) as client:
        events = run(client, {"preset_id": "day", "message": "Set these rules."})
        session = next(e for e in events if e["type"] == "result")["data"]["session"]
        again = run(client, {"preset_id": "day", "message": "And now?", **session})
    assert all(e["ok"] for e in events if e["type"] == "tool_result")
    assert "result" in [e["type"] for e in again]
    kept = next(slot for slot in session["timetable"] if slot["act_id"] == bounded["act_id"])
    # A looser bound than the published one changes nothing; the rule text says what holds
    assert (kept["not_before"], kept["not_after"]) == (bounded["not_before"], bounded["not_after"])
    assert kept["stages"] == [bounded["stage_id"]]
    assert f"no earlier than {format_minutes(bounded['not_before'])}" in " ".join(session["rules"])


# ----------------------------------------------------------------------------------- engine caps


def test_one_reslot_per_run(tmp_path, overrides):
    setup_presets(tmp_path, [])
    reslot = {"tool": "reslot", "input": {"objective": 1, "move_budget": 2}}
    backend = RecordingBackend([[reslot], [reslot], [reslot], [{"text": "Done."}]])
    overrides[get_backend] = lambda: backend
    with TestClient(app) as client:
        events = run(client, {"preset_id": "day", "message": "Suggest moves."})
    results = [e for e in events if e["type"] == "tool_result"]
    assert [r["ok"] for r in results] == [True, False, False]
    assert results[1]["summary"] == "Skipped: one re-slot per run"
    refused = [backend.seen[turn][-1]["content"][0] for turn in (2, 3)]
    assert all(
        block["is_error"] and block["content"] == "Error: only one re-slot per run." for block in refused
    )
    assert "result" in [e["type"] for e in events]


def test_engine_seconds_cap_comes_from_settings(tmp_path, overrides):
    preset = setup_presets(tmp_path, [])
    overrides[get_settings] = lambda: Settings(
        presets_dir=tmp_path, _env_file=None, agent_max_engine_seconds=0
    )
    act = next(slot["act_id"] for slot in preset["festival"]["timetable"] if not slot["locked"])
    backend = RecordingBackend([[{"tool": "find_moves", "input": {"act": act}}], [{"text": "Done."}]])
    overrides[get_backend] = lambda: backend
    with TestClient(app) as client:
        events = run(client, {"preset_id": "day", "message": "Where could it go?"})
    result = next(e for e in events if e["type"] == "tool_result")
    assert result["ok"] is False and "Calculation budget" in result["summary"]
    assert backend.seen[1][-1]["content"][0]["content"] == ENGINE_BUDGET_USED
