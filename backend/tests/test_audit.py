"""The lens endpoint: the day's costliest clashes priced with taste overlap and with draw and time alone, each
with its rank in the other view; ranks and names only, no Qloo request, cached per preset and day."""

import json

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import audit
from app.config import Settings, get_settings
from app.deps import get_qloo
from app.presets import CACHE_CONTROL
from app.presets import router as presets_router
from app.qloo.client import QlooClient
from app.schedule.metrics import score_festival
from app.schedule.models import ScoringConfig
from tests.schedule_support import make_festival, make_matrix

STAGES = {f"s{n}": n for n in range(1, 7)}
BLOCKS = [(720, 780), (840, 900), (960, 1020)]  # three hours, six stages each


def no_qloo() -> QlooClient:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise AssertionError("the lens endpoint never calls Qloo")

    return QlooClient("test-key", max_rps=None, transport=httpx.MockTransport(refuse))


def lens_day():
    """18 sets in three blocks of six concurrent sets. In block 0, t1/t2 are low-draw acts with the highest
    taste overlap (costly only because of taste) and d1/d2 high-draw acts with almost none (costly only by
    draw). x1 and x2 never share a minute but have a top-tenth taste overlap; u1 has no Qloo signal."""
    names = [
        ["t1", "t2", "d1", "d2", "b03", "b04"],
        ["x1", "u1", "b12", "b13", "b14", "b15"],
        ["x2", "b21", "b22", "b23", "b24", "b25"],
    ]
    sets = [
        (act, 0, f"s{stage + 1}", start, end)
        for (start, end), row in zip(BLOCKS, names, strict=True)
        for stage, act in enumerate(row)
    ]
    acts = {
        "t1": {"popularity": 0.3},
        "t2": {"popularity": 0.3},
        "d1": {"popularity": 1.0},
        "d2": {"popularity": 1.0},
    }
    festival = make_festival(sets, stages=STAGES, acts=acts)
    ids = [s[0] for s in sets]
    matrix = make_matrix(
        ids,
        {("t1", "t2"): 1.0, ("d1", "d2"): 0.05, ("x1", "x2"): 0.95},
        coverage={"u1": "none"},
        default=0.3,
    )
    return festival, matrix


def write_day(directory, preset_id: str = "day", festival=None, matrix=None) -> dict:
    if festival is None:
        festival, matrix = lens_day()
    data = {
        "id": preset_id,
        "title": "Day",
        "festival": festival.model_dump(mode="json"),
        "matrix": matrix.model_dump(mode="json"),
        "report": score_festival(festival, matrix).model_dump(mode="json"),
    }
    (directory / f"{preset_id}.json").write_text(json.dumps(data), encoding="utf-8")
    return data


@pytest.fixture
def client(tmp_path):
    write_day(tmp_path)
    app = FastAPI()
    app.include_router(audit.router)
    app.include_router(presets_router)
    app.dependency_overrides[get_settings] = lambda: Settings(presets_dir=tmp_path, _env_file=None)
    app.dependency_overrides[get_qloo] = no_qloo
    with audit._lock:
        audit._lenses.clear()
    with TestClient(app) as test_client:
        yield test_client
    with audit._lock:
        audit._lenses.clear()


def floats_in(value) -> list[float]:
    if isinstance(value, float):
        return [value]
    if isinstance(value, dict):
        return [f for v in value.values() for f in floats_in(v)]
    if isinstance(value, list):
        return [f for v in value for f in floats_in(v)]
    return []


def pair(entry: dict) -> frozenset[str]:
    return frozenset((entry["a_id"], entry["b_id"]))


def test_a_pair_costly_only_through_taste_overlap_drops_without_it(client):
    response = client.get("/api/presets/day/lenses")
    assert response.status_code == 200
    assert response.headers["cache-control"] == CACHE_CONTROL
    body = response.json()
    assert body["kind"] == "lenses" and body["day"] == 0 and body["ranked"] == 15
    taste = next(e for e in body["with_taste"] if pair(e) == {"t1", "t2"})
    assert taste["rank"] == 1 and taste["rank_without_taste"] > 15
    assert {"a": taste["a"], "b": taste["b"]} == {"a": "T1", "b": "T2"}

    draw = next(e for e in body["without_taste"] if pair(e) == {"d1", "d2"})
    assert draw["rank"] == 1 and draw["rank_with_taste"] > 15
    assert all(pair(e) != {"d1", "d2"} for e in body["with_taste"])


