import json
import re

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
    IllegalStep,
    PlanGroup,
    PlanMove,
    all_pairs,
    apply_plan,
    compute_move_options,
    index_points,
)
from app.agent.tools import ToolContext, ToolInputError
from app.lineups.overlap_matrix import apply_overlap
from app.lineups.timetable import PublishedTimetable, Reach, to_festival
from app.qloo.client import QlooClient
from app.qloo.overlap import OverlapResult, ResolvedAct
from app.schedule.metrics import score_festival
from app.schedule.models import ScoringConfig, parse_minutes
from app.schedule.synthetic import synthetic_festival

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
    assert "random valid timetables of this lineup" in report["index_meaning"]
    assert "re-orderings" not in report["index_meaning"]


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
    assert content["taste_overlap_out_of_100"] is None and "not scored" in content["note"]
    assert content["note"] == (
        "Qloo has no usable audience signal for one of these acts, so the clash is not scored."
    )
    assert out.data is None and out.summary == "No Qloo signal for one act"


def test_the_tool_descriptions_say_scored_not_priced():
    assert "lists the places that break no rule, each scored with the Clash Budget after the move" in (
        " ".join(FIND_MOVES.description.split())
    )
    for tool in (LIST_TIMETABLE, CLASH_REPORT, EXPLAIN_CLASH, FIND_MOVES, TRY_MOVE, ADD_CONSTRAINT, RESLOT):
        assert not re.search(r"\bpric(e|ed|es|ing)\b", tool.description, re.IGNORECASE), tool.name


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


# ------------------------------------------------------------- a set's clashes among all the day's pairs

TRY_MOVE_DATA_KEYS = {
    "kind",
    "move",
    "allowed",
    "problems",
    "clash_budget_before",
    "clash_budget_after",
    "clashes_before",
    "clashes_after",
}


def wide_day():
    """A synthetic day with more scored clashes than the 15 the day's report ranks."""
    festival, matrix = synthetic_festival(7, days=1, acts=20)
    config = ScoringConfig(baseline=score_festival(festival, matrix).baseline)
    return festival, matrix, config


def moved_to(festival, act_id: str, option: dict):
    start = parse_minutes(option["start"])
    place = {"day": option["day"], "stage_id": option["stage_id"], "start": start}
    timetable = [
        s.model_copy(update={**place, "end": start + s.duration}) if s.act_id == act_id else s
        for s in festival.timetable
    ]
    return festival.model_copy(update={"timetable": timetable})


def as_pairs(partners: list[dict]) -> list[tuple[str, float]]:
    return [(p["with"], p["points"]) for p in partners]


def involving(report, act_id: str) -> dict[str, float]:
    """``try_move``'s data before this change: the act's clashes among the day's ranked clashes."""
    return {
        (c.b.name if c.a.act_id == act_id else c.a.name): round(c.regret_share * report.metrics.regret, 4)
        for c in report.clashes
        if act_id in (c.a.act_id, c.b.act_id)
    }


def test_partner_lists_come_from_every_pair_not_only_the_days_15_costliest():
    festival, matrix, config = wide_day()
    ranked = score_festival(festival, matrix, config)
    every = score_festival(festival, matrix, all_pairs(config))
    assert len(ranked.clashes) == 15 < len(every.clashes)
    below_now = below_after = empty_before = 0
    for slot in festival.timetable:
        data = compute_move_options(festival, matrix, config, slot.act_id, 12, partners=True)
        if not data["movable"]:
            continue
        assert as_pairs(data["clashes_now"]) == index_points(every, slot.act_id)[:3]
        top_15 = [name for name, _ in index_points(ranked, slot.act_id)[:3]]
        below_now += any(p["with"] not in top_15 for p in data["clashes_now"])
        for option in data["options"]:
            trial = moved_to(festival, slot.act_id, option)
            every_after = index_points(score_festival(trial, matrix, all_pairs(config)), slot.act_id)
            assert as_pairs(option["clashes_after"]) == every_after[:3]
            old = [name for name, _ in index_points(score_festival(trial, matrix, config), slot.act_id)[:3]]
            below_after += any(p["with"] not in old for p in option["clashes_after"])
            empty_before += not old and bool(option["clashes_after"])
    # Partners ranked below 15 now appear, and places whose list used to print empty now list their clashes
    assert below_now and below_after and empty_before


