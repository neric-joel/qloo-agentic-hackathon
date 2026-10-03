"""The grounding check flags figures in an answer that no tool returned. Synthetic strings only."""

import json

from app.agent.grounding import ungrounded_numbers

EXPLAIN = json.dumps(
    {
        "a": {"name": "Nadine Shah", "slot": "Woodsies 15:30-16:30", "draw_out_of_100": 86},
        "b": {"name": "Gurriers", "slot": "Park 15:45-16:30", "draw_out_of_100": 79},
        "minutes_overlapping": 45,
        "taste_overlap_out_of_100": 92,
    }
)
MOVES = json.dumps(
    {"clash_budget_before": 116.71, "options": [{"start": "09:05", "clash_budget_after": 114.26}]}
)


def test_a_figure_no_tool_returned_is_flagged():
    text = "Taste overlap falls from 0.88 to 0.58 and the sets overlap for 30 minutes."
    assert ungrounded_numbers(text, ['{"overlap": 0.8758}', '{"after": 0.583}']) == ["30"]


def test_rounded_values_times_and_the_out_of_100_scale_are_grounded():
    text = (
        "Nadine Shah (draw 86 out of 100) and Gurriers (79/100) overlap for 45 minutes from 15:45; "
        "taste overlap 92 out of 100. Moving Gurriers to 9:05 takes the Clash Budget Index from 116.7 "
        "to 114.3 (about 117 to 114)."
    )
    assert ungrounded_numbers(text, [EXPLAIN, MOVES]) == []


def test_single_digits_are_ignored_but_other_numbers_are_not():
    text = "It has 2 legal places on a 5-minute grid, rank 3, and a 2.4 drop to 113.9 at 16:00."
    assert ungrounded_numbers(text, [EXPLAIN, MOVES]) == ["2.4", "113.9", "16:00"]


def test_each_missing_numeral_is_listed_once_in_order_as_written():
    text = "From 1,405 to 99 and back to 1,405, then 99 again and 12.50."
    assert ungrounded_numbers(text, ['{"x": 12.5}']) == ["1,405", "99"]
    assert ungrounded_numbers(text, ['{"x": 1405, "y": 99, "z": 12.5}']) == []


def test_digits_in_names_count_when_the_name_came_from_a_tool():
    assert (
        ungrounded_numbers("blink-182 plays at 21:00.", ['{"name": "blink-182", "slot": "Main 21:00"}']) == []
    )
    assert ungrounded_numbers("blink-182 plays at 21:00.", ['{"slot": "Main 21:30"}']) == ["182", "21:00"]


def test_numbers_in_compact_json_as_the_tools_send_it_are_grounded():
    compact = json.dumps(json.loads(EXPLAIN) | json.loads(MOVES), separators=(",", ":"))
    text = "They overlap for 45 minutes (taste overlap 92 out of 100); 116.7 goes to 114.3 at 09:05."
    assert ungrounded_numbers(text, [compact]) == []


def test_a_clock_time_followed_by_a_colon_in_prose_is_still_a_time():
    answer = "- Rise stage, 19:35–20:15: the index goes from 86.5 to 83.5.\n- Radical, 18:00–18:40: to 83.7."
    tool = (
        '{"options":[{"move":"Act: Radical 18:15-18:55 -> Rise 19:35-20:15","clash_budget_after":83.5},'
        '{"move":"Act: Radical 18:15-18:55 -> Radical 18:00-18:40","clash_budget_after":83.7}],'
        '"clash_budget_before":86.5}'
    )
    assert ungrounded_numbers(answer, [tool]) == []
    assert ungrounded_numbers("Moved to 20:15: done.", ['{"start":"19:35"}']) == ["20:15"]
