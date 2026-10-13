import json

import httpx
from fastapi.testclient import TestClient

from app.agent.llm import ScriptedBackend
from app.agent.loop import run_agent
from app.agent.qloo_tools import GENERAL_TOOLS
from app.agent.tools import ToolContext
from app.config import Settings, get_settings
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


EXPLORE_BODY = {"scenario": "explore", "input": {"favorites": ["Phoebe Bridgers"], "location": "Austin"}}


def test_runs_endpoint_streams_the_whole_run():
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None, allow_explore=True)
    app.dependency_overrides[get_backend] = lambda: ScriptedBackend(HAPPY_SCRIPT)
    app.dependency_overrides[get_qloo] = qloo_client
    try:
        with TestClient(app) as client:
            response = client.post("/api/runs", json=EXPLORE_BODY)
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


def test_explore_scenario_is_off_by_default():
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None)
    app.dependency_overrides[get_backend] = lambda: ScriptedBackend(HAPPY_SCRIPT)
    app.dependency_overrides[get_qloo] = qloo_client
    try:
        with TestClient(app) as client:
            refused = client.post("/api/runs", json=EXPLORE_BODY)
            unlabelled = client.post("/api/runs", json={"input": EXPLORE_BODY["input"]})
            # An explore input under the clash label contradicts itself: refused before anything runs.
            relabelled = client.post("/api/runs", json={**EXPLORE_BODY, "scenario": "clash"})
        assert refused.status_code == 404 and refused.json()["detail"] == "That scenario is not available."
        assert unlabelled.status_code == 404
        assert relabelled.status_code == 422
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
    assert set(body) == {"status", "qloo_key_configured", "llm_configured", "pair_check", "price_grid_live"}


def test_backend_omits_effort_for_haiku_and_enables_fallback_for_sonnet():
    from app.agent.llm import AnthropicBackend, build_backend, supports_effort

    assert supports_effort("claude-sonnet-5-5") and not supports_effort("claude-haiku-4-5")
    sonnet = build_backend(Settings(_env_file=None, llm_provider="anthropic", anthropic_api_key="x"))
    haiku = build_backend(
        Settings(
            _env_file=None, llm_provider="anthropic", anthropic_api_key="x", agent_model="claude-haiku-4-5"
        )
    )
    assert isinstance(sonnet, AnthropicBackend) and isinstance(haiku, AnthropicBackend)
    assert (sonnet.model, sonnet.fallbacks, sonnet.max_tokens) == ("claude-sonnet-5-5", True, 2500)
    assert (haiku.model, haiku.fallbacks) == ("claude-haiku-4-5", False)


# ------------------------------------------------------------------------------- monthly Qloo floor


async def test_qloo_backed_tools_stop_below_the_monthly_floor_and_derived_tools_run():
    from types import SimpleNamespace

    from app.agent.qloo_tools import RESOLVE_ENTITIES
    from app.agent.tools import QLOO_PAUSED, Tool, ToolOutput, run_tool_calls

    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=SEARCH)

    async def derived(args, ctx):
        return ToolOutput(content="ok", summary="worked out")

    registry = {
        "resolve_entities": RESOLVE_ENTITIES,
        "derived": Tool("derived", "", {}, derived, provenance="derived"),
    }
    blocks = [
        SimpleNamespace(id="t1", name="resolve_entities", input={"names": ["x"], "entity_type": ENTITY}),
        SimpleNamespace(id="t2", name="derived", input={}),
    ]
    events = []

    async def emit(event):
        events.append(event)

    qloo = qloo_client(handler)
    ctx = ToolContext(qloo=qloo, qloo_floor=1500)
    qloo.month_remaining = 1499
    sent = await run_tool_calls(blocks, registry, ctx, emit)
    results = [e for e in events if e["type"] == "tool_result"]
    assert [(r["tool"], r["ok"]) for r in results] == [("resolve_entities", False), ("derived", True)]
    assert results[0]["summary"] == "Qloo allowance paused" and results[0]["requests"] == []
    assert sent[0]["is_error"] and sent[0]["content"] == QLOO_PAUSED
    assert (
        QLOO_PAUSED == "Error: Qloo's monthly allowance is nearly used up, so live Qloo requests are paused."
    )
    assert seen == [] and ctx.state["qloo_calls"] == 0

    qloo.month_remaining = 1502  # one search can try up to 3 times: it needs floor + 3
    events.clear()
    await run_tool_calls(blocks[:1], registry, ctx, emit)
    assert next(e for e in events if e["type"] == "tool_result")["ok"] is False and seen == []
    for remaining in (1503, None):  # room for the search's worst case, or not yet known: the tool runs
        qloo.month_remaining = remaining
        events.clear()
        await run_tool_calls(blocks[:1], registry, ctx, emit)
        assert next(e for e in events if e["type"] == "tool_result")["ok"] is True
    assert len(seen) == 1  # the second answer came from the client's cache
    await qloo.aclose()