def test_ranking_every_pair_changes_no_budget_order_or_place():
    festival, matrix, config = wide_day()
    for slot in festival.timetable:
        wide = compute_move_options(festival, matrix, config, slot.act_id, 12, partners=True)
        plain = compute_move_options(festival, matrix, config, slot.act_id, 12)
        assert wide["movable"] == plain["movable"]
        if not plain["movable"]:
            continue
        assert wide["legal_places"] == plain["legal_places"]
        assert wide["clash_budget_before"] == plain["clash_budget_before"]
        assert [(o["move"], o["clash_budget_after"]) for o in wide["options"]] == [
            (o["move"], o["clash_budget_after"]) for o in plain["options"]
        ]


async def test_find_moves_data_is_the_plain_search_unchanged():
    festival, matrix, config = wide_day()
    ctx = ToolContext(qloo=QlooClient(None), state={"festival": festival, "matrix": matrix, "config": config})
    for slot in festival.timetable:
        data = (await FIND_MOVES.handler({"act": slot.act_id, "limit": 8}, ctx)).data
        plain = compute_move_options(festival, matrix, config, slot.act_id, 8)
        assert data == {"kind": "move_options", **plain}
        assert "priced" not in data and "clashes_now" not in data


async def test_try_move_tells_the_model_every_clash_and_keeps_its_data():
    festival, matrix, config = wide_day()
    ctx = ToolContext(qloo=QlooClient(None), state={"festival": festival, "matrix": matrix, "config": config})
    ranked_before = score_festival(festival, matrix, config)
    checked = 0
    for slot in festival.timetable:
        data = compute_move_options(festival, matrix, config, slot.act_id, 12, partners=True)
        for option in data["options"]:
            trial = moved_to(festival, slot.act_id, option)
            ranked_after = score_festival(trial, matrix, config)
            old = dict(index_points(ranked_after, slot.act_id))
            below = [p["with"] for p in option["clashes_after"] if p["with"] not in old]
            if not below:
                continue
            out = await TRY_MOVE.handler(
                {"act": slot.act_id, "stage": option["stage_id"], "start": option["start"]}, ctx
            )
            content = json.loads(out.content)
            every_after = index_points(score_festival(trial, matrix, all_pairs(config)), slot.act_id)
            assert content["clash_index_points_after"] == dict(every_after)
            assert below[0] in content["clash_index_points_after"]
            # The data the web's card reads is what it was: the day's 15 ranked clashes, in engine units
            assert set(out.data) == TRY_MOVE_DATA_KEYS
            assert below[0] not in out.data["clashes_after"]
            assert out.data["clashes_before"] == involving(ranked_before, slot.act_id)
            assert out.data["clashes_after"] == involving(ranked_after, slot.act_id)
            assert out.data["clash_budget_after"] == ranked_after.metrics.clash_budget_index
            checked += 1
            break
    assert checked


