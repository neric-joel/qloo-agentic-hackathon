"""A pair with no overlap score is unknown: it is left out, never priced as 0 overlap.

Every Qloo answer here is invented and served by an in-process mock transport: no network, no Qloo request.
The shipped-day check reads the untracked presets and skips cleanly when they are not built; it compares the
engine's figures with the report saved at build time and adds no shipped value to this file.
"""

import json
from pathlib import Path

import httpx
import pytest
from schedule_support import make_festival, make_matrix

from app.lineups.overlap_matrix import apply_overlap, one_direction_pairs, unknown_pairs
from app.presets import Preset
from app.qloo.client import QlooClient
from app.qloo.overlap import CONTROL_ARTISTS, OverlapResult, ResolvedAct, build_overlap, combine_rows
from app.schedule.layout import Layout
from app.schedule.metrics import build_scorer, quantile, score_festival
from app.schedule.models import BaselineStats, ScoringConfig

NAMES = ["NORTH", "SOUTH", "EAST", "WEST"]
# Invented affinities, one per act: a row ranks the others by them
AFFINITY = {"NORTH": 0.61, "SOUTH": 0.47, "EAST": 0.33, "WEST": 0.25}
NO_BASELINE = ScoringConfig(baseline_samples=0)
FIXED_BASELINE = ScoringConfig(baseline=BaselineStats(samples=300, mean_regret=0.5, mean_split=0.4))


def fake_qloo(failed=(), omit=None):
    """Search finds every act. A ``failed`` act's ranking is refused (403, not retried); ``omit`` maps an act
    to the acts its ranking leaves out, as a partial answer would."""
    omit = omit or {}

    def handler(request: httpx.Request) -> httpx.Response:
        params = request.url.params
        if request.url.path == "/search":
            name = params["query"]
            return httpx.Response(
                200, json={"results": [{"name": name, "entity_id": f"id:{name}", "popularity": 0.8}]}
            )
        signal = params["signal.interests.entities"].removeprefix("id:")
        if signal in failed:
            return httpx.Response(403, json={"error": "refused"})
        entities = []
        for cid in params["filter.results.entities"].split(","):
            name = cid.removeprefix("id:")
            if name in omit.get(signal, ()):
                continue
            affinity = 0.01 if name in CONTROL_ARTISTS else AFFINITY[name]
            entities.append({"entity_id": cid, "name": name, "query": {"affinity": affinity}})
        return httpx.Response(200, json={"results": {"entities": entities}})

    return QlooClient("k", backoff=0, max_rps=None, transport=httpx.MockTransport(handler))


def lineup():
    """The four acts at the same hour on four stages (every pair concurrent), ids in lower case."""
    stages = {"s1": 1, "s2": 2, "s3": 2, "s4": 3}
    return make_festival(
        [(name.lower(), 0, stage, "18:00", "19:00") for name, stage in zip(NAMES, stages, strict=True)],
        stages=stages,
    )


async def overlap_of(**fake) -> OverlapResult:
    client = fake_qloo(**fake)
    try:
        return await build_overlap(client, NAMES)
    finally:
        await client.aclose()


# ---------------------------------------------------------------- qloo/overlap.py: directions per pair


def test_combine_rows_keeps_both_one_or_no_direction_apart():
    acts = [ResolvedAct(name=n, entity_id=f"id:{n}") for n in ("A", "B", "C")]
    rows = {"id:A": {"id:B": 0.8, "id:C": 0.2}, "id:B": {"id:A": 0.6}, "id:C": {}}
    values, directions = combine_rows(acts, rows)
    assert values["A"]["B"] == values["B"]["A"] == 0.7 and directions["A"]["B"] == 2  # the mean of both
    assert values["A"]["C"] == values["C"]["A"] == 0.2 and directions["C"]["A"] == 1  # used and marked
    assert "C" not in values["B"] and "C" not in directions["B"]  # neither direction: unknown, not 0


async def test_every_pair_of_a_full_answer_rests_on_both_directions():
    result = await overlap_of()
    assert all(count == 2 for row in result.directions.values() for count in row.values())
    assert sum(len(row) for row in result.directions.values()) == len(NAMES) * (len(NAMES) - 1)
    assert not [note for note in result.notes if "direction" in note or "either way" in note]


async def test_a_failed_row_leaves_its_pairs_on_one_direction_and_says_so():
    result = await overlap_of(failed={"WEST"})
    assert {other: result.directions["WEST"][other] for other in ("NORTH", "SOUTH", "EAST")} == {
        "NORTH": 1,
        "SOUTH": 1,
        "EAST": 1,
    }
    assert result.values["WEST"]["NORTH"] == result.values["NORTH"]["WEST"]  # the other row's score, as is
    assert any(note.startswith("Overlap row for WEST failed (403)") for note in result.notes)
    assert "3 pairs scored from one direction only: one act's ranking had no score." in result.notes
    festival, _ = apply_overlap(lineup(), result)
    assert unknown_pairs(festival, result) == frozenset()
    assert one_direction_pairs(festival, result) == {("north", "west"), ("south", "west"), ("east", "west")}


