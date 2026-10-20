"""Recorded agent runs are served per preset, untouched, and only when they are complete clean clash runs;
``scripts/record_runs.py`` saves only runs that pass its gates.

Every recording here is synthetic, built in code: no Qloo response data and no real run. Nothing here calls
the model or Qloo; the plan checks that read the real presets skip when they are not built.
"""

import importlib.util
import inspect
import json
import logging
import sys
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.agent.clash_tools import ADD_CONSTRAINT, FIND_MOVES, TRY_MOVE
from app.agent.llm import ScriptedBackend
from app.agent.tools import ToolContext
from app.config import Settings, get_settings
from app.main import app
from app.presets import get_presets
from app.recordings import MAX_RUN_BYTES, Recording, load_recordings
from app.runs import ClashInput, RunRequest, clash_state, execute_run
from app.schedule.metrics import score_festival
from app.schedule.models import BaselineStats, ScoringConfig
from tests.test_agent import qloo_client
from tests.test_presets import write_preset

REQUEST_ID = "00000000-test-0000-0000-000000000000"


def events(*, finished: bool = True, error: bool = False, results: int = 1, pad: int = 0) -> list[dict]:
    """A synthetic clash run: started, one Qloo-backed tool call, streamed text, a result and the finish."""
    timed = [
        (0, {"type": "run_started", "run_id": "run_test", "mode": "live"}),
        (
            900,
            {"type": "tool_call", "id": "tu_1", "tool": "explain_clash", "input": {}, "provenance": "qloo"},
        ),
        (
            1450,
            {
                "type": "tool_result",
                "id": "tu_1",
                "tool": "explain_clash",
                "ok": True,
                "summary": "A / B: taste overlap 92/100",
                "latency_ms": 550,
                "provenance": "qloo",
                "requests": [
                    {
                        "path": "/v2/analysis/compare",
                        "params": {"take": "50"},
                        "status": 200,
                        "latency_ms": 540,
                        "cached": False,
                        "recorded": False,
                        "request_id": REQUEST_ID,
                    }
                ],
            },
        ),
        (2000, {"type": "text_delta", "text": "They clash because " + "x" * pad}),
    ]
    if error:
        timed.append((2100, {"type": "error", "message": "Something went wrong.", "retryable": True}))
    timed += [(2200, {"type": "result", "kind": "clash", "data": {"text": "ok", "tool_data": {}}})] * results
    if finished:
        timed.append((2300, {"type": "run_finished", "run_id": "run_test", "usage": None, "qloo_calls": 1}))
    return [{"t": t, "event": event} for t, event in timed]


def run(run_id: str, **kwargs) -> dict:
    return {
        "id": run_id,
        "title": "Explain a clash",
        "question": "Why do A and B clash?",
        "captured_at": "2026-10-04T14:02:11Z",
        "model": "test-model",
        "events": events(**kwargs),
    }


def write_recordings(directory, preset_id: str, runs: list[dict]) -> None:
    directory.mkdir(exist_ok=True)
    body = {"preset_id": preset_id, "runs": runs}
    (directory / f"{preset_id}.json").write_text(json.dumps(body), encoding="utf-8")


@pytest.fixture
def served(tmp_path):
    write_preset(tmp_path, "a-day", "A Day")
    write_preset(tmp_path, "b-day", "B Day")
    recordings = tmp_path / "recordings"
    recordings.mkdir()
    app.dependency_overrides[get_settings] = lambda: Settings(
        presets_dir=tmp_path, recordings_dir=recordings, _env_file=None
    )
    yield recordings
    app.dependency_overrides.clear()


def get_runs(preset_id: str):
    with TestClient(app) as client:
        return client.get(f"/api/presets/{preset_id}/recordings")


def test_a_valid_recording_is_served_in_order_with_its_request_id(served):
    good = run("hidden-clash")
    write_recordings(served, "a-day", [good])
    response = get_runs("a-day")
    assert response.status_code == 200
    assert response.headers["cache-control"].startswith("public, s-maxage=")
    runs = response.json()["runs"]
    # untouched apart from the model id: same fields, same events, same order
    assert runs == [{key: value for key, value in good.items() if key != "model"}]
    result = next(e["event"] for e in runs[0]["events"] if e["event"]["type"] == "tool_result")
    assert result["requests"][0]["request_id"] == REQUEST_ID and result["requests"][0]["cached"] is False