def test_priced_says_whether_the_act_has_a_usable_qloo_signal():
    festival, matrix, config = wide_day()
    locked = next(s.act_id for s in festival.timetable if s.locked)
    unpriced_seen = 0
    for slot in festival.timetable:
        data = compute_move_options(festival, matrix, config, slot.act_id, 12, partners=True)
        assert data["priced"] is (matrix.coverage_of(slot.act_id) != "none")
        if not data["priced"]:  # an unpriced set's places all leave the budget where it was
            unpriced_seen += 1
            assert data["movable"] and data["options"] and data["clashes_now"] == []
            assert {o["clash_budget_after"] for o in data["options"]} == {data["clash_budget_before"]}
            assert all(o["clashes_after"] == [] for o in data["options"])
    assert unpriced_seen
    assert compute_move_options(festival, matrix, config, locked, 8, partners=True)["priced"] is True
    unpriced = matrix.model_copy(update={"coverage": {**matrix.coverage, locked: "none"}})
    frozen = compute_move_options(festival, unpriced, config, locked, 8, partners=True)
    assert frozen["movable"] is False and frozen["priced"] is False
    assert "priced" not in compute_move_options(festival, unpriced, config, locked, 8)


# ----------------------------------------------------------------------------------- stacked moves


def test_a_plan_prices_each_kept_move_on_the_timetable_the_earlier_ones_left():
    festival, matrix, config = wide_day()
    published = score_festival(festival, matrix, config)
    empty = apply_plan(festival, matrix, config, [])
    assert empty.steps == () and empty.report.metrics == published.metrics
    assert empty.budget_before == published.metrics.clash_budget_index
    current, kept = festival, []
    for act_id in [s.act_id for s in festival.timetable if not s.locked][:3]:
        option = compute_move_options(current, matrix, config, act_id, 1, partners=True)["options"][0]
        kept.append(PlanMove(act_id, option["stage_id"], option["day"], parse_minutes(option["start"])))
        current = moved_to(current, act_id, option)
        plan = apply_plan(festival, matrix, config, kept)
        assert plan.steps[-1].budget_after == option["clash_budget_after"]
        assert plan.steps[-1].move == option["move"]
        assert plan.festival.timetable == current.timetable
        assert plan.report.metrics == score_festival(current, matrix, config).metrics
        assert plan.budget_before == published.metrics.clash_budget_index
    assert festival.timetable == wide_day()[0].timetable  # nothing is kept on the published day


def test_an_illegal_step_names_its_number():
    festival, matrix, config = wide_day()
    movable = [s for s in festival.timetable if not s.locked]
    first = compute_move_options(festival, matrix, config, movable[0].act_id, 1, partners=True)["options"][0]
    step_one = PlanMove(movable[0].act_id, first["stage_id"], 0, parse_minutes(first["start"]))
    locked = next(s for s in festival.timetable if s.locked)
    other = movable[1]
    taken = next(s for s in movable[2:] if s.stage_id != other.stage_id)
    for bad in (
        PlanMove(locked.act_id, locked.stage_id, 0, locked.start + 60),  # a locked set
        PlanMove("nobody", other.stage_id, 0, other.start + 30),  # not on the day
        PlanMove(other.act_id, "nowhere", 0, other.start),  # no such stage
        PlanMove(other.act_id, other.stage_id, 0, other.start),  # where it already is
        PlanMove(other.act_id, taken.stage_id, 0, taken.start),  # a taken slot
        PlanMove(other.act_id, other.stage_id, 1, other.start),  # another day
    ):
        with pytest.raises(IllegalStep) as refused:
            apply_plan(festival, matrix, config, [step_one, bad])
        assert refused.value.step == 2


def test_a_rule_step_of_one_move_prices_a_listed_place_as_the_plain_step_does():
    festival, matrix, config = wide_day()
    movable = [s.act_id for s in festival.timetable if not s.locked]
    for act_id in movable[:4]:
        for option in compute_move_options(festival, matrix, config, act_id, 3, partners=True)["options"]:
            move = PlanMove(act_id, option["stage_id"], option["day"], parse_minutes(option["start"]))
            plain = apply_plan(festival, matrix, config, [move])
            rule = apply_plan(festival, matrix, config, [PlanGroup((move,), (act_id, movable[-1]))])
            (step,) = rule.steps
            assert step.budget_after == plain.steps[0].budget_after == option["clash_budget_after"]
            assert step.moves[0].move == plain.steps[0].move == option["move"]
            assert rule.festival.timetable == plain.festival.timetable
            assert rule.report.metrics == plain.report.metrics and rule.new_breaks == 0
    assert plain.new_breaks == 0  # a plan of plain moves never reads the published day's issues


