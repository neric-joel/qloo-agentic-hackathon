"""Parity between the browser-only check page and the engine's own rule checks.

``web/src/lib/fixtures/check-vectors.json`` holds synthetic days (invented names and times, no Qloo data)
with the counts the page reports per rule. The web test runs them through ``web/src/lib/check.ts``. This
test builds the same grids as ``Festival`` objects and asserts the same counts for changeover, curfew and
keep-apart through ``Layout.issues()``, and the same number of sets that share time through
``Layout.concurrent_pairs()``. Two rules are the page's own because the engine will not hold such a day at
all: an act on two stages at once and two sets overlapping on one stage. For those vectors ``Festival``
validation rejects the grid, which is the stated difference (the page reports it, the engine refuses it).
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from app.schedule.layout import Layout
from app.schedule.models import Act, Constraints, Festival, SetSlot, Stage

VECTORS_PATH = Path(__file__).resolve().parents[2] / "web" / "src" / "lib" / "fixtures" / "check-vectors.json"
VECTORS = json.loads(VECTORS_PATH.read_text(encoding="utf-8"))
ENGINE_VECTORS = [v for v in VECTORS if v["expected"]["engine"] == "accepts"]
REJECTED_VECTORS = [v for v in VECTORS if v["expected"]["engine"] == "rejects"]

DAY_STARTS_AT = 360  # times before 06:00 read as after midnight, as on the page


def _key(value: str) -> str:
    """The page compares names after trimming, collapsing spaces and lower-casing."""
    return re.sub(r"\s+", " ", value.strip()).lower()


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", _key(value)).strip("-")


def _clock(value: str) -> int:
    hours, minutes = value.strip().split(":")
    return int(hours) * 60 + int(minutes)


def _curfew(value: str, starts: list[int]) -> int | None:
    """Before 06:00 means after midnight, unless every set starts before 06:00 (early-only grid)."""
    if value.strip() == "":
        return None
    minutes = _clock(value)
    if minutes >= DAY_STARTS_AT or all(start < DAY_STARTS_AT for start in starts):
        return minutes
    return minutes + 1440


def build_festival(vector: dict, placements: list[tuple[str, int, int]] | None = None) -> Festival:
    """The vector's grid as a one-day Festival, with the page's settings as the engine's constraints.

    ``placements`` replaces each row's (stage name, start, end), in row order: the page's trial moves.
    """
    acts: dict[str, str] = {}
    stages: dict[str, str] = {}
    slots = []
    for k, ((act, stage, _start, _end), (start, end)) in enumerate(
        zip(vector["rows"], vector["resolved"], strict=True)
    ):
        if placements is not None:
            stage, start, end = placements[k]
        act_id = _slug(act)
        stage_id = _slug(stage)
        acts.setdefault(act_id, act.strip())
        stages.setdefault(stage_id, stage.strip())
        slots.append(SetSlot(act_id=act_id, day=0, stage_id=stage_id, start=start, end=end))
    settings = vector["settings"]
    curfew = _curfew(settings["curfew"], [start for start, _end in vector["resolved"]])
    constraints = Constraints(
        changeover_minutes=int(settings["changeover"]),
        curfew={} if curfew is None else {0: curfew},
        no_clash_with=[(_slug(a), _slug(b)) for a, b in settings["pairs"]],
    )
    return Festival(
        id="check-parity",
        name="Check parity",
        days=1,
        stages=[Stage(id=stage_id, name=name) for stage_id, name in stages.items()],
        acts=[Act(id=act_id, name=name) for act_id, name in acts.items()],
        timetable=slots,
        constraints=constraints,
    )


def test_there_are_enough_vectors() -> None:
    assert len(VECTORS) >= 8
    assert len(ENGINE_VECTORS) >= 6
    assert len(REJECTED_VECTORS) >= 2


@pytest.mark.parametrize("vector", ENGINE_VECTORS, ids=lambda v: v["name"])
def test_engine_counts_match_the_page(vector: dict) -> None:
    festival = build_festival(vector)
    layout = Layout.from_festival(festival)
    issues = layout.issues()
    kinds = [issue[0] for issue in issues]
    expected = vector["expected"]

    assert kinds.count("gap") == expected["changeover"]
    assert kinds.count("curfew") == expected["curfew"]
    assert kinds.count("no_clash") == expected["keep_apart"]
    # Nothing else is in play on these days (no hours, billing or stage rules were set).
    assert set(kinds) <= {"gap", "curfew", "no_clash"}
    assert expected["double_booked"] == 0
    assert expected["same_stage"] == 0
    assert len(layout.concurrent_pairs()) == expected["shared_pairs"]


@pytest.mark.parametrize("vector", REJECTED_VECTORS, ids=lambda v: v["name"])
def test_validation_rejects_what_the_page_reports(vector: dict) -> None:
    expected = vector["expected"]
    # The page reports these as rule breaks; the engine refuses to hold the day at all.
    assert expected["double_booked"] + expected["same_stage"] >= 1
    with pytest.raises(ValidationError, match=re.escape(expected["engine_error"])):
        build_festival(vector)


def test_the_two_rejection_kinds_are_both_covered() -> None:
    reasons = {v["expected"]["engine_error"] for v in REJECTED_VECTORS}
    assert "more than one set" in reasons  # an act on two stages at once
    assert "overlap on stage" in reasons  # two sets on one stage at the same time


def test_early_only_grids_are_in_the_vectors() -> None:
    names = {v["name"] for v in ENGINE_VECTORS}
    assert {"early_only_curfew_breaks", "early_only_curfew_end_exact", "early_only_two_stages"} <= names


def test_the_vectors_use_invented_names_only() -> None:
    """A guard against pasting a real lineup into a fixture: every name is a short placeholder."""
    for vector in VECTORS:
        for act, stage, _start, _end in vector["rows"]:
            assert len(act) <= 20 and len(stage) <= 20


# --- "Find a change": the page's trial, judged by the engine -------------------------------------------
#
# ``trials`` on a vector records the first change the page's search lists for one target (a rule break, or
# a pair that shares time) as plain moves, or ``null`` when the search found none. For each recorded
# change the engine must agree that the targeted break is gone and that no issue appears that was not
# there before. For each ``null`` the engine is searched the same way, from scratch, and must find no
# change either (this oracle builds a whole ``Festival`` per candidate and lets validation refuse stage
# overlaps and acts on two stages, which the page counts as new rule breaks).

STEP = 5  # the page's 5-minute grid


def _issues(festival: Festival) -> tuple[Layout, set[tuple]]:
    layout = Layout.from_festival(festival)
    return layout, set(layout.issues())


def _target_issue(target: dict) -> tuple | None:
    """The engine's issue for a rule-break target (rows are the page's 1-based grid lines)."""
    rows = target["rows"]
    rule = target["rule"]
    if rule == 3:
        return ("gap", rows[0] - 1, rows[1] - 1)
    if rule == 4:
        return ("curfew", rows[0] - 1)
    if rule == 5:
        return ("no_clash", min(rows) - 1, max(rows) - 1)
    return None  # rules 1 and 2 are refused by the engine's own validation


def _size(layout: Layout, issue: tuple) -> int:
    """How large an issue is: minutes shared, the changeover shortfall, or minutes past the curfew."""
    kind = issue[0]
    if kind == "no_clash":
        return layout.shared_minutes(issue[1], issue[2])
    if kind == "gap":
        return layout.rules.changeover - (layout.start[issue[2]] - layout.end(issue[1]))
    assert kind == "curfew"
    return layout.end(issue[1]) - layout.rules.curfew[0]


def _placements(vector: dict, moves: list[dict]) -> list[tuple[str, int, int]]:
    placed = [
        (row[1], start, end) for row, (start, end) in zip(vector["rows"], vector["resolved"], strict=True)
    ]
    for move in moves:
        placed[move["row"] - 1] = (move["stage"], move["start"], move["end"])
    return placed


def _judge(vector: dict, target: dict, moves: list[dict]) -> tuple[bool, Layout | None]:
    """Whether the engine agrees the change ends the target and adds no issue (False if it refuses)."""
    before_layout, before = _issues(build_festival(vector))
    try:
        after_layout, after = _issues(build_festival(vector, _placements(vector, moves)))
    except ValidationError:
        return False, None
    if after - before:
        return False, after_layout
    # A break that was already there may not get larger either (the page's own, stricter, reading).
    if any(_size(after_layout, issue) > _size(before_layout, issue) for issue in after):
        return False, after_layout
    if target["kind"] == "shared":
        a, b = target["rows"]
        return after_layout.shared_minutes(a - 1, b - 1) == 0, after_layout
    issue = _target_issue(target)
    assert issue in before
    return issue not in after, after_layout


TRIAL_VECTORS = [v for v in ENGINE_VECTORS if v.get("trials")]
RECORDED = [(v, t) for v in TRIAL_VECTORS for t in v["trials"] if t["change"] is not None]
NONE_FOUND = [(v, t) for v in TRIAL_VECTORS for t in v["trials"] if t["change"] is None]


def _id(pair: tuple[dict, dict]) -> str:
    vector, trial = pair
    return f"{vector['name']}-{trial['target']['kind']}-{'-'.join(str(r) for r in trial['target']['rows'])}"


def test_trial_vectors_cover_each_kind() -> None:
    kinds = {("shared" if t["target"]["kind"] == "shared" else t["target"]["rule"]) for _v, t in RECORDED}
    assert {3, 4, 5, "shared"} <= kinds
    assert any(len(t["change"]["moves"]) == 2 for _v, t in RECORDED)
    assert len(NONE_FOUND) >= 3


@pytest.mark.parametrize(("vector", "trial"), RECORDED, ids=[_id(p) for p in RECORDED])
def test_engine_agrees_with_the_changes_the_page_lists(vector: dict, trial: dict) -> None:
    change: dict[str, Any] = trial["change"]
    ok, layout = _judge(vector, trial["target"], change["moves"])
    assert ok, "the engine disagrees with the page: the targeted break remains or an issue is new"
    assert layout is not None
    # Nothing moved outside the day's span, and every set keeps its length.
    span_start = min(start for start, _end in vector["resolved"])
    span_end = max(end for _start, end in vector["resolved"])
    for move in change["moves"]:
        start, end = vector["resolved"][move["row"] - 1]
        assert move["end"] - move["start"] == end - start
        assert span_start <= move["start"]
        assert move["end"] <= span_end
    # The page's count of sets that share time after the change is the engine's.
    assert len(layout.concurrent_pairs()) == change["shared_pairs_after"]


def _grid_starts(duration: int, span: tuple[int, int]) -> range:
    return range(-(-span[0] // STEP) * STEP, span[1] - duration + 1, STEP)


def _engine_search(vector: dict, target: dict) -> list[list[dict]]:
    """Every one-set move and two-set swap the engine accepts, in the page's search space (no shortcuts)."""
    resolved = vector["resolved"]
    span = (min(s for s, _e in resolved), max(e for _s, e in resolved))
    stages = list(dict.fromkeys(row[1] for row in vector["rows"]))
    found: list[list[dict]] = []

    def move(row: int, stage: str, start: int) -> dict:
        length = resolved[row - 1][1] - resolved[row - 1][0]
        return {"row": row, "stage": stage, "start": start, "end": start + length}

    for x in target["rows"]:
        x_start, x_end = resolved[x - 1]
        x_stage = vector["rows"][x - 1][1]
        for stage in stages:
            for start in _grid_starts(x_end - x_start, span):
                if (stage, start) != (x_stage, x_start):
                    candidate = [move(x, stage, start)]
                    if _judge(vector, target, candidate)[0]:
                        found.append(candidate)
        for y in range(1, len(vector["rows"]) + 1):
            if y == x:
                continue
            takes = move(x, vector["rows"][y - 1][1], resolved[y - 1][0])
            if takes["end"] > span[1] or (takes["stage"], takes["start"]) == (x_stage, x_start):
                continue
            if _judge(vector, target, [takes])[0]:
                continue  # one set's move is enough
            y_start, y_end = resolved[y - 1]
            y_stage = vector["rows"][y - 1][1]
            for stage in stages:
                for start in _grid_starts(y_end - y_start, span):
                    if (stage, start) == (y_stage, y_start):
                        continue
                    candidate = [takes, move(y, stage, start)]
                    if _judge(vector, target, [candidate[1]])[0]:
                        continue
                    if _judge(vector, target, candidate)[0]:
                        found.append(candidate)
    return found


@pytest.mark.parametrize(("vector", "trial"), NONE_FOUND, ids=[_id(p) for p in NONE_FOUND])
def test_engine_finds_no_change_where_the_page_found_none(vector: dict, trial: dict) -> None:
    assert _engine_search(vector, trial["target"]) == []


@pytest.mark.parametrize(("vector", "trial"), RECORDED, ids=[_id(p) for p in RECORDED])
def test_engine_search_includes_the_change_the_page_lists_first(vector: dict, trial: dict) -> None:
    recorded = sorted(trial["change"]["moves"], key=lambda m: m["row"])
    searched = [
        sorted(candidate, key=lambda m: m["row"]) for candidate in _engine_search(vector, trial["target"])
    ]
    assert recorded in searched
