import pytest

from app.lineups.overlap_matrix import apply_overlap, genre_label
from app.lineups.timetable import PublishedTimetable, Reach, slugify, to_festival
from app.qloo.overlap import OverlapResult, ResolvedAct
from app.schedule.metrics import score_festival
from app.schedule.optimizer import optimize

TIMETABLE = PublishedTimetable.model_validate(
    {
        "id": "riverbend-2026",
        "name": "Riverbend 2026",
        "city": "Portland, OR",
        "days": ["Fri", "Sat"],
        "stages": [
            {"id": "main", "name": "Main", "tier": "main"},
            {"id": "tent", "name": "Tent", "tier": "secondary"},
            {"id": "bingo", "name": "Bingo", "tier": "minor"},
        ],
        "sets": [
            {"act": "Opener", "stage": "main", "day": "Sat", "start": "14:00", "end": "15:00"},
            {"act": "Support", "stage": "main", "day": "Sat", "start": "18:00", "end": "19:00"},
            {"act": "Headliner", "stage": "main", "day": "Sat", "start": "20:00", "end": "21:30"},
            {"act": "Early Tent", "stage": "tent", "day": "Sat", "start": "15:00", "end": "16:00"},
            {"act": "Tent Closer", "stage": "tent", "day": "Sat", "start": "20:30", "end": "21:45"},
            {
                "act": "Dropped",
                "stage": "tent",
                "day": "Sat",
                "start": "17:00",
                "end": "18:00",
                "flags": ["cancelled"],
            },
            {"act": "Caller", "stage": "bingo", "day": "Sat", "start": "19:00", "end": "20:00"},
            {"act": "Friday Act", "stage": "main", "day": "Fri", "start": "19:00", "end": "20:00"},
        ],
    }
)


def test_one_day_with_billing_locks_hours_and_curfew():
    festival = to_festival(TIMETABLE, "Sat")
    tiers = {a.name: a.billing_tier for a in festival.acts}
    assert tiers == {"Opener": 4, "Support": 2, "Headliner": 1, "Early Tent": 4, "Tent Closer": 2}
    assert [s.act_id for s in festival.timetable if s.locked] == ["headliner"]
    assert festival.constraints.curfew == {0: 21 * 60 + 45}
    assert festival.constraints.changeover_minutes == 15
    hours = {s.id: (s.hours[0].open, s.hours[0].close) for s in festival.stages}
    assert hours == {"main": (14 * 60, 21 * 60 + 30), "tent": (15 * 60, 21 * 60 + 45)}


def test_stage_choice_start_filter_and_errors():
    festival = to_festival(TIMETABLE, "Sat", stage_ids=["main", "bingo"], start_after="18:00")
    assert [a.name for a in festival.acts] == ["Support", "Headliner", "Caller"]
    with pytest.raises(ValueError, match="no day"):
        to_festival(TIMETABLE, "Sun")
    with pytest.raises(ValueError, match="unknown stage"):
        to_festival(TIMETABLE, "Sat", stage_ids=["nope"])


def test_tight_published_changeovers_stay_feasible():
    tight = TIMETABLE.model_copy(deep=True)
    tight.sets[1].start = "15:05"  # 5 minutes after the opener
    tight.sets[1].end = "16:00"
    assert to_festival(tight, "Sat").constraints.changeover_minutes == 5


def test_duplicate_act_names_get_distinct_ids():
    twice = TIMETABLE.model_copy(deep=True)
    twice.sets[3].act = "Opener"
    festival = to_festival(twice, "Sat")
    assert sorted(a.id for a in festival.acts if a.id.startswith("opener")) == ["opener", "opener-2"]


def test_slugify_and_genre_label():
    assert slugify("RÜFÜS DU SOL") == "rufus-du-sol"
    assert slugify("bbno$") == "bbno"
    assert genre_label("urn:tag:genre:alternative_rock") == "Alternative Rock"


def test_apply_overlap_builds_a_symmetric_matrix_and_marks_missing_acts():
    festival = to_festival(TIMETABLE, "Sat")
    names = [a.name for a in festival.acts]
    known = [n for n in names if n != "Early Tent"]
    result = OverlapResult(
        acts=[
            ResolvedAct(
                name=n, entity_id=f"id-{n}", popularity=0.9, coverage="strong", genres=["urn:tag:genre:indie"]
            )
            for n in known
        ]
        + [ResolvedAct(name="Early Tent", entity_id=None)],
        values={
            a: {b: 0.8 if {a, b} == {"Support", "Tent Closer"} else 0.2 for b in known if b != a}
            for a in known
        },
        discriminates=True,
        control_rank=0.1,
    )
    enriched, matrix = apply_overlap(festival, result)
    assert matrix.value("support", "tent-closer") == matrix.value("tent-closer", "support") == 0.8
    assert matrix.coverage_of("early-tent") == "none"
    support = next(a for a in enriched.acts if a.id == "support")
    assert (support.qloo_id, support.genre) == ("id-Support", "Indie")
    report = score_festival(enriched, matrix)
    assert report is not None


def test_stages_ranked_and_sets_limited_to_nearby_times_and_stages():
    festival = to_festival(TIMETABLE, "Sat")
    assert [(s.id, s.tier) for s in festival.stages] == [("main", 1), ("tent", 2)]
    slots = {s.act_id: s for s in festival.timetable}
    opener = slots["opener"]
    assert (opener.not_before, opener.not_after) == (12 * 60, 16 * 60)
    assert opener.stages == ["main", "tent"]
    narrow = to_festival(TIMETABLE, "Sat", reach=Reach(minutes=30, stages=0))
    early = {s.act_id: s for s in narrow.timetable}["early-tent"]
    assert (early.not_before, early.not_after, early.stages) == (14 * 60 + 30, 15 * 60 + 30, ["tent"])


def test_unlimited_reach_leaves_sets_free():
    festival = to_festival(TIMETABLE, "Sat", reach=Reach(minutes=None, stages=None))
    assert all(s.not_before is None and s.not_after is None and s.stages is None for s in festival.timetable)


def test_optimizer_keeps_moves_within_reach():
    festival = to_festival(TIMETABLE, "Sat", reach=Reach(minutes=60, stages=0))
    names = [a.name for a in festival.acts]
    result = OverlapResult(
        acts=[ResolvedAct(name=n, entity_id=f"id-{n}", popularity=0.9, coverage="strong") for n in names],
        values={a: {b: 0.9 for b in names if b != a} for a in names},
        discriminates=True,
        control_rank=0.1,
    )
    enriched, matrix = apply_overlap(festival, result)
    report = optimize(enriched, matrix, weight=1.0, move_budget=4)
    home = {s.act_id: s for s in festival.timetable}
    for option in report.options:
        for slot in option.timetable:
            assert slot.stage_id == home[slot.act_id].stage_id
            assert abs(slot.start - home[slot.act_id].start) <= 60