def test_a_rule_step_names_its_own_number_when_it_is_illegal():
    festival, matrix, config = wide_day()
    movable = [s for s in festival.timetable if not s.locked]
    locked = next(s for s in festival.timetable if s.locked)
    first = compute_move_options(festival, matrix, config, movable[0].act_id, 1, partners=True)["options"][0]
    step_one = PlanMove(movable[0].act_id, first["stage_id"], 0, parse_minutes(first["start"]))
    other = movable[1]
    taken = next(s for s in movable[2:] if s.stage_id != other.stage_id)
    for bad in (
        PlanGroup((PlanMove(locked.act_id, locked.stage_id, 0, locked.start + 60),), ("a", "b")),
        PlanGroup((PlanMove(other.act_id, other.stage_id, 0, other.start),), ("a", "b")),  # where it is
        PlanGroup((PlanMove(other.act_id, taken.stage_id, 0, taken.start),), ("a", "b")),  # a taken slot
        PlanGroup((PlanMove(other.act_id, other.stage_id, 9, other.start + 5),), ("a", "b")),  # no day 9
    ):
        with pytest.raises(IllegalStep) as refused:
            apply_plan(festival, matrix, config, [step_one, bad])
        assert refused.value.step == 2


# ------------------------------------------------------------------- a rule added over an overlap


APART = {"kind": "keep_apart", "act": "Indie Star", "time": "", "other_act": "Indie Twin"}
BREAK_TEXT = "Indie Star and Indie Twin play at the same time, which their riders forbid"
BREAK_NOTE = "The current timetable breaks this rule; find_moves lists the places that end the break: "
BREAK_NOTE += BREAK_TEXT


def overlap_of(festival, a: str, b: str) -> int:
    slots = {s.act_id: s for s in festival.timetable}
    return max(0, min(slots[a].end, slots[b].end) - max(slots[a].start, slots[b].start))


def apart_in(slots: dict, a: str, b: str) -> bool:
    """Whether two sets (as dicts or slots, keyed by act id) share no minute."""

    def get(slot, name):
        return slot[name] if isinstance(slot, dict) else getattr(slot, name)

    x, y = slots[a], slots[b]
    if get(x, "day") != get(y, "day"):
        return True
    return min(get(x, "end"), get(y, "end")) <= max(get(x, "start"), get(y, "start"))


async def pin(ctx, act: str, at: str) -> None:
    """Rules that leave a set one place only: its own stage, its own start."""
    await ADD_CONSTRAINT.handler({"kind": "keep_stage", "act": act, "time": "", "other_act": ""}, ctx)
    for kind in ("not_before", "not_after"):
        await ADD_CONSTRAINT.handler({"kind": kind, "act": act, "time": at, "other_act": ""}, ctx)


async def try_at(ctx, act: str, stage: str, start: str) -> dict:
    return json.loads((await TRY_MOVE.handler({"act": act, "stage": stage, "start": start}, ctx)).content)


async def test_the_add_constraint_note_says_find_moves_lists_the_places_that_end_the_break():
    ctx = context()
    out = json.loads((await ADD_CONSTRAINT.handler(APART, ctx)).content)
    assert out["note"] == BREAK_NOTE
    assert "re-slot must" not in out["note"]
    other = {"kind": "keep_apart", "act": "Opener", "time": "", "other_act": "Headliner"}
    assert "note" not in json.loads((await ADD_CONSTRAINT.handler(other, ctx)).content)  # nothing breaks it