def test_unknown_preset_is_404_and_a_preset_without_recordings_is_empty(served):
    write_recordings(served, "a-day", [run("one")])
    missing = get_runs("missing")
    assert missing.status_code == 404 and missing.json()["detail"] == "No preset 'missing'."
    empty = get_runs("b-day")
    assert empty.status_code == 200 and empty.json() == {"runs": []}
    assert empty.headers["cache-control"].startswith("public, s-maxage=")


def test_no_recordings_directory_means_no_runs(tmp_path):
    write_preset(tmp_path, "a-day", "A Day")
    app.dependency_overrides[get_settings] = lambda: Settings(
        presets_dir=tmp_path, recordings_dir=tmp_path / "absent", _env_file=None
    )
    try:
        assert get_runs("a-day").json() == {"runs": []}
    finally:
        app.dependency_overrides.clear()


def test_the_served_runs_never_name_the_model_that_wrote_them(served):
    write_recordings(served, "a-day", [run("one"), run("two")])
    response = get_runs("a-day")
    assert response.status_code == 200
    assert [r["id"] for r in response.json()["runs"]] == ["one", "two"]
    assert all("model" not in r for r in response.json()["runs"])
    assert "test-model" not in response.text
    assert Recording.model_validate(run("one")).model == "test-model"  # the saved file still keeps it


def backwards() -> dict:
    out = run("backwards")
    out["events"][2] = {**out["events"][2], "t": 100}  # earlier than the tool call before it
    return out


def test_invalid_runs_are_skipped_and_the_others_still_served(served, caplog):
    write_recordings(
        served,
        "a-day",
        [
            run("no-finish", finished=False),
            run("good-one"),
            run("has-error", error=True),
            run("two-results", results=2),
            run("too-big", pad=MAX_RUN_BYTES),
            run("good-two"),
        ],
    )
    write_recordings(
        served,
        "b-day",
        [backwards(), run("kept"), run("kept"), {**run("bad-id"), "id": "Not An Id!"}],
    )
    with caplog.at_level(logging.WARNING, logger="app.recordings"):
        a_day, b_day = get_runs("a-day"), get_runs("b-day")
    assert a_day.status_code == 200 and b_day.status_code == 200
    assert [r["id"] for r in a_day.json()["runs"]] == ["good-one", "good-two"]
    assert [r["id"] for r in b_day.json()["runs"]] == ["kept"]  # a repeated id is served once
    for reason in ("run_finished", "error event", "exactly one result", "KB", "backwards", "duplicate id"):
        assert reason in caplog.text
    assert "a-day.json" in caplog.text and "b-day.json" in caplog.text


@pytest.mark.parametrize(
    "content",
    [
        "{not json",
        "[]",
        json.dumps({"preset_id": "other-day", "runs": []}),
        json.dumps({"preset_id": "a-day", "runs": [{"id": "x"}] * 7}),
        b"\xff\xfe\x00 not utf-8",
    ],
    ids=["corrupt", "not-an-object", "wrong-preset", "too-many-runs", "not-utf8"],
)
def test_an_unreadable_file_is_skipped_never_a_500(served, content, caplog):
    path = served / "a-day.json"
    if isinstance(content, bytes):
        path.write_bytes(content)
    else:
        path.write_text(content, encoding="utf-8")
    write_recordings(served, "b-day", [run("still-here")])
    with caplog.at_level(logging.WARNING, logger="app.recordings"):
        broken = get_runs("a-day")
        fine = get_runs("b-day")
    assert broken.status_code == 200 and broken.json() == {"runs": []}
    assert [r["id"] for r in fine.json()["runs"]] == ["still-here"]
    assert "a-day.json" in caplog.text


def test_loader_reads_each_file_once(tmp_path):
    write_recordings(tmp_path, "a-day", [run("one")])
    first = load_recordings(str(tmp_path))
    write_recordings(tmp_path, "a-day", [run("one"), run("two")])
    assert load_recordings(str(tmp_path)) is first  # cached: recordings change only on redeploy
    assert [r.id for r in first["a-day"]] == ["one"]


