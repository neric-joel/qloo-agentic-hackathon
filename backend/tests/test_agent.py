import json

import httpx
from fastapi.testclient import TestClient

from app.agent.llm import ScriptedBackend
from app.agent.loop import run_agent
from app.agent.qloo_tools import GENERAL_TOOLS
from app.agent.tools import ToolContext
from app.main import app, get_backend, get_qloo
from app.qloo.client import QlooClient

SEARCH = {"results": [{"name": "Phoebe Bridgers", "entity_id": "A1", "popularity": 0.97}]}
INSIGHTS = {
    "results": {
        "entities": [
            {
                "name": "Cafe Example",
                "entity_id": "P1",
                "popularity": 0.81,
                "query": {"affinity": 0.912345},
                "tags": [{"name": "Cozy"}, {"name": "Live music"}],
            }
        ]
    }
}


def qloo_client(handler=None) -> QlooClient:
    def default(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/search":
            return httpx.Response(200, json=SEARCH)
        return httpx.Response(200, json=INSIGHTS)

    return QlooClient("test-key", backoff=0, max_rps=None, transport=httpx.MockTransport(handler or default))


HAPPY_SCRIPT = [
    [
        {"text": "Looking those up."},
        {
            "tool": "resolve_entities",
            "input": {"names": ["Phoebe Bridgers"], "entity_type": "urn:entity:artist"},
        },
    ],
    [
        {
            "tool": "recommend",
            "input": {
                "signal_entity_ids": ["A1"],
                "target_type": "urn:entity:place",
                "location": "Austin",
                "take": 5,
            },
        }
    ],
    [{"text": "Here are your picks."}],
]


async def test_agent_resolves_then_recommends():
    events = []

    async def emit(event):
        events.append(event)

    ctx = ToolContext(qloo=qloo_client())
    outcome = await run_agent(
        ScriptedBackend(HAPPY_SCRIPT), system=[], user_content="hi", tools=GENERAL_TOOLS, ctx=ctx, emit=emit
    )

    assert outcome.stop == "done"
    assert outcome.text == "Here are your picks."
    results = [e for e in events if e["type"] == "tool_result"]
    assert [r["tool"] for r in results] == ["resolve_entities", "recommend"]
    assert all(r["ok"] for r in results)
    search_req = results[0]["requests"][0]
    insights_req = results[1]["requests"][0]
    assert search_req["path"] == "/search" and search_req["params"]["types"] == "urn:entity:artist"
    assert insights_req["path"] == "/v2/insights"
    assert insights_req["params"]["filter.location.query"] == "Austin"
    assert insights_req["params"]["feature.explainability"] == "true"
    picks = next(
        iter(v for v in ctx.state["tool_data"].values() if isinstance(v, list) and "affinity" in v[0])
    )
    assert picks[0] == {
        "entity_id": "P1",
        "name": "Cafe Example",
        "affinity": 0.912,
        "popularity": 0.81,
        "tags": ["Cozy", "Live music"],
        "explainability": None,
    }
    await ctx.qloo.aclose()


async def test_bad_tool_calls_go_back_to_the_model_as_errors():
    script = [
        [
            {"tool": "no_such_tool", "input": {}},
            {
                "tool": "recommend",
                "input": {
                    "signal_entity_ids": [],
                    "target_type": "urn:entity:book",
                    "location": "",
                    "take": 3,
                },
            },
        ],
        [{"text": "Sorry, I could not do that."}],
    ]
    events = []

    async def emit(event):
        events.append(event)

    ctx = ToolContext(qloo=qloo_client())
    outcome = await run_agent(
        ScriptedBackend(script), system=[], user_content="hi", tools=GENERAL_TOOLS, ctx=ctx, emit=emit
    )
    results = [e for e in events if e["type"] == "tool_result"]
    assert outcome.stop == "done"
    assert [r["ok"] for r in results] == [False, False]
    assert results[0]["provenance"] == "llm"
    await ctx.qloo.aclose()


async def test_qloo_errors_are_reported_with_reason():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400, json={"error": {"reason": "at least one valid signal or filter is required"}}
        )

    script = [
        [
            {
                "tool": "recommend",
                "input": {
                    "signal_entity_ids": ["X"],
                    "target_type": "urn:entity:book",
                    "location": "",
                    "take": 3,
                },
            }
        ],
        [{"text": "Qloo could not answer that."}],
    ]
    events = []

    async def emit(event):
        events.append(event)

    ctx = ToolContext(qloo=qloo_client(handler))
    await run_agent(
        ScriptedBackend(script), system=[], user_content="hi", tools=GENERAL_TOOLS, ctx=ctx, emit=emit
    )
    result = next(e for e in events if e["type"] == "tool_result")
    assert result["ok"] is False
    assert result["summary"] == "Qloo error (400)"
    assert result["requests"][0]["status"] == 400
    await ctx.qloo.aclose()