async def test_a_partial_answer_leaves_a_pair_unknown_and_matrix_cell_zero_only_as_a_placeholder():
    result = await overlap_of(omit={"NORTH": {"SOUTH", "EAST"}, "SOUTH": {"NORTH"}})
    assert "SOUTH" not in result.values["NORTH"] and "SOUTH" not in result.directions["NORTH"]
    assert result.directions["NORTH"]["EAST"] == 1  # EAST's row still scored NORTH
    assert "No overlap score either way for 1 pair; left out, not scored as zero." in result.notes
    festival, matrix = apply_overlap(lineup(), result)
    assert unknown_pairs(festival, result) == {("north", "south")}
    assert one_direction_pairs(festival, result) == {("east", "north")}
    assert matrix.value("north", "south") == 0.0  # the matrix needs a number; the scorer is told to skip it
    assert set(matrix.coverage.values()) == {"strong"}


async def test_an_act_with_no_score_at_all_is_left_out_whole():
    others = {"NORTH", "SOUTH", "EAST"}
    result = await overlap_of(failed={"WEST"}, omit={name: {"WEST"} for name in others})
    assert result.values["WEST"] == {} and result.directions["WEST"] == {}
    festival, matrix = apply_overlap(lineup(), result)
    assert matrix.coverage["west"] == "none" and matrix.coverage["north"] == "strong"
    assert unknown_pairs(festival, result) == frozenset()  # the act is out, so none of its pairs is listed
    report = score_festival(festival, matrix, NO_BASELINE, unknown_pairs=unknown_pairs(festival, result))
    assert [(a.act_id, a.reason) for a in report.coverage.unscored] == [("west", "no_signal")]
    assert all("west" not in (c.a.act_id, c.b.act_id) for c in report.clashes)
    assert report.metrics.scored_concurrent_pairs == 3 and report.metrics.unscored_concurrent_pairs == 3


async def test_a_result_without_direction_counts_reads_as_both_directions():
    """An OverlapResult built before directions were kept (no ``directions``) lists no pair as one-way."""
    result = await overlap_of()
    legacy = OverlapResult(
        acts=result.acts, values=result.values, discriminates=None, control_rank=None, notes=[]
    )
    festival, _ = apply_overlap(lineup(), legacy)
    assert one_direction_pairs(festival, legacy) == frozenset()
    assert unknown_pairs(festival, legacy) == frozenset()


# ---------------------------------------------------------------- schedule/metrics.py: unknown pairs abstain


def labelled_day():
    """Five acts at the same hour on five stages. a/b share a genre and their pair is the unknown one."""
    stages = {"s1": 1, "s2": 2, "s3": 2, "s4": 3, "s5": 3}
    genres = {"a": "rock", "b": "rock", "c": "pop", "d": "folk", "e": "jazz"}
    draws = {"a": 0.9, "b": 0.85, "c": 0.4, "d": 0.6, "e": 0.3}
    festival = make_festival(
        [(act, 0, stage, "18:00", "19:00") for act, stage in zip("abcde", stages, strict=True)],
        stages=stages,
        acts={act: {"genre": genres[act], "popularity": draws[act]} for act in "abcde"},
    )
    pairs = {
        ("a", "c"): 0.90, ("a", "d"): 0.30, ("a", "e"): 0.10, ("b", "c"): 0.25, ("b", "d"): 0.20,
        ("b", "e"): 0.12, ("c", "d"): 0.60, ("c", "e"): 0.15, ("d", "e"): 0.05,
    }  # fmt: skip
    return festival, make_matrix(list("abcde"), pairs), pairs  # a/b left at 0.0, as apply_overlap writes it


def test_an_unknown_pair_is_out_of_the_thresholds_the_lists_and_the_labels():
    festival, matrix, pairs = labelled_day()
    config = ScoringConfig(baseline_samples=0)
    report = score_festival(festival, matrix, config, unknown_pairs={("b", "a")})
    known = sorted(pairs.values())
    assert report.thresholds.hidden_overlap == round(quantile(known, config.hidden_quantile), 4)
    assert report.thresholds.false_overlap == round(quantile(known, config.false_quantile), 4)
    listed = [(c.a.act_id, c.b.act_id) for c in [*report.clashes, *report.false_clashes, *report.splits]]
    assert ("a", "b") not in listed
    assert report.false_clash_count == 0
    assert report.metrics.scored_concurrent_pairs == 9 and report.metrics.unscored_concurrent_pairs == 1


def test_imputing_zero_instead_would_invent_a_false_clash_and_a_perfect_split():
    """Why the pair must abstain: as 0.0 it reads as two same-genre top acts whose audiences never meet."""
    festival, matrix, _ = labelled_day()
    imputed = score_festival(festival, matrix, NO_BASELINE)
    assert [(c.a.act_id, c.b.act_id) for c in imputed.false_clashes] == [("a", "b")]
    assert imputed.splits and (imputed.splits[0].a.act_id, imputed.splits[0].b.act_id) == ("a", "b")
    abstained = score_festival(festival, matrix, NO_BASELINE, unknown_pairs={("a", "b")})
    assert abstained.false_clashes == []
    assert ("a", "b") not in [(s.a.act_id, s.b.act_id) for s in abstained.splits]