# ---------------------------------------------------------------- scripts/record_runs.py: plan, gates, files

BACKEND = Path(__file__).resolve().parents[1]
PRESETS = BACKEND / "presets"
PRESET_IDS = ("glastonbury-2025-sun", "riot-fest-2026-sun")
needs_presets = pytest.mark.skipif(
    not all((PRESETS / f"{preset_id}.json").is_file() for preset_id in PRESET_IDS),
    reason="the real presets are not built in this checkout",
)


def model_words(model: str) -> list[str]:
    """The words of a model id ("vendor-family-version" -> vendor, family), each long enough to search for."""
    return [part for part in model.replace("_", "-").replace(".", "-").split("-") if len(part) >= 3]


@needs_presets
@pytest.mark.parametrize("preset_id", PRESET_IDS)
def test_the_shipped_recordings_are_served_without_any_model_or_vendor_name(preset_id):
    """The saved files keep which model wrote a run; the response has no model key and none of its words."""
    saved = PRESETS / "recordings" / f"{preset_id}.json"
    if not saved.is_file():
        pytest.skip("no recordings saved for this day in this checkout")
    raw = json.loads(saved.read_text(encoding="utf-8"))
    words = {word.casefold() for r in raw["runs"] for word in model_words(str(r.get("model") or ""))}
    app.dependency_overrides[get_settings] = lambda: Settings(
        presets_dir=PRESETS, recordings_dir=PRESETS / "recordings", _env_file=None
    )
    try:
        with TestClient(app) as client:
            response = client.get(f"/api/presets/{preset_id}/recordings")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    runs = response.json()["runs"]
    assert runs, "the saved runs are served"
    assert all("model" not in r for r in runs)
    body = response.text.casefold()
    assert words and not [word for word in sorted(words) if word in body]


