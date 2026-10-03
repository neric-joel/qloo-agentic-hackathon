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
    assert report["top_clashes"][0]["taste_overlap_out_of_100"] == 95


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
    assert (
        "Indie Star" in out["clash_index_points_before"]
        and "Indie Star" not in out["clash_index_points_after"]
    )
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
                result = out.data  # engine values, not the rounded view the model reads
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
    out = json.loads((await RESLOT.handler({"objective": 1, "move_budget": 4}, ctx)).content)
    moved = {m["act"] for m in out.get("moves", [])}
    assert "Indie Twin" not in moved
    assert ctx.state["constraints"] == [
        "Indie Twin stays exactly where it is",
        "Indie Star starts no later than 17:00",
    ]
    assert "without_qloo" not in out


async def test_bad_inputs_go_back_to_the_model():
    ctx = context()
    with pytest.raises(ToolInputError, match="kind must be"):
        await ADD_CONSTRAINT.handler({"kind": "teleport", "act": "Opener", "time": "", "other_act": ""}, ctx)
    with pytest.raises(ToolInputError, match="HH:MM|time like"):
        await ADD_CONSTRAINT.handler(
            {"kind": "not_before", "act": "Opener", "time": "soon", "other_act": ""}, ctx
        )
    with pytest.raises(ToolInputError, match="move_budget"):
        await RESLOT.handler({"objective": 1, "move_budget": 99}, ctx)
    with pytest.raises(ToolInputError, match="No act"):
        await TRY_MOVE.handler({"act": "Nobody", "stage": "Main", "start": "12:00"}, ctx)


# ------------------------------------------------------------------------- what the model reads


def decimals(value: float) -> int:
    text = repr(value)
    return len(text.split(".")[1]) if "." in text else 0


async def test_content_gives_taste_overlap_and_draw_out_of_100_and_data_keeps_the_engine_units():
    ctx = context()
    report = json.loads((await CLASH_REPORT.handler({"limit": 5}, ctx)).content)
    for row in report["top_clashes"]:
        assert {"taste_overlap", "draw", "share_of_total_cost"}.isdisjoint(row)
        for key in ("taste_overlap_out_of_100", "draw_out_of_100", "share_of_day_cost_percent"):
            assert isinstance(row[key], int) and 0 <= row[key] <= 100
    assert decimals(report["clash_budget_index"]) <= 1

    listed = json.loads((await LIST_TIMETABLE.handler({}, ctx)).content)
    assert all("draw" not in row and isinstance(row["draw_out_of_100"], int) for row in listed["sets"])

    out = await EXPLAIN_CLASH.handler({"act_a": "Indie Star", "act_b": "Indie Twin"}, ctx)
    content = json.loads(out.content)
    assert content["taste_overlap_out_of_100"] == 95 and "taste_overlap" not in content
    assert content["a"]["draw_out_of_100"] == 90 and "draw" not in content["a"]
    assert content["qloo_tags_for_pair"] == ["Indie Rock"] and "tags" not in content  # no raw Qloo scores
    # The web app's card still reads the engine's units
    assert out.data["taste_overlap"] == 0.95 and out.data["a"]["draw"] == 0.9
    assert out.data["tags"][0]["score"] == 0.9 and out.data["qloo_tags_for_pair"] == ["Indie Rock"]


async def test_an_act_without_qloo_signal_is_explained_as_unpriced():
    ctx = context()
    matrix = ctx.state["matrix"]
    tent_closer = next(a.id for a in ctx.state["festival"].acts if a.name == "Tent Closer")
    ctx.state["matrix"] = matrix.model_copy(update={"coverage": {tent_closer: "none"}})
    out = await EXPLAIN_CLASH.handler({"act_a": "Tent Closer", "act_b": "Headliner"}, ctx)
    content = json.loads(out.content)
    assert content["taste_overlap_out_of_100"] is None and "not priced" in content["note"]
    assert out.data is None and out.summary == "No Qloo signal for one act"