async def test_a_rule_over_an_overlap_then_find_moves_try_move_and_reslot_all_end_the_break():
    ctx = context()
    assert overlap_of(ctx.state["festival"], "indie-star", "indie-twin") > 0
    await ADD_CONSTRAINT.handler(APART, ctx)
    festival = ctx.state["festival"]

    found = await FIND_MOVES.handler({"act": "Indie Star", "limit": 8}, ctx)
    assert found.data["movable"] is True and found.data["options"]
    view = json.loads(found.content)
    assert view["note"] == "Every place listed ends the break." and view["breaks_now"] == [BREAK_TEXT]
    # Every listed place leaves the two apart, and the same place tried one move at a time agrees
    slots = {s.act_id: s for s in festival.timetable}
    for option in found.data["options"]:
        start = parse_minutes(option["start"])
        stage = next(s.id for s in festival.stages if s.name == option["stage"])
        placed = slots["indie-star"].model_copy(
            update={"stage_id": stage, "start": start, "end": start + slots["indie-star"].duration}
        )
        assert apart_in({"indie-star": placed, "indie-twin": slots["indie-twin"]}, "indie-star", "indie-twin")
        tried = await try_at(ctx, "Indie Star", option["stage"], option["start"])
        assert tried["allowed"] is True and tried["problems"] == [] and tried["ends_the_break"] is True
    listed = {(o["stage"], o["start"]) for o in found.data["options"]}
    assert found.data["legal_places"] >= len(found.data["options"])

    # A place that keeps the overlap is neither listed nor allowed
    keeps = await try_at(ctx, "Indie Star", "Main", "17:05")
    assert ("Main", "17:05") not in listed
    assert keeps["allowed"] is False and keeps["ends_the_break"] is False
    assert any("riders forbid" in p for p in keeps["problems"])

    # reslot may move either act, and the plan it hands back ends the break
    out = await RESLOT.handler({"objective": 1, "move_budget": 4}, ctx)
    plan = json.loads(out.content)
    assert plan["rule_breaks_now"] == [BREAK_TEXT] and plan["rule_breaks_after_plan"] == []
    assert "note" not in plan
    assert {m["act"] for m in plan["moves"]} & {"Indie Star", "Indie Twin"}
    option = next(o for o in out.data["report"]["options"] if o["kind"] == "balanced")
    final = {s["act_id"]: s for s in option["timetable"]}
    assert apart_in(final, "indie-star", "indie-twin")
    assert ctx.state["festival"] is festival  # a re-slot proposes; it never changes the session


async def test_when_no_place_ends_the_break_the_tools_say_so_plainly():
    ctx = context()
    await ADD_CONSTRAINT.handler(APART, ctx)
    await pin(ctx, "Indie Star", "17:00")
    await pin(ctx, "Indie Twin", "17:15")

    for act in ("Indie Star", "Indie Twin"):
        found = await FIND_MOVES.handler({"act": act}, ctx)
        view = json.loads(found.content)
        assert found.data["options"] == [] and found.data["legal_places"] == 0
        assert "no legal place" in found.summary
        assert (
            view["note"] == "No place for this set ends the break, so moving it alone cannot meet the rule."
        )
        assert view["breaks_now"] == [BREAK_TEXT]

    # Nothing the pins allow ends it: try_move never calls such a move allowed
    for stage, start in (("Tent", "19:00"), ("Main", "17:00"), ("Main", "17:05")):
        out = await try_at(ctx, "Indie Star", stage, start)
        assert out["allowed"] is False and out["problems"]

    plan = json.loads((await RESLOT.handler({"objective": 1, "move_budget": 4}, ctx)).content)
    assert plan["rule_breaks_now"] == plan["rule_breaks_after_plan"] == [BREAK_TEXT]
    assert plan["note"] == (
        "This search found no plan that ends these rule breaks (it moves scored sets only and keeps only "
        "moves that lower the index); say so, name them, and say a person may still find a legal change: "
        + BREAK_TEXT
    )