async def test_resolve_flags_ambiguous_names():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "results": [
                    {
                        "name": "Phoenix",
                        "entity_id": "B1",
                        "popularity": 0.9,
                        "disambiguation": "French band",
                    },
                    {"name": "Phoenix", "entity_id": "B2", "popularity": 0.4, "disambiguation": "Other"},
                ]
            },
        )

    from app.agent.qloo_tools import resolve_entities

    ctx = ToolContext(qloo=qloo_client(handler))
    output = await resolve_entities({"names": ["Phoenix"], "entity_type": "urn:entity:artist"}, ctx)
    assert output.data[0]["ambiguous"] is True
    assert output.data[0]["match"]["entity_id"] == "B1"
    await ctx.qloo.aclose()


def parse_sse(body: str) -> list[dict]:
    return [json.loads(line[6:]) for line in body.splitlines() if line.startswith("data: ")]


def test_runs_endpoint_streams_the_whole_run():
    app.dependency_overrides[get_backend] = lambda: ScriptedBackend(HAPPY_SCRIPT)
    app.dependency_overrides[get_qloo] = qloo_client
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/runs",
                json={
                    "scenario": "explore",
                    "input": {"favorites": ["Phoebe Bridgers"], "location": "Austin"},
                },
            )
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert response.headers["cache-control"] == "no-cache, no-transform"
        events = parse_sse(response.text)
        types = [e["type"] for e in events]
        assert types[0] == "run_started" and types[-1] == "run_finished"
        assert "result" in types and "error" not in types
        assert events[-1]["qloo_calls"] == 2
    finally:
        app.dependency_overrides.clear()


def test_runs_endpoint_returns_503_without_llm():
    app.dependency_overrides[get_backend] = lambda: None
    try:
        with TestClient(app) as client:
            response = client.post("/api/runs", json={"input": {"favorites": ["x"]}})
        assert response.status_code == 503
    finally:
        app.dependency_overrides.clear()


def test_health_reports_configuration():
    with TestClient(app) as client:
        body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert set(body) == {"status", "qloo_key_configured", "llm_configured"}


def test_backend_omits_effort_for_haiku_and_enables_fallback_for_sonnet():
    from app.agent.llm import AnthropicBackend, build_backend, supports_effort
    from app.config import Settings

    assert supports_effort("claude-sonnet-5-5") and not supports_effort("claude-haiku-4-5")
    sonnet = build_backend(Settings(_env_file=None, llm_provider="anthropic", anthropic_api_key="x"))
    haiku = build_backend(
        Settings(
            _env_file=None, llm_provider="anthropic", anthropic_api_key="x", agent_model="claude-haiku-4-5"
        )
    )
    assert isinstance(sonnet, AnthropicBackend) and isinstance(haiku, AnthropicBackend)
    assert (sonnet.model, sonnet.fallbacks, sonnet.max_tokens) == ("claude-sonnet-5-5", True, 8000)
    assert (haiku.model, haiku.fallbacks) == ("claude-haiku-4-5", False)