def test_counts_match_the_lists_and_ranks_are_consistent(client):
    body = client.get("/api/presets/day/lenses?day=0").json()
    for view, other in (("with_taste", "rank_without_taste"), ("without_taste", "rank_with_taste")):
        entries = body[view]
        assert len(entries) == 15
        assert [e["rank"] for e in entries] == list(range(1, 16))
        assert set(entries[0]) == {"a", "b", "a_id", "b_id", "rank", other}
    outside_with = [
        e for e in body["with_taste"] if e["rank_without_taste"] is None or e["rank_without_taste"] > 15
    ]
    outside_flat = [
        e for e in body["without_taste"] if e["rank_with_taste"] is None or e["rank_with_taste"] > 15
    ]
    assert body["only_with_taste"] == len(outside_with) >= 1
    assert body["only_without_taste"] == len(outside_flat) >= 1
    # Each pair's rank in the other view points back at the same pair
    by_flat_rank = {e["rank"]: pair(e) for e in body["without_taste"]}
    for entry in body["with_taste"]:
        if entry["rank_without_taste"] is not None and entry["rank_without_taste"] <= 15:
            assert by_flat_rank[entry["rank_without_taste"]] == pair(entry)


def test_the_with_taste_view_is_the_pages_own_ranking(client, tmp_path):
    data = json.loads((tmp_path / "day.json").read_text(encoding="utf-8"))
    page = [frozenset((c["a"]["act_id"], c["b"]["act_id"])) for c in data["report"]["clashes"]]
    body = client.get("/api/presets/day/lenses").json()
    assert [pair(e) for e in body["with_taste"]] == page


def test_unpriced_acts_never_appear_and_no_value_is_served(client):
    response = client.get("/api/presets/day/lenses")
    body = response.json()
    listed = [e for view in ("with_taste", "without_taste", "apart") for e in body[view]]
    assert listed and all("u1" not in pair(e) for e in listed)
    assert floats_in(body) == []
    for word in (b"matrix", b"affinity", b"values", b"regret", b"overlap"):
        assert word not in response.content


def test_apart_names_top_tenth_taste_pairs_that_share_no_minute(client):
    apart = client.get("/api/presets/day/lenses").json()["apart"]
    assert [pair(e) for e in apart] == [frozenset({"x1", "x2"})]
    assert set(apart[0]) == {"a", "b", "a_id", "b_id"}
    # t1/t2 has the highest taste overlap of the day, but they play at the same time
    assert all(pair(e) != {"t1", "t2"} for e in apart)


def test_unknown_preset_is_404_and_a_day_without_sets_is_422(client):
    missing = client.get("/api/presets/nope/lenses")
    assert missing.status_code == 404 and missing.json() == {"detail": "No preset 'nope'."}
    for day in ("1", "-1", "99"):
        empty = client.get("/api/presets/day/lenses", params={"day": day})
        assert empty.status_code == 422 and empty.json() == {"detail": "That day has no sets."}
    assert client.get("/api/presets/day/lenses", params={"day": "x"}).status_code == 422


def test_the_second_call_is_served_from_the_cache(client, monkeypatch):
    calls = []
    real = audit._priced_pairs

    def counting(*args, **kwargs):
        calls.append(1)
        return real(*args, **kwargs)

    monkeypatch.setattr(audit, "_priced_pairs", counting)
    first = client.get("/api/presets/day/lenses").json()
    assert len(calls) == 2  # with taste and without
    second = client.get("/api/presets/day/lenses?day=0").json()
    assert second == first and len(calls) == 2


def test_a_reloaded_preset_is_scored_again(tmp_path):
    write_day(tmp_path)
    from app.presets import get_presets

    preset = get_presets(Settings(presets_dir=tmp_path, _env_file=None))["day"]
    first = audit.lenses(preset, 0)
    assert audit.lenses(preset, 0) is first
    reloaded = preset.model_copy()
    assert audit.lenses(reloaded, 0) == first and audit.lenses(reloaded, 0) is not first