async def test_qloo_backed_tools_stop_after_six_blind_requests_and_derived_tools_run():
    from types import SimpleNamespace

    from app.agent.qloo_tools import RESOLVE_ENTITIES
    from app.agent.tools import QLOO_PAUSED, Tool, ToolOutput, run_tool_calls

    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=SEARCH)  # never says how many requests are left in the month

    async def derived(args, ctx):
        return ToolOutput(content="ok", summary="worked out")

    registry = {
        "resolve_entities": RESOLVE_ENTITIES,
        "derived": Tool("derived", "", {}, derived, provenance="derived"),
    }
    events = []

    async def emit(event):
        events.append(event)

    def resolve(name: str) -> SimpleNamespace:
        return SimpleNamespace(
            id=name, name="resolve_entities", input={"names": [name], "entity_type": ENTITY}
        )

    qloo = qloo_client(handler)
    ctx = ToolContext(qloo=qloo, qloo_floor=1500)
    for i in range(6):  # six different names, so none is answered from the client's cache
        events.clear()
        await run_tool_calls([resolve(f"act {i}")], registry, ctx, emit)
        assert next(e for e in events if e["type"] == "tool_result")["ok"] is True
    assert len(seen) == 6 and qloo.blind_requests == 6 and qloo.month_remaining is None

    events.clear()
    sent = await run_tool_calls(
        [resolve("act 6"), SimpleNamespace(id="d", name="derived", input={})], registry, ctx, emit
    )
    results = [e for e in events if e["type"] == "tool_result"]
    assert [(r["tool"], r["ok"]) for r in results] == [("resolve_entities", False), ("derived", True)]
    assert results[0]["summary"] == "Qloo allowance paused" and results[0]["requests"] == []
    assert sent[0]["is_error"] and sent[0]["content"] == QLOO_PAUSED
    assert len(seen) == 6 and ctx.state["qloo_calls"] == 6
    await qloo.aclose()


ENTITY = "urn:entity:artist"


def test_the_run_endpoint_applies_the_floor_from_the_settings(tmp_path):
    from tests.test_clash_runs import run, setup

    preset = setup(tmp_path, [])
    a, b = (act["id"] for act in preset["festival"]["acts"][:2])
    script = [[{"tool": "explain_clash", "input": {"act_a": a, "act_b": b}}], [{"text": "Done."}]]
    low = qloo_client()
    low.month_remaining = 1499  # the default floor is 1,500
    app.dependency_overrides[get_backend] = lambda: ScriptedBackend(script)
    app.dependency_overrides[get_qloo] = lambda: low
    try:
        with TestClient(app) as client:
            events = run(client, {"preset_id": "day", "message": "Why do these two clash?"})
    finally:
        app.dependency_overrides.clear()
    result = next(e for e in events if e["type"] == "tool_result")
    assert result["ok"] is False and result["summary"] == "Qloo allowance paused"
    assert events[-1]["qloo_calls"] == 0 and "result" in [e["type"] for e in events]


# ------------------------------------------------------------------------- same-turn ordering


def ordering_tools(log: list[str]):
    """A reader that reports the rules it sees and a writer that records one (after a pause)."""
    import asyncio

    from app.agent.tools import Tool, ToolOutput

    async def read(args, ctx):
        log.append("read")
        return ToolOutput(
            content="rules: " + (", ".join(ctx.state.get("rules", [])) or "none"), summary="read"
        )

    async def write(args, ctx):
        await asyncio.sleep(args.get("pause", 0))
        ctx.state.setdefault("rules", []).append(args["rule"])
        log.append("write " + args["rule"])
        return ToolOutput(content="added " + args["rule"], summary="wrote")

    return {
        "read": Tool("read", "", {}, read, provenance="derived"),
        "write": Tool("write", "", {}, write, provenance="derived", mutates_state=True),
    }


