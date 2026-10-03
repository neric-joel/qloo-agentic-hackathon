import json

import httpx
import pytest

from app.agent.clash_tools import (
    ADD_CONSTRAINT,
    CLASH_REPORT,
    EXPLAIN_CLASH,
    FIND_MOVES,
    LIST_TIMETABLE,
    RESLOT,
    TRY_MOVE,
)
from app.agent.tools import ToolContext, ToolInputError
from app.lineups.overlap_matrix import apply_overlap
from app.lineups.timetable import PublishedTimetable, Reach, to_festival
from app.qloo.client import QlooClient
from app.qloo.overlap import OverlapResult, ResolvedAct
from app.schedule.metrics import score_festival
from app.schedule.models import ScoringConfig

TIMETABLE = PublishedTimetable.model_validate(
    {
        "id": "riverbend",
        "name": "Riverbend",
        "days": ["Sat"],
        "stages": [{"id": "main", "name": "Main"}, {"id": "tent", "name": "Tent"}],
        "sets": [
            {"act": "Opener", "stage": "main", "day": "Sat", "start": "14:00", "end": "15:00"},
            {"act": "Indie Star", "stage": "main", "day": "Sat", "start": "17:00", "end": "18:00"},
            {"act": "Headliner", "stage": "main", "day": "Sat", "start": "20:00", "end": "21:30"},
            {"act": "Indie Twin", "stage": "tent", "day": "Sat", "start": "17:15", "end": "18:15"},
            {"act": "Techno Act", "stage": "tent", "day": "Sat", "start": "14:15", "end": "15:15"},
            {"act": "Tent Closer", "stage": "tent", "day": "Sat", "start": "20:00", "end": "21:00"},
        ],
    }
)
INDIE = {"Indie Star", "Indie Twin", "Opener"}


def context(compare_tags=None) -> ToolContext:
    festival = to_festival(TIMETABLE, "Sat", reach=Reach(minutes=240, stages=1))
    names = [a.name for a in festival.acts]
    result = OverlapResult(
        acts=[ResolvedAct(name=n, entity_id=f"id-{n}", popularity=0.9, coverage="strong") for n in names],
        values={a: {b: (0.95 if {a, b} <= INDIE else 0.1) for b in names if b != a} for a in names},
        discriminates=True,
        control_rank=0.1,
    )
    festival, matrix = apply_overlap(festival, result)
    config = ScoringConfig(baseline=score_festival(festival, matrix).baseline)

    def handler(request: httpx.Request) -> httpx.Response:
        tags = compare_tags or [
            {"name": "Indie Rock", "tag_id": "g", "subtype": "urn:tag:genre:music", "query": {"score": 0.9}}
        ]
        return httpx.Response(200, json={"results": {"tags": tags}})

    qloo = QlooClient("k", backoff=0, max_rps=None, transport=httpx.MockTransport(handler))
    return ToolContext(qloo=qloo, state={"festival": festival, "matrix": matrix, "config": config})


async def test_list_and_report():
    ctx = context()
    listed = json.loads((await LIST_TIMETABLE.handler({}, ctx)).content)
    assert len(listed["sets"]) == 6
    assert next(s for s in listed["sets"] if s["name"] == "Headliner")["locked"] is True
    report = json.loads((await CLASH_REPORT.handler({"limit": 3}, ctx)).content)
    assert {report["top_clashes"][0]["a"], report["top_clashes"][0]["b"]} == {"Indie Star", "Indie Twin"}
    assert report["top_clashes"][0]["taste_overlap"] == 0.95


async def test_explain_clash_uses_qloo_compare_and_names():
    out = await EXPLAIN_CLASH.handler({"act_a": "indie star", "act_b": "Indie Twin"}, context())
    data = json.loads(out.content)
    assert data["minutes_overlapping"] == 45
    assert data["qloo_tags_for_pair"] == ["Indie Rock"]
    with pytest.raises(ToolInputError, match="several acts"):
        await EXPLAIN_CLASH.handler({"act_a": "Indie", "act_b": "Opener"}, context())


async def test_try_move_reports_without_changing_the_timetable():
    ctx = context()
    before = ctx.state["festival"]
    out = json.loads(
        (await TRY_MOVE.handler({"act": "Indie Twin", "stage": "Tent", "start": "18:30"}, ctx)).content
    )
    assert out["allowed"] is True
    assert out["clash_budget_after"] < out["clash_budget_before"]
    assert "Indie Star" in out["clashes_before"] and "Indie Star" not in out["clashes_after"]
    assert ctx.state["festival"] is before
    clash = json.loads(
        (await TRY_MOVE.handler({"act": "Indie Twin", "stage": "Tent", "start": "20:30"}, ctx)).content
    )
    assert clash["allowed"] is False and "overlap" in clash["problems"][0]
    with pytest.raises(ToolInputError, match="locked"):
        await TRY_MOVE.handler({"act": "Headliner", "stage": "Tent", "start": "19:00"}, ctx)


