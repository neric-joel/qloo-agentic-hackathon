import pytest
from pydantic import ValidationError
from schedule_support import make_festival, make_matrix

from app.schedule.models import (
    Act,
    BillingRule,
    Constraints,
    Festival,
    OverlapMatrix,
    SetSlot,
    Stage,
    format_minutes,
    parse_minutes,
)


def slot(**overrides) -> SetSlot:
    fields = {"act_id": "a", "day": 0, "stage_id": "main", "start": "18:00", "end": "19:00"}
    return SetSlot(**{**fields, **overrides})


def test_times_accept_minutes_or_clock_strings():
    assert slot(start=1080, end=1140).start == 1080
    assert slot(start="18:00", end="19:30").end == 1170
    assert slot(start="9:05", end="10:00").start == 545


def test_times_past_midnight_belong_to_the_same_festival_day():
    late = slot(start="23:30", end="25:15")
    assert (late.start, late.end) == (1410, 1515)
    assert format_minutes(1515) == "25:15"


@pytest.mark.parametrize("bad", ["6pm", "18:75", "18:00:00", "", "-1:00", 2880, -5, 90.5])
def test_malformed_times_are_rejected(bad):
    with pytest.raises(ValidationError):
        slot(start=bad)


def test_parse_minutes_leaves_numbers_for_the_integer_validator():
    assert parse_minutes(90) == 90
    assert parse_minutes("01:30") == 90


def test_a_set_must_end_after_it_starts():
    with pytest.raises(ValidationError, match="must end after it starts"):
        slot(start="19:00", end="19:00")


def test_days_can_be_a_count_or_labels():
    festival = make_festival([("a", 0, "main", 600, 660)], days=3)
    assert festival.days == ["Day 1", "Day 2", "Day 3"]
    labelled = Festival.model_validate({**festival.model_dump(), "days": ["Fri", "Sat", "Sun"]})
    assert labelled.days == ["Fri", "Sat", "Sun"]


def test_same_stage_overlaps_are_rejected_with_the_conflicting_acts():
    with pytest.raises(ValidationError) as error:
        make_festival([("a", 0, "main", "18:00", "19:00"), ("b", 0, "main", "18:30", "19:30")])
    assert "'A' and 'B' overlap on stage 'main'" in str(error.value)


def test_back_to_back_sets_on_one_stage_are_allowed():
    festival = make_festival([("a", 0, "main", "18:00", "19:00"), ("b", 0, "main", "19:00", "20:00")])
    assert len(festival.timetable) == 2


def test_overlaps_on_different_stages_or_days_are_fine():
    make_festival(
        [("a", 0, "main", 600, 660), ("b", 0, "side", 600, 660), ("c", 1, "main", 600, 660)], days=2
    )


def test_duplicate_ids_and_double_booked_acts_are_rejected():
    with pytest.raises(ValidationError, match="act 'a' has more than one set"):
        make_festival([("a", 0, "main", 600, 660), ("a", 0, "side", 700, 760)])
    data = make_festival([("a", 0, "main", 600, 660)]).model_dump()
    data["stages"].append(dict(data["stages"][0]))
    with pytest.raises(ValidationError, match="duplicate stage id 'main'"):
        Festival.model_validate(data)
    data = make_festival([("a", 0, "main", 600, 660)]).model_dump()
    data["acts"].append(dict(data["acts"][0]))
    with pytest.raises(ValidationError, match="duplicate act id 'a'"):
        Festival.model_validate(data)


def test_unknown_references_are_reported():
    data = make_festival([("a", 0, "main", 600, 660)]).model_dump()
    data["timetable"][0]["stage_id"] = "nowhere"
    data["timetable"][0]["day"] = 4
    data["timetable"][0]["act_id"] = "ghost"
    with pytest.raises(ValidationError) as error:
        Festival.model_validate(data)
    text = str(error.value)
    assert "unknown act 'ghost'" in text
    assert "unknown stage 'nowhere'" in text
    assert "day 4 but there are 1 days" in text