def test_without_taste_keeps_coverage_and_gives_every_cell_the_same_value():
    _, matrix = lens_day()
    flat = audit.without_taste(matrix)
    assert flat.coverage == matrix.coverage and flat.act_ids == matrix.act_ids
    n = len(flat.act_ids)
    assert {flat.values[i][k] for i in range(n) for k in range(n) if i != k} == {1.0}
    assert all(flat.values[i][i] == 0.0 for i in range(n))
    assert matrix.value("d1", "d2") == 0.05  # the preset's own matrix is untouched


def lens_for(festival, matrix, day: int = 0, preset_id: str = "wide"):
    from app.presets import Preset

    data = {
        "id": preset_id,
        "title": "Wide",
        "festival": festival.model_dump(mode="json"),
        "matrix": matrix.model_dump(mode="json"),
        "report": score_festival(festival, matrix).model_dump(mode="json"),
    }
    return audit.compute_lenses(Preset.model_validate(data), day)


def test_ranks_run_over_every_priced_pair_of_the_day_not_the_engines_cut_list():
    """Two blocks of 20 concurrent sets (380 pairs on day 0, above the engine's 200-pair maximum) and a few
    sets on day 1. The lens ranks all 380: a pair that only taste overlap makes costly has a flat-view rank
    beyond 200, a place the engine's own clash list never reaches."""
    low = [f"l{n:02d}" for n in range(20)]
    high = [f"h{n:02d}" for n in range(20)]
    sets = [(act, 0, f"s{n}", 720, 780) for n, act in enumerate(low)]
    sets += [(act, 0, f"s{n}", 840, 900) for n, act in enumerate(high)]
    sets += [(f"y{n}", 1, f"s{n}", 720, 780) for n in range(6)]
    stages = {f"s{n}": 1 for n in range(20)}
    acts = {act: {"popularity": 0.05 + 0.001 * n} for n, act in enumerate(low)}
    acts |= {act: {"popularity": 0.6 + 0.01 * n} for n, act in enumerate(high)}
    festival = make_festival(sets, days=2, stages=stages, acts=acts)
    matrix = make_matrix([s[0] for s in sets], {("l00", "l01"): 1.0, ("l02", "l03"): 0.99}, default=0.02)
    capped = score_festival(festival, matrix, ScoringConfig(top_clashes=200, baseline_samples=0))
    assert len([c for c in capped.clashes if c.day == 0]) <= 200  # the engine's list is cut at 200

    assert len(audit._priced_pairs(festival, matrix, 0)) == 380
    assert len(audit._priced_pairs(festival, matrix, 1)) == 15
    body = lens_for(festival, matrix)
    top = {pair(e): e for e in body["with_taste"]}
    for key in ({"l00", "l01"}, {"l02", "l03"}):
        entry = top[frozenset(key)]
        assert entry["rank"] <= 2 and entry["rank_without_taste"] > 200  # ranked, and past the engine's cut
    assert body["only_with_taste"] >= 2
    other_day = lens_for(festival, matrix, day=1)
    assert {frozenset((e["a_id"], e["b_id"])) for e in other_day["with_taste"]} <= {
        frozenset((f"y{a}", f"y{b}")) for a in range(6) for b in range(6)
    }


def test_a_pair_is_unranked_only_when_its_cost_in_that_view_is_zero():
    """Both views price the same timetable, so the rank in the other view is null exactly when that pair
    costs nothing there (taste overlap 0 with taste), never because the pair stopped being concurrent."""
    ids = ["p", "q", "r", "u", "v"]
    sets = [(act, 0, f"s{n}", 720, 780) for n, act in enumerate(ids, start=1)]
    stages = {f"s{n}": n for n in range(1, 6)}
    festival = make_festival(sets, stages=stages, acts={"r": {"popularity": 0.0}})
    matrix = make_matrix(
        ids,
        {("p", "q"): 0.0, ("p", "v"): 0.6, ("q", "v"): 0.0},
        coverage={"u": "none"},
        default=0.0,
    )
    body = lens_for(festival, matrix)
    with_by_pair = {pair(e): e for e in body["with_taste"]}
    flat_by_pair = {pair(e): e for e in body["without_taste"]}
    # r has no draw and u no signal: in neither list. p/q and q/v have no taste overlap: free with taste.
    assert set(with_by_pair) == {frozenset({"p", "v"})}
    assert isinstance(with_by_pair[frozenset({"p", "v"})]["rank_without_taste"], int)
    assert set(flat_by_pair) == {frozenset(k) for k in (("p", "q"), ("p", "v"), ("q", "v"))}
    assert flat_by_pair[frozenset({"p", "q"})]["rank_with_taste"] is None
    assert flat_by_pair[frozenset({"q", "v"})]["rank_with_taste"] is None
    assert isinstance(flat_by_pair[frozenset({"p", "v"})]["rank_with_taste"], int)