async def test_find_moves_lists_legal_priced_places_best_first():
    ctx = context()
    before = ctx.state["festival"]
    out = await FIND_MOVES.handler({"act": "Indie Twin"}, ctx)
    data = json.loads(out.content)
    assert out.data["kind"] == "move_options" and data["movable"] is True
    options = data["options"]
    assert options and data["legal_places"] >= len(options)
    afters = [o["clash_budget_after"] for o in options]
    assert afters == sorted(afters)
    assert afters[0] < data["clash_budget_before"]
    assert ctx.state["festival"] is before
    # Every listed place passes the same check try_move applies.
    for option in options:
        checked = json.loads(
            (
                await TRY_MOVE.handler(
                    {"act": "Indie Twin", "stage": option["stage"], "start": option["start"]}, ctx
                )
            ).content
        )
        assert checked["allowed"] is True
        assert checked["clash_budget_after"] == option["clash_budget_after"]


async def test_find_moves_misses_no_legal_place_a_brute_force_search_finds():
    ctx = context()
    festival = ctx.state["festival"]
    for slot in festival.timetable:
        found = (await FIND_MOVES.handler({"act": slot.act_id, "limit": 8}, ctx)).data
        if not found["movable"]:
            continue
        legal = []
        for stage in festival.stages:
            for start in range(0, 24 * 60, 5):
                if (stage.id, start) == (slot.stage_id, slot.start):
                    continue
                try:
                    out = await TRY_MOVE.handler(
                        {
                            "act": slot.act_id,
                            "stage": stage.id,
                            "start": f"{start // 60:02d}:{start % 60:02d}",
                        },
                        ctx,
                    )
                except ToolInputError:
                    continue
                result = json.loads(out.content)
                if result["allowed"]:
                    legal.append(result["clash_budget_after"])
        assert found["legal_places"] >= len(legal)
        if legal:
            assert found["options"][0]["clash_budget_after"] <= min(legal)


async def test_find_moves_respects_locks_and_limits():
    ctx = context()
    locked = await FIND_MOVES.handler({"act": "Headliner"}, ctx)
    assert locked.data["movable"] is False and locked.data["options"] == []
    assert "locked" in locked.summary
    one = json.loads((await FIND_MOVES.handler({"act": "Indie Twin", "limit": 1}, ctx)).content)
    assert len(one["options"]) == 1
    with pytest.raises(ToolInputError, match="limit"):
        await FIND_MOVES.handler({"act": "Indie Twin", "limit": 50}, ctx)


async def test_slot_taken_refusal_is_reported_as_data():
    out = await TRY_MOVE.handler({"act": "Indie Twin", "stage": "Tent", "start": "20:30"}, context())
    assert out.data["kind"] == "what_if" and out.data["allowed"] is False


async def test_constraints_change_the_working_festival_and_bind_the_reslot():
    ctx = context()
    await ADD_CONSTRAINT.handler({"kind": "lock", "act": "Indie Twin", "time": "", "other_act": ""}, ctx)
    await ADD_CONSTRAINT.handler(
        {"kind": "not_after", "act": "Indie Star", "time": "17:00", "other_act": ""}, ctx
    )
    out = json.loads(
        (await RESLOT.handler({"objective": 1, "move_budget": 4, "compare_without_qloo": True}, ctx)).content
    )
    moved = {m["act"] for m in out.get("moves", [])}
    assert "Indie Twin" not in moved
    assert ctx.state["constraints"] == [
        "Indie Twin stays exactly where it is",
        "Indie Star starts no later than 17:00",
    ]
    assert "without_qloo" in out


async def test_bad_inputs_go_back_to_the_model():
    ctx = context()
    with pytest.raises(ToolInputError, match="kind must be"):
        await ADD_CONSTRAINT.handler({"kind": "teleport", "act": "Opener", "time": "", "other_act": ""}, ctx)
    with pytest.raises(ToolInputError, match="HH:MM|time like"):
        await ADD_CONSTRAINT.handler(
            {"kind": "not_before", "act": "Opener", "time": "soon", "other_act": ""}, ctx
        )
    with pytest.raises(ToolInputError, match="move_budget"):
        await RESLOT.handler({"objective": 1, "move_budget": 99, "compare_without_qloo": False}, ctx)
    with pytest.raises(ToolInputError, match="No act"):
        await TRY_MOVE.handler({"act": "Nobody", "stage": "Main", "start": "12:00"}, ctx)