async def test_budgets_the_model_reads_have_one_decimal():
    ctx = context()
    moves = await FIND_MOVES.handler({"act": "Indie Twin"}, ctx)
    content = json.loads(moves.content)
    assert decimals(content["clash_budget_before"]) <= 1
    assert all(decimals(o["clash_budget_after"]) <= 1 for o in content["options"])
    assert [round(o["clash_budget_after"], 1) for o in moves.data["options"]] == [
        o["clash_budget_after"] for o in content["options"]
    ]
    assert "->" in moves.summary and all(
        decimals(float(x)) <= 1 for x in moves.summary.split("best ")[1].split(" -> ")
    )

    what_if = await TRY_MOVE.handler({"act": "Indie Twin", "stage": "Tent", "start": "18:30"}, ctx)
    content = json.loads(what_if.content)
    assert decimals(content["clash_budget_before"]) <= 1 and decimals(content["clash_budget_after"]) <= 1
    assert "clashes_before" not in content and "clashes_after" not in content
    points = [*content["clash_index_points_before"].values(), *content["clash_index_points_after"].values()]
    assert points and all(decimals(v) <= 1 and v >= 1 for v in points)
    assert content["clash_budget_after"] == round(what_if.data["clash_budget_after"], 1)
    assert (
        what_if.data["clash_budget_after"]
        == score_festival(  # the card's value is the engine's
            ctx.state["festival"].model_copy(
                update={
                    "timetable": [
                        s.model_copy(update={"start": 1110, "end": 1170}) if s.act_id == "indie-twin" else s
                        for s in ctx.state["festival"].timetable
                    ]
                }
            ),
            ctx.state["matrix"],
            ctx.state["config"],
        ).metrics.clash_budget_index
    )

    reslot = json.loads((await RESLOT.handler({"objective": 1, "move_budget": 4}, ctx)).content)
    assert decimals(reslot["clash_budget_before"]) <= 1 and decimals(reslot["clash_budget_after"]) <= 1


def test_reslot_offers_no_comparison_without_qloo():
    assert "compare_without_qloo" not in json.dumps(RESLOT.to_api())
    assert RESLOT.input_schema["required"] == ["objective", "move_budget"]


async def test_a_rule_never_loosens_a_bound_the_set_already_has():
    ctx = context()
    await ADD_CONSTRAINT.handler(
        {"kind": "not_after", "act": "Opener", "time": "15:00", "other_act": ""}, ctx
    )
    out = await ADD_CONSTRAINT.handler(
        {"kind": "not_after", "act": "Opener", "time": "18:00", "other_act": ""}, ctx
    )
    content = json.loads(out.content)
    slot = next(s for s in ctx.state["festival"].timetable if s.act_id == "opener")
    assert slot.not_after == 15 * 60
    assert content["added"] == "Opener starts no later than 15:00"
    assert "stricter" in content["kept_stricter_bound"]
    tighter = json.loads(
        (
            await ADD_CONSTRAINT.handler(
                {"kind": "not_after", "act": "Opener", "time": "14:30", "other_act": ""}, ctx
            )
        ).content
    )
    assert "kept_stricter_bound" not in tighter and tighter["added"] == "Opener starts no later than 14:30"


async def test_the_reslot_message_the_model_reads_describes_the_plan_it_was_handed():
    from app.schedule.synthetic import synthetic_festival

    festival, matrix = synthetic_festival(5, days=1, acts=12)
    config = ScoringConfig(baseline=score_festival(festival, matrix).baseline)
    state = {"festival": festival, "matrix": matrix, "config": config}
    ctx = ToolContext(qloo=QlooClient(None), state=state)
    out = await RESLOT.handler({"objective": 1, "move_budget": 2}, ctx)  # the best option moves more sets
    content = json.loads(out.content)
    summary = out.data["summary"]
    assert len(content["moves"]) == 2
    assert content["message"] == (
        f"This plan moves 2 sets and takes the Clash Budget from {content['clash_budget_before']:.1f} "
        f"to {content['clash_budget_after']:.1f}."
    )
    assert "options lower" not in content["message"] and "largest clash-cost drop" not in content["message"]
    # What the web reads keeps the optimizer's own text and the engine's numbers
    assert summary["message"] == out.data["report"]["message"] and "options lower" in summary["message"]
    assert summary["clash_budget_after"] == out.data["report"]["options"][1]["metrics"]["clash_budget_index"]

    one = json.loads(
        (
            await RESLOT.handler(
                {"objective": 1, "move_budget": 1}, ToolContext(qloo=QlooClient(None), state=dict(state))
            )
        ).content
    )
    assert one["message"].startswith("This plan moves 1 set and takes the Clash Budget from ")


async def test_the_no_gain_reslot_message_is_unchanged():
    ctx = context()
    for slot in ctx.state["festival"].timetable:
        await ADD_CONSTRAINT.handler({"kind": "lock", "act": slot.act_id, "time": "", "other_act": ""}, ctx)
    out = await RESLOT.handler({"objective": 1, "move_budget": 4}, ctx)
    content = json.loads(out.content)
    assert "moves" not in content and not content["message"].startswith("This plan")
    assert content["message"] == out.data["summary"]["message"] == out.data["report"]["message"]