def load_script():
    spec = importlib.util.spec_from_file_location("record_runs", BACKEND / "scripts" / "record_runs.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


record_runs = load_script()

EXPLAIN = {
    "a": {"name": "A", "slot": "Main 12:30-13:30", "draw_out_of_100": 81},
    "b": {"name": "B", "slot": "Tent 12:30-13:15", "draw_out_of_100": 70},
    "minutes_overlapping": 45,
    "taste_overlap_out_of_100": 92,
    "qloo_tags_for_pair": ["Indie Rock"],
}
LIVE = {
    "path": "/v2/analysis/compare",
    "params": {"take": "50"},
    "status": 200,
    "latency_ms": 300,
    "cached": False,
    "recorded": False,
    "request_id": REQUEST_ID,
}
ANSWER = "A and B overlap for 45 minutes, with taste overlap 92 out of 100."
EXPLAINED = (("explain_clash", EXPLAIN, [LIVE]),)


def plan_entry(expects: str = "clean"):
    return record_runs.PlanEntry(
        "a-run", "a-day", "A run", "Why do A and B clash at 12:30?", expects, ("A", "B")
    )


def gate_run(answer=ANSWER, calls=EXPLAINED, *, error=False, session=None):
    """Bare events of a synthetic clash run, and the content the model read from each tool call (compact
    JSON, as the tools send it, or error text)."""
    events = [{"type": "run_started", "run_id": "run_test", "mode": "live"}]
    contents = {}
    for i, (tool, content, requests) in enumerate(calls):
        events += [
            {"type": "tool_call", "id": f"tu_{i}", "tool": tool, "input": {}, "provenance": "derived"},
            {
                "type": "tool_result",
                "id": f"tu_{i}",
                "tool": tool,
                "ok": True,
                "summary": f"{tool} done",
                "latency_ms": 5,
                "provenance": "derived",
                "requests": requests,
            },
        ]
        contents[f"tu_{i}"] = (
            content if isinstance(content, str) else json.dumps(content, separators=(",", ":"))
        )
    events.append({"type": "text_delta", "text": answer})
    if error:
        events.append({"type": "error", "message": "Something went wrong.", "retryable": True})
    data = {"text": answer, "tool_data": {}} | ({"session": session} if session else {})
    usage = {"input_tokens": 9000, "output_tokens": 400}
    events += [
        {"type": "result", "kind": "clash", "data": data},
        {"type": "run_finished", "run_id": "run_test", "usage": usage, "qloo_calls": 1, "elapsed_ms": 1500},
    ]
    return events, contents


def failures_of(entry, answer=ANSWER, calls=EXPLAINED, **kwargs) -> list[str]:
    events, contents = gate_run(answer, calls, **kwargs)
    return record_runs.gate_failures(events, entry, contents)


def test_a_clean_run_passes_every_gate():
    assert failures_of(plan_entry()) == []


@pytest.mark.parametrize("answer", ["Their taste overlap is 0.92.", "A draws 0.81 against B at 0.7."])
def test_a_taste_overlap_or_draw_written_as_a_decimal_fails(answer):
    content = {**EXPLAIN, "taste_overlap": 0.92, "draws": [0.81, 0.7]}  # grounded, still not in page units
    failures = failures_of(plan_entry(), answer, (("explain_clash", content, [LIVE]),))
    assert failures == ["writes a decimal below 1 (taste overlap and draw are whole numbers out of 100)"]


def test_an_error_event_or_an_incomplete_or_slow_run_fails():
    assert failures_of(plan_entry(), error=True) == ["error event: Something went wrong."]
    events, contents = gate_run()
    assert any("incomplete" in f for f in record_runs.gate_failures(events[:-1], plan_entry(), contents))
    slow = [*events[:-1], {**events[-1], "elapsed_ms": record_runs.MAX_ELAPSED_MS + 1}]
    assert record_runs.gate_failures(slow, plan_entry(), contents) == ["took 40001 ms (at most 40000)"]


def test_a_number_no_tool_returned_fails():
    failures = failures_of(plan_entry(), "A and B overlap for 50 minutes, taste overlap 92 out of 100.")
    assert failures == ["numbers in the answer that nothing the model read backs: ['50']"]


def test_numbers_from_tools_the_question_and_the_prompt_are_grounded():
    moves = {"clash_budget_before": 116.7, "options": [{"start": "20:45", "clash_budget_after": 114.83}]}
    answer = (
        "At 12:30 they overlap for 45 minutes. Moving B to 8:45pm takes the Clash Budget Index from 116.7 "
        "to 114.8 on Glastonbury 2025."
    )
    events, contents = gate_run(answer, (*EXPLAINED, ("find_moves", moves, [])))
    assert record_runs.gate_failures(events, plan_entry(), contents, "Festival day: Glastonbury 2025.") == []
    assert record_runs.gate_failures(events, plan_entry(), contents) == [
        "numbers in the answer that nothing the model read backs: ['2025']"
    ]


@pytest.mark.parametrize(
    "answer",
    [
        "By Qloo's own measure this clash is costly.",
        "Moving B improves the day.",
        "That is a bigger improvement.",
        "They draw the same fans.",
        "Big crowds would be torn.",
    ],
)
def test_overclaiming_wording_fails(answer):
    failures = failures_of(plan_entry(), answer)
    assert len(failures) == 1 and failures[0].startswith("overclaiming wording")


def test_overclaiming_wording_in_a_tool_summary_fails():
    events, contents = gate_run()
    events[2] = {**events[2], "summary": "Splits the crowd"}
    assert record_runs.gate_failures(events, plan_entry(), contents)[0].startswith("overclaiming wording")


def test_expects_live_qloo_needs_a_live_request_with_its_id():
    entry = plan_entry("live_qloo")
    missing = ["expected a live Qloo request with a request id"]
    assert failures_of(entry) == []
    for request in ({**LIVE, "cached": True}, {**LIVE, "recorded": True}, {**LIVE, "request_id": None}):
        assert failures_of(entry, calls=(("explain_clash", EXPLAIN, [request]),)) == missing
    assert failures_of(entry, calls=(("explain_clash", EXPLAIN, []),)) == missing


def test_expects_abstain_needs_explain_clash_without_a_taste_overlap():
    entry = plan_entry("abstain")
    unpriced = {key: value for key, value in EXPLAIN.items() if key != "qloo_tags_for_pair"}
    unpriced |= {"taste_overlap_out_of_100": None, "note": "Qloo has no usable audience signal."}
    answer = "Qloo has no signal for A, so this 45-minute clash cannot be priced."
    assert failures_of(entry, answer, (("explain_clash", unpriced, []),)) == []
    missing = ["expected explain_clash to report no Qloo signal (taste overlap null)"]
    assert failures_of(entry) == missing  # priced
    assert failures_of(entry, "No signal.", (("explain_clash", "Error: No act called 'Z'.", []),)) == missing
    assert failures_of(entry, answer, (("try_move", unpriced, []),)) == missing  # not from explain_clash


def test_expects_refusal_needs_a_try_move_the_rules_refuse():
    entry = plan_entry("refusal")
    refused = {"move": "A -> Main 15:30", "allowed": False, "problems": ["That slot is taken."]}
    answer = "No: Main is taken at 15:30."
    assert failures_of(entry, answer, (("try_move", refused, []),)) == []
    allowed = {**refused, "allowed": True, "problems": []}
    assert failures_of(entry, answer, (("try_move", allowed, []),)) == [
        "expected a try_move the rules refuse (allowed false)"
    ]


def test_expects_rules_needs_two_recorded_rules_and_a_keep_apart():
    entry = plan_entry("rules")
    rules = ["A stays exactly where it is", "A and B must not overlap"]
    session = {"timetable": [], "constraints": {"no_clash_with": [["a", "b"]]}, "rules": rules}
    assert failures_of(entry, session=session) == []
    assert failures_of(entry, session={**session, "rules": rules[:1]}) == [
        "expected at least 2 recorded rules, got 1"
    ]
    assert failures_of(entry, session={**session, "constraints": {"no_clash_with": []}}) == [
        "expected a keep-apart rule in the session"
    ]


def test_merge_replaces_the_same_id_in_place_and_keeps_the_others():
    existing = {"preset_id": "a-day", "runs": [{"id": "one", "title": "old"}, {"id": "two", "title": "kept"}]}
    merged = record_runs.merge_runs(existing, "a-day", [{"id": "one", "title": "new"}, {"id": "three"}])
    assert merged == {
        "preset_id": "a-day",
        "runs": [{"id": "one", "title": "new"}, {"id": "two", "title": "kept"}, {"id": "three"}],
    }
    assert existing["runs"][0]["title"] == "old"  # the input is not changed
    assert record_runs.merge_runs(None, "a-day", [{"id": "one"}]) == {
        "preset_id": "a-day",
        "runs": [{"id": "one"}],
    }


def test_saved_runs_merge_by_id_into_a_file_the_endpoint_serves(served):
    record_runs.save_run(served, "a-day", run("one"))
    record_runs.save_run(served, "a-day", run("two"))
    record_runs.save_run(served, "a-day", {**run("one"), "title": "Retaken"})
    runs = get_runs("a-day").json()["runs"]
    assert [(r["id"], r["title"]) for r in runs] == [("one", "Retaken"), ("two", "Explain a clash")]
    assert not list(served.glob("*.partial"))


def test_an_output_file_the_merge_would_break_stops_the_plan(tmp_path):
    entries = [record_runs.PlanEntry(f"run-{i}", "a-day", "T", "Q?", "clean", ()) for i in range(7)]
    assert record_runs.check_out(tmp_path, entries[:6]) == ["a-day.json: 0 runs now, 6 after"]
    with pytest.raises(record_runs.PlanError, match="would hold 7 runs"):
        record_runs.check_out(tmp_path, entries)
    (tmp_path / "a-day.json").write_text("{not json", encoding="utf-8")
    with pytest.raises(record_runs.PlanError, match="cannot be read"):
        record_runs.check_out(tmp_path, entries[:1])
    (tmp_path / "a-day.json").write_text(json.dumps({"preset_id": "b-day", "runs": []}), encoding="utf-8")
    with pytest.raises(record_runs.PlanError, match="not a recordings file"):
        record_runs.save_run(tmp_path, "a-day", run("one"))


def test_the_cost_estimate_uses_the_list_price_and_stops_before_the_limit():
    assert record_runs.estimate_cost({"input_tokens": 1_000_000, "output_tokens": 0}) == 2.0
    assert record_runs.estimate_cost({"input_tokens": 0, "output_tokens": 100_000}) == 1.0
    assert record_runs.estimate_cost({"input_tokens": 20_000, "output_tokens": 1_000}) == pytest.approx(0.05)
    assert record_runs.estimate_cost(None) == 0 == record_runs.estimate_cost({})
    assert record_runs.can_afford([], 0.30) and record_runs.can_afford([0.05, 0.10], 0.30)
    assert not record_runs.can_afford([0.10, 0.12], 0.30)  # 0.22 spent and the next may cost 0.12


def test_run_caps_pass_every_cap_execute_run_takes_from_the_settings():
    settings = Settings(
        _env_file=None,
        agent_max_turns=5,
        agent_max_tool_calls_per_turn=4,
        agent_max_qloo_calls_per_run=12,
        agent_max_reslots_per_run=1,
        agent_max_engine_seconds=7.5,
        qloo_quota_floor=1500,
    )
    caps = record_runs.run_caps(settings, qloo_left=10)
    takes = {
        name for name, p in inspect.signature(execute_run).parameters.items() if p.kind is p.KEYWORD_ONLY
    }
    assert set(caps) == takes
    assert caps == {
        "max_turns": 5,
        "max_tool_calls": 4,
        "max_qloo_calls": record_runs.MAX_QLOO_PER_RUN,
        "max_reslots": 1,
        "max_engine_seconds": 7.5,
        "qloo_floor": 1500,
    }
    assert record_runs.run_caps(settings, qloo_left=2)["max_qloo_calls"] == 2
    tighter = settings.model_copy(update={"agent_max_qloo_calls_per_run": 1})
    assert record_runs.run_caps(tighter, qloo_left=10)["max_qloo_calls"] == 1


def test_without_a_model_configured_it_exits_with_the_message(tmp_path, monkeypatch):
    def never(*args, **kwargs):
        raise AssertionError("nothing may run without a model")

    monkeypatch.setattr(record_runs, "get_settings", lambda: Settings(_env_file=None, llm_provider="none"))
    monkeypatch.setattr(record_runs, "QlooClient", never)
    monkeypatch.setattr(record_runs, "execute_run", never)
    with pytest.raises(SystemExit) as stop:
        record_runs.run(["--only", "no-qloo-signal", "--out", str(tmp_path)])
    assert stop.value.code == "The LLM is not configured: set LLM_PROVIDER and a key in backend/.env"


async def test_a_scripted_run_is_recorded_whole_and_passes_the_gates(tmp_path):
    write_preset(tmp_path, "a-day", "A Day")
    presets = get_presets(Settings(presets_dir=tmp_path, _env_file=None))
    preset = presets["a-day"]
    config = ScoringConfig(baseline=BaselineStats.model_validate(preset.report["baseline"]))
    budget = round(score_festival(preset.festival, preset.matrix, config).metrics.clash_budget_index, 1)
    script = [
        [{"text": "Scoring the day. "}, {"tool": "clash_report", "input": {"limit": 3}}],
        [{"text": f"The Clash Budget Index is {budget}."}],
    ]
    entry = record_runs.PlanEntry(
        "scripted", "a-day", "Score the day", "How costly is this day?", "clean", ()
    )
    [(_, request)] = record_runs.build_requests([entry], presets)
    qloo = qloo_client()
    try:
        caps = record_runs.run_caps(Settings(_env_file=None), qloo_left=4)
        outcome = await record_runs.record_one(entry, request, ScriptedBackend(script), qloo, presets, caps)
    finally:
        await qloo.aclose()
    assert outcome["failures"] == []
    assert outcome["answer"] == f"The Clash Budget Index is {budget}."
    timed = outcome["timed"]
    assert [e["event"]["type"] for e in timed] == [
        "run_started",
        "text_delta",
        "tool_call",
        "tool_result",
        "text_delta",
        "result",
        "run_finished",
    ]
    Recording.model_validate(record_runs.to_recording(entry, timed, "scripted", datetime.now(UTC)))


@needs_presets
def test_the_plan_builds_five_valid_run_requests_on_the_real_presets():
    presets = get_presets(Settings(presets_dir=PRESETS, _env_file=None))
    planned = record_runs.build_requests(record_runs.PLAN, presets)
    assert len(planned) == 5 and len({entry.id for entry, _ in planned}) == 5
    assert {entry.expects for entry, _ in planned} == {"live_qloo", "rules", "refusal", "abstain", "clean"}
    for entry, request in planned:
        assert isinstance(request, RunRequest) and request.scenario == "clash"
        assert isinstance(request.input, ClashInput) and request.input.preset_id == entry.preset_id
        assert request.input.message == entry.question
        # What will be saved fits the recordings contract (id, title and question limits)
        Recording.model_validate(record_runs.to_recording(entry, events(), "test-model", datetime.now(UTC)))


@needs_presets
def test_a_dry_run_prints_the_plan_and_calls_nothing(tmp_path, monkeypatch, capsys):
    def never(*args, **kwargs):
        raise AssertionError("a dry run must not build a model backend or a Qloo client, or read the .env")

    for name in ("build_backend", "QlooClient", "get_settings", "execute_run"):
        monkeypatch.setattr(record_runs, name, never)
    monkeypatch.setattr(httpx.AsyncClient, "send", never)
    out = tmp_path / "recordings"
    assert record_runs.run(["--all", "--dry-run", "--out", str(out)]) == 0
    printed = capsys.readouterr().out
    assert all(entry.id in printed and entry.question in printed for entry in record_runs.PLAN)
    assert not out.exists()  # nothing written


@needs_presets
async def test_each_plan_question_can_pass_its_gate_on_the_real_presets():
    """Engine and tool handlers only, as the PLAN comments say: no model, and Qloo is never reached."""
    presets = get_presets(Settings(presets_dir=PRESETS, _env_file=None))
    plan = {entry.id: entry for entry in record_runs.PLAN}

    def unreachable(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no Qloo request in an offline check")

    def session(preset_id: str) -> ToolContext:
        state = clash_state(presets[preset_id], ClashInput(preset_id=preset_id, message="x"))
        return ToolContext(qloo=qloo_client(unreachable), state=state)

    def minutes_concurrent(ctx: ToolContext, a: str, b: str) -> int:
        festival = ctx.state["festival"]
        ids = {act.name: act.id for act in festival.acts}
        slots = {slot.act_id: slot for slot in festival.timetable}
        sa, sb = slots[ids[a]], slots[ids[b]]
        return max(0, min(sa.end, sb.end) - max(sa.start, sb.start)) if sa.stage_id != sb.stage_id else 0

    async def content(tool, args: dict, ctx: ToolContext) -> dict:
        return json.loads((await tool.handler(args, ctx)).content)

    glastonbury, rules = session("glastonbury-2025-sun"), session("glastonbury-2025-sun")
    riot = session("riot-fest-2026-sun")
    try:
        a, b = plan["hidden-clash-and-move"].acts
        assert minutes_concurrent(glastonbury, a, b) > 0
        assert (await content(FIND_MOVES, {"act": b}, glastonbury))["legal_places"] >= 1

        (act,) = plan["engine-says-no"].acts
        move = await content(TRY_MOVE, {"act": act, "stage": "Other", "start": "15:30"}, glastonbury)
        assert move["allowed"] is False

        a, b = plan["no-qloo-signal"].acts
        assert minutes_concurrent(glastonbury, a, b) > 0
        ids = {act.name: act.id for act in glastonbury.state["festival"].acts}
        assert glastonbury.state["matrix"].coverage_of(ids[a]) == "none"

        keep, also_keep, act, apart = plan["rules-then-move"].acts
        assert minutes_concurrent(rules, act, apart) == 0  # a keep-apart it already breaks would freeze it
        for args in (
            {"kind": "lock", "act": keep, "time": "", "other_act": ""},
            {"kind": "lock", "act": also_keep, "time": "", "other_act": ""},
            {"kind": "keep_apart", "act": act, "time": "", "other_act": apart},
        ):
            await ADD_CONSTRAINT.handler(args, rules)
        assert len(rules.state["constraints"]) == 3 and rules.state["festival"].constraints.no_clash_with
        moves = await content(FIND_MOVES, {"act": act}, rules)
        assert moves["movable"] is True and moves["legal_places"] >= 1

        a, b = plan["riot-fest-move"].acts
        assert minutes_concurrent(riot, a, b) > 0
        assert (await content(FIND_MOVES, {"act": b}, riot))["legal_places"] >= 1
    finally:
        for ctx in (glastonbury, rules, riot):
            await ctx.qloo.aclose()