def test_zero_cost_pairs_and_ties_are_ordered_by_act_ids():
    ids = ["a1", "a2", "a3", "a4", "z1"]
    sets = [(act, 0, f"s{n}", 720, 780) for n, act in enumerate(ids, start=1)]
    stages = {f"s{n}": n for n in range(1, 6)}
    festival = make_festival(sets, stages=stages)  # equal draw: every pair with equal overlap costs the same
    matrix = make_matrix(ids, {("z1", "a1"): 0.5}, default=0.5)
    first = audit._priced_pairs(festival, matrix, 0)
    again = audit._priced_pairs(festival, matrix, 0)
    assert first == again
    keys = [key for key, _, _ in first]
    assert keys == sorted(keys)  # one cost for every pair, so act-id order
    assert len(keys) == 10
    assert audit._priced_pairs(festival, matrix, 1) == []


# ------------------------------------------------- neutral rarity, denominators, shuffled null


def rare_day(rarity: dict[str, float]):
    """lens_day with the given acts' rarity changed."""
    festival, matrix = lens_day()
    acts = [act.model_copy(update={"rarity": rarity.get(act.id, act.rarity)}) for act in festival.acts]
    return festival.model_copy(update={"acts": acts}), matrix


def view(body: dict, name: str) -> list[tuple[frozenset[str], int]]:
    return [(pair(e), e["rank"]) for e in body[name]]


def test_the_without_view_holds_rarity_neutral_so_it_is_draw_times_shared_time():
    neutral = lens_for(*rare_day({}))
    # Rarity of the costly pairs' acts changes: the price with taste moves, the without view does not
    changed = lens_for(*rare_day({"t1": 1.0, "t2": 1.0, "d1": 0.0, "d2": 0.0, "b03": 1.0, "b04": 0.0}))
    assert view(changed, "without_taste") == view(neutral, "without_taste")
    assert changed["priced_without_taste"] == neutral["priced_without_taste"]
    assert view(changed, "with_taste") != view(neutral, "with_taste")

    # Every priced pair of one block costs draw x shared time there: ordered by the pair's combined draw
    # (all six sets of a block share the same hour, so the order within the block is by draw)
    block = [e for e in changed["without_taste"] if pair(e) <= {"t1", "t2", "d1", "d2", "b03", "b04"}]
    draw = {"t1": 0.3, "t2": 0.3, "d1": 1.0, "d2": 1.0, "b03": 0.5, "b04": 0.5}
    scores = [(draw[e["a_id"]] * draw[e["b_id"]]) ** 0.5 for e in block]
    assert scores == sorted(scores, reverse=True)


def test_neutral_rarity_leaves_a_day_that_already_has_neutral_rarity_unchanged():
    festival, _ = lens_day()
    assert {act.rarity for act in festival.acts} == {0.5}
    assert [a.rarity for a in audit.neutral_rarity(festival).acts] == [0.5] * len(festival.acts)
    changed, _ = rare_day({"t1": 0.1})
    assert changed.act_by_id()["t1"].rarity == 0.1  # the preset's own festival is not modified
    assert audit.neutral_rarity(changed).act_by_id()["t1"].rarity == 0.5
    assert changed.act_by_id()["t1"].rarity == 0.1