def test_an_unknown_pair_weighs_nothing_in_the_random_timetable_sums():
    festival, matrix, _ = labelled_day()
    layout = Layout.from_festival(festival)
    scorer = build_scorer(festival, matrix, NO_BASELINE, layout, {("a", "b")})
    i, k = layout.rules.act_ids.index("a"), layout.rules.act_ids.index("b")
    assert scorer.unknown[i][k] and scorer.unknown[k][i] and not scorer.known(i, k)
    assert scorer.regret_w[i][k] == scorer.split_w[i][k] == 0.0
    imputed = build_scorer(festival, matrix, NO_BASELINE, layout)
    assert imputed.split_w[i][k] > 0.0  # 1 - 0.0 overlap: the largest split weight a pair can have
    assert scorer.split_mass == pytest.approx(imputed.split_mass - imputed.split_w[i][k])


def test_the_rank_of_a_known_pair_does_not_move_when_an_unknown_pair_is_added():
    """A new act whose pairs are all unknown changes nothing the known pairs show, rank for rank."""
    base = [("a", 0, "s1", "18:00", "19:00"), ("b", 0, "s2", "18:00", "19:00")]
    base += [("c", 0, "s1", "20:00", "21:00"), ("d", 0, "s2", "20:00", "21:00")]
    stages = {"s1": 1, "s2": 2, "s3": 3}
    acts = {"a": {"genre": "rock"}, "b": {"genre": "pop"}, "c": {"genre": "folk"}, "d": {"genre": "folk"}}
    pairs = {
        ("a", "b"): 0.7, ("c", "d"): 0.4, ("a", "c"): 0.2, ("a", "d"): 0.3, ("b", "c"): 0.6, ("b", "d"): 0.1,
    }  # fmt: skip
    before = score_festival(
        make_festival(base, stages=stages, acts=acts), make_matrix(list("abcd"), pairs), FIXED_BASELINE
    )
    grown = make_festival([*base, ("e", 0, "s3", "18:00", "19:00")], stages=stages, acts=acts)
    matrix = make_matrix(list("abcde"), pairs)
    unknown = {("a", "e"), ("b", "e"), ("c", "e"), ("d", "e")}
    after = score_festival(grown, matrix, FIXED_BASELINE, unknown_pairs=unknown)
    shown = ("clashes", "false_clashes", "splits", "thresholds", "hidden_clash_count", "false_clash_count")
    for field in shown:
        assert getattr(after, field) == getattr(before, field), field
    assert after.metrics.regret == before.metrics.regret
    assert after.metrics.clash_budget_index == before.metrics.clash_budget_index
    imputed = score_festival(grown, matrix, FIXED_BASELINE)
    assert imputed.thresholds != before.thresholds  # as zeros, the same pairs would move the thresholds


def test_no_unknown_pairs_scores_exactly_as_before():
    festival, matrix, _ = labelled_day()
    config = ScoringConfig(baseline_samples=40)
    plain = score_festival(festival, matrix, config)
    assert score_festival(festival, matrix, config, unknown_pairs=()) == plain
    assert score_festival(festival, matrix, config, unknown_pairs={("a", "a"), ("x", "y")}) == plain


# ---------------------------------------------------------------- the shipped days: every figure unchanged

PRESETS = Path(__file__).resolve().parents[1] / "presets"
SHIPPED = ("glastonbury-2025-sun", "riot-fest-2026-sun")


@pytest.mark.parametrize("preset_id", SHIPPED)
def test_the_shipped_days_score_byte_for_byte_as_published(preset_id):
    """Before: the report saved when the day was built. After: this engine, with and without the new argument.

    Neither shipped day has a pair without a score, so leaving unknown pairs out changes no published figure:
    the index, the random-timetable baseline, the thresholds, the hidden set and every ranked list.
    """
    path = PRESETS / f"{preset_id}.json"
    if not path.is_file():
        pytest.skip("the real presets are not built in this checkout")
    preset = Preset.model_validate(json.loads(path.read_text(encoding="utf-8")))
    published = json.dumps(preset.report, sort_keys=True)
    fresh = score_festival(preset.festival, preset.matrix)
    assert json.dumps(fresh.model_dump(mode="json"), sort_keys=True) == published
    none_unknown = score_festival(preset.festival, preset.matrix, unknown_pairs=frozenset())
    assert json.dumps(none_unknown.model_dump(mode="json"), sort_keys=True) == published
    layout = Layout.from_festival(preset.festival)
    scorer = build_scorer(preset.festival, preset.matrix, ScoringConfig(baseline_samples=0), layout)
    assert not any(any(row) for row in scorer.unknown)