def test_constraints_must_refer_to_real_acts_and_days():
    festival = make_festival([("a", 0, "main", 600, 660), ("b", 0, "side", 600, 660)])
    data = festival.model_dump()
    data["constraints"]["no_clash_with"] = [("a", "zzz")]
    data["constraints"]["curfew"] = {3: 1400}
    with pytest.raises(ValidationError) as error:
        Festival.model_validate(data)
    assert "no_clash_with references unknown act 'zzz'" in str(error.value)
    assert "curfew set for unknown day 3" in str(error.value)


def test_curfew_keys_arrive_as_strings_in_json():
    festival = make_festival([("a", 0, "main", 600, 660)])
    data = festival.model_dump(mode="json")
    data["constraints"]["curfew"] = {"0": "23:30"}
    assert Festival.model_validate(data).constraints.curfew == {0: 1410}


def test_unknown_fields_are_rejected_so_typos_surface():
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        slot(lock=True)


def test_stage_hours_must_open_before_closing_and_not_repeat_a_day():
    with pytest.raises(ValidationError, match="close must be after open"):
        Stage.model_validate({"id": "m", "name": "M", "hours": [{"day": 0, "open": 700, "close": 700}]})
    with pytest.raises(ValidationError, match="hours twice"):
        Stage.model_validate(
            {
                "id": "m",
                "name": "M",
                "hours": [{"day": 0, "open": 600, "close": 700}, {"day": 0, "open": 800, "close": 900}],
            }
        )


def test_act_ranges_and_defaults():
    act = Act(id="a", name="A")
    assert (act.billing_tier, act.rarity, act.popularity) == (3, 0.5, None)
    for bad in ({"popularity": 1.2}, {"rarity": -0.1}, {"billing_tier": 5}, {"billing_tier": 0}):
        with pytest.raises(ValidationError):
            Act(id="a", name="A", **bad)


def test_billing_rule_needs_some_restriction():
    BillingRule(billing_tier=1)
    with pytest.raises(ValidationError, match="needs max_stage_tier"):
        BillingRule(billing_tier=1, max_stage_tier=None, last_slots=None)


def test_constraints_defaults():
    constraints = Constraints()
    assert constraints.changeover_minutes == 15
    assert constraints.allow_day_moves is False
    assert constraints.curfew == {} and constraints.no_clash_with == []


def test_matrix_accepts_a_symmetric_zero_diagonal_matrix():
    matrix = make_matrix(["a", "b", "c"], {("a", "b"): 0.4, ("b", "c"): 0.9})
    assert matrix.value("a", "b") == matrix.value("b", "a") == 0.4
    assert matrix.coverage_of("a") == "strong"


def test_matrix_must_be_symmetric():
    with pytest.raises(ValidationError, match="not symmetric"):
        OverlapMatrix(act_ids=["a", "b"], values=[[0, 0.4], [0.3, 0]], source="derived")


def test_matrix_diagonal_must_be_zero():
    with pytest.raises(ValidationError, match="diagonal"):
        OverlapMatrix(act_ids=["a", "b"], values=[[0.2, 0.4], [0.4, 0]], source="derived")


@pytest.mark.parametrize("value", [1.5, -0.1, float("nan"), float("inf")])
def test_matrix_values_must_be_between_zero_and_one(value):
    with pytest.raises(ValidationError, match="between 0 and 1"):
        OverlapMatrix(act_ids=["a", "b"], values=[[0, value], [value, 0]], source="derived")


def test_matrix_shape_and_ids_must_match():
    with pytest.raises(ValidationError, match="2x2"):
        OverlapMatrix(act_ids=["a", "b"], values=[[0, 0.1]], source="derived")
    with pytest.raises(ValidationError, match="unique"):
        OverlapMatrix(act_ids=["a", "a"], values=[[0, 0.1], [0.1, 0]], source="derived")
    with pytest.raises(ValidationError, match="not in the matrix"):
        OverlapMatrix(
            act_ids=["a", "b"], values=[[0, 0.1], [0.1, 0]], coverage={"z": "none"}, source="derived"
        )


def test_matrix_source_and_coverage_levels_are_restricted():
    with pytest.raises(ValidationError):
        OverlapMatrix(act_ids=["a"], values=[[0]], source="guess")
    with pytest.raises(ValidationError):
        OverlapMatrix(act_ids=["a"], values=[[0]], coverage={"a": "medium"}, source="derived")
