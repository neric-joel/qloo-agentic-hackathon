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


def build_festival(vector: dict) -> Festival:
    """The vector's grid as a one-day Festival, with the page's settings as the engine's constraints."""
    acts: dict[str, str] = {}
    stages: dict[str, str] = {}
    slots = []
    for (act, stage, _start, _end), (start, end) in zip(vector["rows"], vector["resolved"], strict=True):
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