def call(block_id: str, name: str, **input):
    from types import SimpleNamespace

    return SimpleNamespace(id=block_id, name=name, input=input)


async def test_a_same_turn_reader_sees_the_rule_a_writer_adds_later_in_the_turn():
    from app.agent.tools import run_tool_calls

    log, events = [], []

    async def emit(event):
        events.append(event)

    ctx = ToolContext(qloo=qloo_client())
    blocks = [
        call("r1", "read"),
        call("w1", "write", rule="keep A and B apart", pause=0.02),
        call("r2", "read"),
    ]
    sent = await run_tool_calls(blocks, ordering_tools(log), ctx, emit)
    assert [r["tool_use_id"] for r in sent] == ["r1", "w1", "r2"]  # the order of the calls
    assert [r["content"] for r in sent] == [
        "rules: keep A and B apart",
        "added keep A and B apart",
        "rules: keep A and B apart",
    ]
    assert log[0] == "write keep A and B apart"
    assert ctx.state["rules"] == ["keep A and B apart"]


async def test_writers_run_one_after_another_in_the_order_given():
    from app.agent.tools import run_tool_calls

    log = []

    async def emit(event):
        pass

    ctx = ToolContext(qloo=qloo_client())
    blocks = [call("w1", "write", rule="first", pause=0.03), call("w2", "write", rule="second")]
    sent = await run_tool_calls(blocks, ordering_tools(log), ctx, emit)
    assert ctx.state["rules"] == ["first", "second"] and log == ["write first", "write second"]
    assert [r["tool_use_id"] for r in sent] == ["w1", "w2"]


async def test_a_call_past_the_cap_still_gets_its_error_and_the_events_keep_their_shape():
    from app.agent.tools import TOO_MANY_CALLS, run_tool_calls

    log, events = [], []

    async def emit(event):
        events.append(event)

    ctx = ToolContext(qloo=qloo_client())
    blocks = [call("r1", "read"), call("w1", "write", rule="kept"), call("w2", "write", rule="skipped")]
    sent = await run_tool_calls(blocks, ordering_tools(log), ctx, emit, max_calls=2)
    assert [r["tool_use_id"] for r in sent] == ["r1", "w1", "w2"]
    assert sent[2]["is_error"] and sent[2]["content"] == TOO_MANY_CALLS and "is_error" not in sent[0]
    assert ctx.state["rules"] == ["kept"] and sent[0]["content"] == "rules: kept"
    assert {e["type"] for e in events} == {"tool_call", "tool_result"}
    calls = [e for e in events if e["type"] == "tool_call"]
    results = [e for e in events if e["type"] == "tool_result"]
    assert {e["id"] for e in calls} == {e["id"] for e in results} == {"r1", "w1", "w2"}
    assert set(calls[0]) == {"type", "id", "tool", "input", "provenance"}
    assert set(results[0]) == {
        "type",
        "id",
        "tool",
        "ok",
        "summary",
        "latency_ms",
        "provenance",
        "requests",
    }


def test_only_add_constraint_changes_the_run_state():
    from app.agent.clash_tools import CLASH_TOOLS

    assert [t.name for t in CLASH_TOOLS if t.mutates_state] == ["add_constraint"]
    assert not any(t.mutates_state for t in GENERAL_TOOLS)


# ---------------------------------------------------------------- worst-case reservation


def _resolve_block(call_id: str, names: list[str]):
    from types import SimpleNamespace

    return SimpleNamespace(id=call_id, name="resolve_entities", input={"names": names, "entity_type": ENTITY})


async def _run(blocks, ctx, tools=None):
    from app.agent.qloo_tools import RESOLVE_ENTITIES
    from app.agent.tools import run_tool_calls

    events = []

    async def emit(event):
        events.append(event)

    sent = await run_tool_calls(blocks, tools or {"resolve_entities": RESOLVE_ENTITIES}, ctx, emit)
    # in the order the model asked (a refused call finishes first, so the events come in another order)
    results = {e["id"]: e for e in events if e["type"] == "tool_result"}
    return sent, [results[block.id] for block in blocks]