async def test_a_locked_set_in_a_broken_rule_still_cannot_move_but_its_partner_can():
    ctx = context()
    await ADD_CONSTRAINT.handler({"kind": "lock", "act": "Indie Twin", "time": "", "other_act": ""}, ctx)
    await ADD_CONSTRAINT.handler(APART, ctx)
    locked = await FIND_MOVES.handler({"act": "Indie Twin"}, ctx)
    assert locked.data["movable"] is False and locked.data["why"] == "locked in place"
    with pytest.raises(ToolInputError, match="locked"):
        await TRY_MOVE.handler({"act": "Indie Twin", "stage": "Tent", "start": "19:00"}, ctx)
    assert (await FIND_MOVES.handler({"act": "Indie Star", "limit": 8}, ctx)).data["options"]
    plan = json.loads((await RESLOT.handler({"objective": 1, "move_budget": 4}, ctx)).content)
    moved = {m["act"] for m in plan["moves"]}
    assert "Indie Star" in moved and "Indie Twin" not in moved
    assert plan["rule_breaks_after_plan"] == []


async def test_without_thaw_a_standing_break_freezes_both_sets_as_the_public_routes_do():
    ctx = context()
    await ADD_CONSTRAINT.handler(APART, ctx)
    festival, matrix, config = ctx.state["festival"], ctx.state["matrix"], ctx.state["config"]
    plain = compute_move_options(festival, matrix, config, "indie-star", 8)
    assert plain["movable"] is False and plain["options"] == []
    assert "already breaks" in plain["why"]
    thawed = compute_move_options(festival, matrix, config, "indie-star", 8, thaw=True)
    assert thawed["movable"] is True and thawed["options"]

    ends = [PlanMove("indie-star", "main", 0, 15 * 60 + 15)]
    with pytest.raises(IllegalStep):
        apply_plan(festival, matrix, config, ends)
    result = apply_plan(festival, matrix, config, ends, thaw=True)
    assert result.steps[0].start == 15 * 60 + 15
    assert overlap_of(result.festival, "indie-star", "indie-twin") == 0
    # A place that keeps the overlap is not a legal step even when thawed
    with pytest.raises(IllegalStep):
        apply_plan(festival, matrix, config, [PlanMove("indie-star", "main", 0, 17 * 60 + 5)], thaw=True)


def test_on_a_day_with_no_break_thaw_changes_neither_places_nor_numbers():
    festival, matrix = synthetic_festival(7, days=1, acts=20)
    config = ScoringConfig(baseline=score_festival(festival, matrix).baseline)
    for slot in festival.timetable[:6]:
        plain = compute_move_options(festival, matrix, config, slot.act_id, 8, partners=True)
        thawed = compute_move_options(festival, matrix, config, slot.act_id, 8, partners=True, thaw=True)
        assert thawed == plain


async def test_a_same_turn_search_honours_a_rule_added_later_in_the_turn():
    from types import SimpleNamespace

    from app.agent.clash_tools import CLASH_TOOLS
    from app.agent.tools import run_tool_calls

    ctx = context()
    registry = {tool.name: tool for tool in CLASH_TOOLS}
    blocks = [
        SimpleNamespace(id="t1", name="find_moves", input={"act": "Indie Star", "limit": 8}),
        SimpleNamespace(id="t2", name="add_constraint", input=APART),
    ]

    async def emit(event):
        pass

    sent = await run_tool_calls(blocks, registry, ctx, emit)
    assert [r["tool_use_id"] for r in sent] == ["t1", "t2"]
    found = json.loads(sent[0]["content"])
    assert found["note"] == "Every place listed ends the break." and found["options"]
    assert json.loads(sent[1]["content"])["note"] == BREAK_NOTE
    assert ctx.state["tool_data"]["t1"]["movable"] is True
    # On the published day (no rule yet) the same search carries no break note
    plain = json.loads((await FIND_MOVES.handler({"act": "Indie Star", "limit": 8}, context())).content)
    assert "note" not in plain