def test_the_rank_denominators_are_the_numbers_of_pairs_ranked_in_each_view(client):
    festival, matrix = lens_day()
    body = client.get("/api/presets/day/lenses").json()
    assert body["priced_with_taste"] == len(audit._priced_pairs(festival, matrix, 0))
    assert body["priced_without_taste"] == len(
        audit._priced_pairs(audit.neutral_rarity(festival), audit.without_taste(matrix), 0)
    )
    # 3 blocks of 6 sets make 45 pairs; u1 has no signal, so its 5 pairs are in neither view
    assert body["priced_with_taste"] == body["priced_without_taste"] == 40
    for name, count in (("with_taste", "priced_with_taste"), ("without_taste", "priced_without_taste")):
        assert max(e["rank"] for e in body[name]) <= body[count]
        for other in ("rank_without_taste", "rank_with_taste"):
            assert all(e.get(other) is None or e[other] <= 40 for e in body[name])

    # More than 15 priced pairs: the denominator is the whole day, not the 15 listed
    sets = [(f"a{n:02d}", 0, f"s{n}", 720, 780) for n in range(20)]
    wide = make_festival(sets, stages={f"s{n}": 1 for n in range(20)})
    body = lens_for(wide, make_matrix([s[0] for s in sets], {}, default=0.4))
    assert body["priced_with_taste"] == body["priced_without_taste"] == 190


def test_the_shuffled_null_is_integers_within_the_list_size_and_has_no_float(client):
    body = client.get("/api/presets/day/lenses").json()
    shuffled = body["shuffled"]
    assert set(shuffled) == {"runs", "median", "low", "high"} and shuffled["runs"] == 200
    for key in ("runs", "median", "low", "high"):
        assert type(shuffled[key]) is int
    assert 0 <= shuffled["low"] <= shuffled["median"] <= shuffled["high"] <= body["ranked"]
    assert floats_in(body) == []


def test_the_shuffle_is_deterministic_and_leaves_the_matrix_alone():
    festival, matrix = lens_day()
    before = [row[:] for row in matrix.values]
    flat = audit._priced_pairs(audit.neutral_rarity(festival), audit.without_taste(matrix), 0)
    outside = {key for key, _, _ in flat[: audit.RANKED]}
    first = audit.shuffled_null(festival, matrix, 0, outside)
    assert audit.shuffled_null(festival, matrix, 0, outside) == first
    assert matrix.values == before
    assert audit.shuffled_null(festival, matrix, 0, outside, runs=20)["runs"] == 20


def test_shuffling_equal_taste_overlaps_changes_nothing():
    """With one overlap value for every priced pair, any dealing of the values is the real one."""
    sets = [(f"a{n:02d}", 0, f"s{n}", 720, 780) for n in range(12)]
    acts = {f"a{n:02d}": {"popularity": 0.1 + 0.07 * n} for n in range(12)}
    festival = make_festival(sets, stages={f"s{n}": 1 for n in range(12)}, acts=acts)
    body = lens_for(festival, make_matrix([s[0] for s in sets], {}, default=0.4))
    assert body["only_with_taste"] == 0
    assert body["shuffled"] == {"runs": 200, "median": 0, "low": 0, "high": 0}


def test_the_shuffle_moves_the_count_when_the_overlaps_are_uneven():
    """Two cheap acts share the day's highest overlap: dealt elsewhere, the overlap rarely lands on a pair
    that the draw-and-time view leaves outside its 15, so the null's median sits under the real count."""
    body = lens_for(*lens_day())
    assert body["only_with_taste"] == 1  # t1/t2, costly only through their shared taste
    assert body["shuffled"]["median"] < body["only_with_taste"] <= body["shuffled"]["high"]


def test_the_second_call_does_not_recompute_the_null(client, monkeypatch):
    calls = []
    real = audit.shuffled_null

    def counting(*args, **kwargs):
        calls.append(1)
        return real(*args, **kwargs)

    monkeypatch.setattr(audit, "shuffled_null", counting)
    first = client.get("/api/presets/day/lenses").json()
    assert len(calls) == 1
    assert client.get("/api/presets/day/lenses?day=0").json() == first and len(calls) == 1


def test_the_echoed_preset_id_is_capped_at_80_characters(client):
    long_id = "p" * 300
    response = client.get(f"/api/presets/{long_id}/lenses")
    assert response.status_code == 404
    detail = response.json()["detail"]
    assert detail == f"No preset {'p' * 80!r}." and len(detail) < 100