async def test_a_six_name_resolve_at_the_floor_plus_five_is_refused_with_no_requests():
    from app.agent.tools import QLOO_PAUSED

    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=SEARCH)

    qloo = qloo_client(handler)
    ctx = ToolContext(qloo=qloo, qloo_floor=1500)
    qloo.month_remaining = 1505  # six searches can send 18 requests: it needs floor + 18
    names = [f"act {i}" for i in range(6)]
    sent, results = await _run([_resolve_block("t1", names)], ctx)
    assert seen == [] and results[0]["requests"] == [] and results[0]["ok"] is False
    assert sent[0]["content"] == QLOO_PAUSED and qloo._reserved == 0 and ctx.state["qloo_calls"] == 0

    qloo.month_remaining = 1518  # room for the worst case: it runs, and gives the reservation back
    sent, results = await _run([_resolve_block("t2", names)], ctx)
    assert results[0]["ok"] is True and len(seen) == 6
    assert qloo._reserved == 0 and ctx.state["qloo_calls"] == 6
    await qloo.aclose()


async def test_two_concurrent_qloo_tools_at_the_floor_edge_run_one_and_refuse_one():
    qloo = qloo_client()
    ctx = ToolContext(qloo=qloo, qloo_floor=1500)
    qloo.month_remaining = 1503  # room for one search's worst case, not two
    sent, results = await _run([_resolve_block("a", ["x"]), _resolve_block("b", ["y"])], ctx)
    assert [r["ok"] for r in results] == [True, False]
    assert results[1]["requests"] == [] and sent[1]["is_error"]
    assert qloo._reserved == 0 and ctx.state["qloo_calls"] == 1
    await qloo.aclose()


async def test_two_concurrent_qloo_tools_at_the_run_cap_run_one_and_refuse_one():
    from app.agent.tools import QLOO_BUDGET_USED

    qloo = qloo_client()
    ctx = ToolContext(qloo=qloo, qloo_budget=5)  # room for one search's worst case (3), not two
    sent, results = await _run([_resolve_block("a", ["x"]), _resolve_block("b", ["y"])], ctx)
    assert [r["ok"] for r in results] == [True, False]
    assert results[1]["summary"] == "Qloo budget for this run is used up"
    assert sent[1]["content"] == QLOO_BUDGET_USED and results[1]["requests"] == []
    assert ctx.state["qloo_calls"] == 1 and qloo._reserved == 0  # the run is charged what was sent
    await qloo.aclose()


async def test_the_reservation_is_released_after_a_qloo_error_and_a_tool_failure():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "down"})

    qloo = qloo_client(handler)
    ctx = ToolContext(qloo=qloo, qloo_floor=1500, qloo_budget=12)
    qloo.month_remaining = 5000
    _, results = await _run([_resolve_block("a", ["x"])], ctx)
    assert results[0]["ok"] is False and qloo._reserved == 0
    assert ctx.state["qloo_calls"] == len(results[0]["requests"]) == 1

    _, results = await _run([_resolve_block("b", [])], ctx)  # refused input: nothing sent, nothing kept
    assert results[0]["ok"] is False and qloo._reserved == 0 and ctx.state["qloo_calls"] == 1
    await qloo.aclose()


async def test_the_reservation_is_released_when_the_run_is_cancelled_mid_call():
    import asyncio

    started = asyncio.Event()

    async def handler(request: httpx.Request) -> httpx.Response:
        started.set()
        await asyncio.sleep(30)
        return httpx.Response(200, json=SEARCH)

    qloo = qloo_client(handler)
    ctx = ToolContext(qloo=qloo, qloo_floor=1500, qloo_budget=12)
    qloo.month_remaining = 5000
    task = asyncio.create_task(_run([_resolve_block("a", ["x"])], ctx))
    await asyncio.wait_for(started.wait(), 5)
    assert qloo._reserved == 3  # held while the request is out
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    assert task.cancelled() and qloo._reserved == 0 and ctx.state["qloo_calls"] == 0
    await qloo.aclose()


async def test_a_tool_that_needs_more_than_the_run_has_left_is_refused_before_any_request():
    # Twelve names would need 36 requests of a 12-request run; the handler would take them one by one
    qloo = qloo_client()
    ctx = ToolContext(qloo=qloo, qloo_budget=12)
    sent, results = await _run([_resolve_block("a", [f"n{i}" for i in range(6)])], ctx)
    assert results[0]["ok"] is False and results[0]["requests"] == [] and ctx.state["qloo_calls"] == 0
    await qloo.aclose()
