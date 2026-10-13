"""Grid pricing (``POST /api/price-grid``): a saved day prices a pasted grid's pairs with no Qloo request and
no limiter slot, real days only for the pairs their home page prints a taste overlap or a taste rank
for (ranked clashes, receipts and the "Two rankings of this day" lens) and the invented day exempt and
labelled; the live mode is off by default, refused before Qloo when it is off, paused or capped, sends at
most ``need`` private requests that are never retried, gives its reservation back on every path, and prices
with the build's rank arithmetic. Answers hold only the allowlisted keys, every response is ``no-store``
and no name is logged. Every preset, name and answer here is synthetic, except one check that reads the built
presets when they are present (act names in, presence and status out, never a value)."""

import asyncio
import json
import logging
import random
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app import audit, gridprice
from app.config import Settings, get_settings
from app.deps import get_price_grid_limiter
from app.limits import PRICE_GRID_MESSAGES, RunLimiter
from app.main import app, get_qloo
from app.pair import page_pairs, taste_pairs
from app.presets import synthetic_presets
from app.qloo.client import QlooClient, normalize_params, request_key
from app.qloo.overlap import percentiles
from app.schedule.metrics import score_festival
from app.schedule.models import OverlapMatrix
from app.schedule.synthetic import synthetic_festival

PATH = "/api/price-grid"
TOP_KEYS = {
    "mode",
    "source",
    "preset_id",
    "fetched_at",
    "coverage",
    "comparator",
    "pairs",
    "requests_used",
    "scope_note",
}
PAIR_KEYS = {"a", "b", "status", "taste_overlap", "pair_rank", "reason"}
COVERAGE_KEYS = {"acts", "matched", "priced", "unpriced", "no_signal", "ambiguous"}
COMPARATOR_KEYS = {"kind", "acts"}
LIVE_NAMES = [f"Paper Lantern {n}" for n in range(8)]


class NoQloo:
    """Fails on any use: a saved answer must never reach Qloo."""

    def __getattr__(self, name):
        raise AssertionError(f"Qloo was touched ({name})")


class NoLimiter:
    """Fails on any use: a saved answer and a refusal before the limiter must never take a slot."""

    def __getattr__(self, name):
        raise AssertionError(f"the limiter was touched ({name})")


def affinity(signal: str, candidate: str) -> float:
    return random.Random(f"{signal}|{candidate}").uniform(0.1, 1.0)


class FakeQloo:
    """A Qloo stand-in: each name is its own artist (``q:<name>``) unless listed; rankings by ``affinity``."""

    def __init__(
        self,
        *,
        remaining="9000",
        unknown=(),
        alias=None,
        fail=None,
        delay=0.0,
        drop=None,
        twins=(),
        empty=False,
    ):
        self.remaining = remaining
        self.unknown = set(unknown)  # names no artist matches
        self.alias = alias or {}  # name -> another name whose artist it matches
        self.twins = set(twins)  # names two artists share exactly (a popular one and a less popular one)
        self.empty = empty  # every ranking comes back with no entities
        self.fail = fail  # a path that answers 500
        self.delay = delay
        self.drop = drop  # a Qloo id left out of every ranking
        self.seen: list[httpx.Request] = []

    async def handler(self, request: httpx.Request) -> httpx.Response:
        self.seen.append(request)
        if self.delay:
            await asyncio.sleep(self.delay)
        headers = {"x-month-ratelimit-remaining": self.remaining} if self.remaining else {}
        if request.url.path == self.fail:
            return httpx.Response(500, json={"error": {"reason": "down"}}, headers=headers)
        params = request.url.params
        if request.url.path == "/search":
            name = params["query"]
            if name in self.unknown:
                return httpx.Response(200, json={"results": []}, headers=headers)
            if name in self.twins:
                results = [
                    {"entity_id": f"q:{name}#popular", "name": name, "popularity": 0.9, "tags": []},
                    {"entity_id": f"q:{name}#other", "name": name, "popularity": 0.2, "tags": []},
                ]
                return httpx.Response(200, json={"results": results}, headers=headers)
            artist = self.alias.get(name, name)
            result = {"entity_id": f"q:{artist}", "name": name, "popularity": 0.6, "tags": []}
            return httpx.Response(200, json={"results": [result]}, headers=headers)
        signal = params["signal.interests.entities"]
        entities = [
            {"entity_id": c, "name": c, "popularity": 0.5, "query": {"affinity": affinity(signal, c)}}
            for c in params["filter.results.entities"].split(",")
            if c != self.drop and not self.empty
        ]
        return httpx.Response(200, json={"results": {"entities": entities}}, headers=headers)

    def client(self, **kwargs) -> QlooClient:
        kwargs.setdefault("backoff", 0)
        kwargs.setdefault("max_rps", None)
        return QlooClient("test-key", transport=httpx.MockTransport(self.handler), **kwargs)

    def paths(self) -> list[str]:
        return [request.url.path for request in self.seen]


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


def serve(tmp_path, qloo=None, limiter=None, **settings) -> None:
    """Serve with ``tmp_path`` as the presets folder (empty unless a test writes a day there)."""
    values = {"qloo_api_key": "test-key", **settings}
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None, presets_dir=tmp_path, **values)
    app.dependency_overrides[get_qloo] = lambda: qloo if qloo is not None else NoQloo()
    app.dependency_overrides[get_price_grid_limiter] = lambda: limiter if limiter is not None else NoLimiter()


def price(client: TestClient, acts, pairs, mode="saved", **extra):
    return client.post(PATH, json={"acts": acts, "pairs": pairs, "mode": mode, **extra})


def code(response) -> str:
    return response.json()["detail"]["code"]


def no_store(response) -> bool:
    return response.headers.get("cache-control") == "no-store"


def assert_allowlisted(body: dict) -> None:
    assert set(body) == TOP_KEYS
    assert set(body["coverage"]) == COVERAGE_KEYS
    assert set(body["comparator"]) == COMPARATOR_KEYS
    for pair in body["pairs"]:
        assert set(pair) == PAIR_KEYS
    text = json.dumps(body)
    for word in ("affinity", "entity", "popularity", "tag", "request_id", "params", "q:", "act-", "#"):
        assert word not in text, word
    assert_coverage_adds_up(body)


def assert_coverage_adds_up(body: dict) -> None:
    """matched = priced + no_signal; no_signal and ambiguous are disjoint parts of unpriced; a priced pair's
    acts are both priced; an ambiguous pair names an ambiguous act; a no_signal pair names an unpriced act or
    (live) two priced acts neither ranking held."""
    coverage = body["coverage"]
    unpriced, no_signal, ambiguous = (set(coverage[key]) for key in ("unpriced", "no_signal", "ambiguous"))
    assert coverage["matched"] == coverage["priced"] + len(no_signal)
    assert coverage["priced"] == coverage["acts"] - len(coverage["unpriced"])
    assert no_signal <= unpriced and ambiguous <= unpriced and not no_signal & ambiguous
    for pair in body["pairs"]:
        names = {pair["a"], pair["b"]}
        if pair["status"] == "priced":
            assert not names & unpriced, pair
        elif pair["reason"] == "ambiguous":
            assert names & ambiguous, pair
        else:
            assert not names & ambiguous, pair
            if pair["reason"] == "no_signal" and body["source"] != "qloo_live":
                assert names & unpriced, pair


def invented():
    return next(iter(synthetic_presets().values()))


def scored_names(preset, count: int) -> list[str]:
    """The names of ``count`` scheduled acts the matrix scores, in festival order."""
    scheduled = {slot.act_id for slot in preset.festival.timetable}
    return [
        act.name
        for act in preset.festival.acts
        if act.id in scheduled and preset.matrix.coverage_of(act.id) != "none"
    ][:count]


def ids_by_name(preset) -> dict[str, str]:
    return {act.name: act.id for act in preset.festival.acts}


# ------------------------------------------------------------------------------------- the saved mode


def test_the_invented_day_prices_with_no_qloo_request_and_no_limiter_slot(tmp_path):
    serve(tmp_path)  # Qloo and the limiter both fail on any use
    preset = invented()
    names = scored_names(preset, 10)
    pairs = [[names[0], names[1]], [names[2], names[3]], [names[4], names[5]]]
    with TestClient(app) as client:
        response = price(client, names, pairs)
    assert response.status_code == 200, response.text
    assert no_store(response)
    body = response.json()
    assert_allowlisted(body)
    assert body["mode"] == "saved" and body["source"] == "invented_day" and body["requests_used"] == 0
    assert body["preset_id"] == preset.id and body["fetched_at"] is None
    assert "invented" in body["scope_note"]
    assert body["coverage"] == {
        "acts": 10,
        "matched": 10,
        "priced": 10,
        "unpriced": [],
        "no_signal": [],
        "ambiguous": [],
    }
    lineup = len(scored_names(preset, 100))
    assert lineup == 23  # the invented day's 24 scheduled acts, one with no signal
    assert body["comparator"] == {"kind": "saved_day", "acts": lineup}
    ids = ids_by_name(preset)
    values = [round(preset.matrix.value(ids[a], ids[b]), 4) for a, b in pairs]
    assert [pair["taste_overlap"] for pair in body["pairs"]] == values
    assert [pair["status"] for pair in body["pairs"]] == ["priced"] * 3
    assert [[pair["a"], pair["b"]] for pair in body["pairs"]] == pairs  # request order, names as sent
    ranks = [1 + sum(1 for other in values if other > value) for value in values]
    assert [pair["pair_rank"] for pair in body["pairs"]] == ranks
    assert sorted(ranks)[0] == 1


def test_names_match_whatever_their_case_spacing_accents_or_leading_the(tmp_path):
    serve(tmp_path)
    names = scored_names(invented(), 5)
    sent = ["  " + names[0].upper() + " ", "The " + names[1], names[2].lower(), names[3], names[4]]
    with TestClient(app) as client:
        response = price(client, sent, [[sent[0], sent[1]]])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["coverage"]["priced"] == 5
    assert body["pairs"][0]["a"] == names[0].upper()  # trimmed, otherwise as sent


def test_under_80_percent_found_is_not_a_saved_day_and_80_percent_is(tmp_path):
    serve(tmp_path)
    names = scored_names(invented(), 4)
    four_of_five = names + ["Nobody Pasted This"]
    three_of_five = names[:3] + ["Nobody Pasted This", "Nor This"]
    with TestClient(app) as client:
        found = price(client, four_of_five, [[names[0], names[1]]])
        missed = price(client, three_of_five, [[names[0], names[1]]])
    assert found.status_code == 200 and found.json()["coverage"]["unpriced"] == ["Nobody Pasted This"]
    assert missed.status_code == 422 and no_store(missed)
    assert missed.json() == {
        "detail": {"code": "not_a_saved_day", "message": "These acts are not on a saved festival day."}
    }


def test_a_pair_with_an_act_found_but_not_scored_is_unpriced_with_no_signal(tmp_path):
    serve(tmp_path)
    preset = invented()
    scheduled = {slot.act_id for slot in preset.festival.timetable}
    unscored = [
        act.name
        for act in preset.festival.acts
        if act.id in scheduled and preset.matrix.coverage_of(act.id) == "none"
    ]
    assert unscored, "the invented day has an act with no signal"
    names = scored_names(preset, 6) + unscored[:1]
    with TestClient(app) as client:
        response = price(client, names, [[names[0], unscored[0]], [names[1], names[2]]])
    body = response.json()
    assert body["coverage"] == {
        "acts": 7,
        "matched": 7,
        "priced": 6,
        "unpriced": [unscored[0]],
        "no_signal": [unscored[0]],
        "ambiguous": [],
    }
    first, second = body["pairs"]
    assert first == {
        "a": names[0],
        "b": unscored[0],
        "status": "unpriced",
        "taste_overlap": None,
        "pair_rank": None,
        "reason": "no_signal",
    }
    assert second["status"] == "priced" and second["pair_rank"] == 1


def write_real_day(directory) -> dict:
    """A non-synthetic saved day (synthetic acts with Qloo ids), its report and receipts as a build writes."""
    festival, matrix = synthetic_festival(11, days=1, acts=12)
    festival = festival.model_copy(
        update={"acts": [act.model_copy(update={"qloo_id": f"q:{act.id}"}) for act in festival.acts]}
    )
    last = festival.acts[-1].id
    matrix = OverlapMatrix(
        act_ids=matrix.act_ids, values=matrix.values, coverage={last: "none"}, source="synthetic"
    )
    report = score_festival(festival, matrix).model_dump(mode="json")
    preset = {
        "id": "real-day",
        "title": "Real Day",
        "built_at": "2026-06-01T10:00:00Z",
        "festival": festival.model_dump(mode="json"),
        "matrix": matrix.model_dump(mode="json"),
        "report": report,
        "requests": [],
        "evidence": {"receipts": {}},
    }
    (directory / "real-day.json").write_text(json.dumps(preset), encoding="utf-8")
    return preset


def test_a_real_day_prices_only_the_pairs_its_page_shows(tmp_path):
    raw = write_real_day(tmp_path)
    serve(tmp_path)
    from app.presets import Preset

    preset = Preset.model_validate(raw)
    shown = taste_pairs(preset)
    names = {act.id: act.name for act in preset.festival.acts}
    scored = [act.id for act in preset.festival.acts if preset.matrix.coverage_of(act.id) != "none"]
    on_page = next(pair for pair in sorted(shown, key=sorted) if pair <= set(scored))
    off_page = next(
        (a, b) for i, a in enumerate(scored) for b in scored[i + 1 :] if frozenset((a, b)) not in shown
    )
    acts = [names[act_id] for act_id in scored]
    a, b = sorted(on_page)
    pairs = [[names[a], names[b]], [names[off_page[0]], names[off_page[1]]]]
    with TestClient(app) as client:
        response = price(client, acts, pairs)
    assert response.status_code == 200, response.text
    body = response.json()
    assert_allowlisted(body)
    assert body["source"] == "saved_day" and body["preset_id"] == "real-day"
    assert body["fetched_at"] == "2026-06-01T10:00:00Z" and "saved festival day" in body["scope_note"]
    assert body["comparator"] == {"kind": "saved_day", "acts": 11}  # 12 acts, the last with no signal
    shown_pair, hidden_pair = body["pairs"]
    assert shown_pair["status"] == "priced"
    assert shown_pair["taste_overlap"] == round(preset.matrix.value(a, b), 4) and shown_pair["pair_rank"] == 1
    assert hidden_pair == {
        "a": pairs[1][0],
        "b": pairs[1][1],
        "status": "unpriced",
        "taste_overlap": None,
        "pair_rank": None,
        "reason": "not_ranked_on_saved_day",
    }


def test_a_real_day_prices_the_pairs_of_its_two_rankings_lens_beyond_its_ranked_clashes(tmp_path):
    """The home page's "Two rankings of this day" prints a taste rank for pairs outside the ranked clashes
    (the costliest on draw and time alone, with their rank once taste counts): saved pricing answers them too,
    with the saved value, and still refuses a pair the page never ranks. No Qloo request, no limiter slot."""
    raw = write_real_day(tmp_path)
    serve(tmp_path)  # Qloo and the limiter both fail on any use
    from app.presets import Preset

    preset = Preset.model_validate(raw)
    lens = audit.lenses(preset, 0)
    lens_pairs = {frozenset((e["a_id"], e["b_id"])) for e in lens["with_taste"] + lens["without_taste"]}
    beyond = sorted((sorted(p) for p in lens_pairs - page_pairs(preset)), key=tuple)
    assert beyond, "the lens ranks a pair the clash list does not"
    a, b = beyond[0]
    shown = taste_pairs(preset)
    assert lens_pairs | page_pairs(preset) <= shown
    names = {act.id: act.name for act in preset.festival.acts}
    scored = [act.id for act in preset.festival.acts if preset.matrix.coverage_of(act.id) != "none"]
    never = next(
        (x, y) for i, x in enumerate(scored) for y in scored[i + 1 :] if frozenset((x, y)) not in shown
    )
    pairs = [[names[a], names[b]], [names[never[0]], names[never[1]]]]
    with TestClient(app) as client:
        response = price(client, [names[act_id] for act_id in scored], pairs)
    assert response.status_code == 200, response.text
    body = response.json()
    assert_allowlisted(body)
    assert body["source"] == "saved_day" and body["requests_used"] == 0
    lens_pair, never_pair = body["pairs"]
    assert lens_pair["status"] == "priced" and lens_pair["reason"] is None
    assert lens_pair["taste_overlap"] == round(preset.matrix.value(a, b), 4)
    assert never_pair["status"] == "unpriced" and never_pair["reason"] == "not_ranked_on_saved_day"


REAL_PRESETS = Path(__file__).resolve().parents[1] / "presets"
# Pairs the shipped home page ranks (the hero pair, and a pair of the "Two rankings of this day" lens); act
# names only, from the published timetable. The test reads no value from the presets and asserts none.
HOME_PAGE_PAIRS = [("Sprints", "Katy J Pearson"), ("Olivia Rodrigo", "The Prodigy")]


@pytest.mark.skipif(not any(REAL_PRESETS.glob("*.json")), reason="no built presets (a clean clone has none)")
@pytest.mark.parametrize(("first", "second"), HOME_PAGE_PAIRS)
def test_the_built_days_price_the_pairs_their_home_page_ranks_with_no_qloo_request(first, second):
    from app.presets import _load_all

    days = _load_all(str(REAL_PRESETS))
    preset = next(
        (day for day in days.values() if {first, second} <= {act.name for act in day.festival.acts}),
        None,
    )
    if preset is None:
        pytest.skip(f"no built day holds {first} and {second}")
    serve(REAL_PRESETS)  # the built presets folder; Qloo and the limiter both fail on any use
    scheduled = {slot.act_id for slot in preset.festival.timetable}
    on_day = [act.name for act in preset.festival.acts if act.id in scheduled]
    acts = [first, second] + [name for name in on_day if name not in (first, second)][:20]
    with TestClient(app) as client:
        response = price(client, acts, [[first, second]])
    assert response.status_code == 200, response.text
    body = response.json()
    assert_allowlisted(body)
    assert body["source"] == "saved_day" and body["preset_id"] == preset.id
    assert body["requests_used"] == 0
    (answer,) = body["pairs"]
    assert answer["status"] == "priced" and answer["reason"] is None
    assert isinstance(answer["taste_overlap"], float) and answer["pair_rank"] == 1


def test_a_name_two_acts_of_the_day_share_is_ambiguous_never_matched_and_never_priced(tmp_path):
    raw = write_real_day(tmp_path)
    acts = raw["festival"]["acts"]
    acts[1]["name"] = acts[0]["name"]  # two scheduled acts of the day now share one name
    (tmp_path / "real-day.json").write_text(json.dumps(raw), encoding="utf-8")
    serve(tmp_path)
    twin = acts[0]["name"]
    others = [act["name"] for act in acts[2:-1]]  # scored, one name each
    sent = [twin, *others]
    partner = others[0]
    pairs = [[twin, partner], [others[0], others[1]]]
    with TestClient(app) as client:
        response = price(client, sent, pairs)
    assert response.status_code == 200, response.text
    body = response.json()
    assert_allowlisted(body)
    assert body["source"] == "saved_day"
    coverage = body["coverage"]
    assert coverage["ambiguous"] == [twin] and coverage["unpriced"][0] == twin
    assert coverage["matched"] == len(others) and twin not in coverage["no_signal"]
    first = body["pairs"][0]
    assert first == {
        "a": twin,
        "b": partner,
        "status": "unpriced",
        "taste_overlap": None,
        "pair_rank": None,
        "reason": "ambiguous",
    }


def test_the_invented_day_still_prices_when_real_days_are_built(tmp_path):
    write_real_day(tmp_path)
    serve(tmp_path)
    names = scored_names(invented(), 6)
    with TestClient(app) as client:
        response = price(client, names, [[names[0], names[1]]])
    assert response.status_code == 200 and response.json()["source"] == "invented_day"


def test_the_saved_mode_answers_with_live_pricing_switched_off(tmp_path):
    serve(tmp_path, price_grid_enabled=False, qloo_api_key=None)
    names = scored_names(invented(), 4)
    with TestClient(app) as client:
        assert price(client, names, [[names[0], names[1]]]).status_code == 200


# ------------------------------------------------------------------------------------------ the body


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ({"acts": ["A", "B", "C"], "pairs": [["A", "B"]]}, "too_few_acts"),
        ({"acts": ["A", "B", "C", "a "], "pairs": [["A", "B"]]}, "duplicate_act"),
        ({"acts": ["Café", "B", "C", "cafe"], "pairs": [["B", "C"]]}, "duplicate_act"),
        ({"acts": ["A", "B", "C", "D"], "pairs": [["A", "E"]]}, "pair_not_in_acts"),
        ({"acts": ["A", "B", "C", "D"], "pairs": [["A", "A"]]}, "same_act_pair"),
        ({"acts": ["A", "B", "C", "D"], "pairs": [["A", "B"], ["B", "A"]]}, "duplicate_pair"),
    ],
)
def test_the_body_checks_refuse_with_a_code_and_never_touch_qloo(tmp_path, body, expected):
    serve(tmp_path)
    for mode in ("saved", "live"):
        app.dependency_overrides[get_settings] = lambda: Settings(
            _env_file=None, presets_dir=tmp_path, price_grid_enabled=True, qloo_api_key="k"
        )
        with TestClient(app) as client:
            response = client.post(PATH, json={**body, "mode": mode})
        assert response.status_code == 422 and no_store(response), (mode, response.text)
        assert code(response) == expected
        assert set(response.json()["detail"]) == {"code", "message"}


@pytest.mark.parametrize(
    "body",
    [
        {"acts": ["A", "B", "C", "D"], "pairs": [["A", "B"]], "mode": "saved", "times": ["12:00"]},
        {"acts": ["A", "B", "C", "D"], "pairs": [["A", "B"]], "mode": "maybe"},
        {"acts": ["A", "B", "C", "D"], "pairs": [["A", "B"]]},
        {"acts": [f"Act {n}" for n in range(26)], "pairs": [["Act 0", "Act 1"]], "mode": "saved"},
        {"acts": ["A", "B", "C", "D"], "pairs": [["A", "B"]] * 6, "mode": "saved"},
        {"acts": ["A", "B", "C", "D"], "pairs": [], "mode": "saved"},
        {"acts": ["A", "B", "C", "D"], "pairs": [["A", "B", "C"]], "mode": "saved"},
        {"acts": ["A", "B", "C", "D" * 81], "pairs": [["A", "B"]], "mode": "saved"},
        {"acts": ["A", "B", "C", "   "], "pairs": [["A", "B"]], "mode": "saved"},
        {"acts": ["A", "B", "C", 4], "pairs": [["A", "B"]], "mode": "saved"},
    ],
)
def test_a_body_outside_the_schema_is_a_422_that_echoes_nothing(tmp_path, body):
    serve(tmp_path)
    with TestClient(app) as client:
        response = client.post(PATH, json=body)
    assert response.status_code == 422 and no_store(response)
    assert isinstance(response.json()["detail"], list)
    assert "Act 1" not in response.text and "12:00" not in response.text and "DDDD" not in response.text


def test_only_a_json_post_is_read_and_every_answer_is_no_store(tmp_path):
    serve(tmp_path)
    with TestClient(app) as client:
        got = client.get(PATH)
        form = client.post(PATH, data={"acts": "A", "pairs": "A,B", "mode": "saved"})
        text = client.post(PATH, content=b"acts=A", headers={"content-type": "text/plain"})
    assert got.status_code == 405 and no_store(got)
    assert form.status_code == 422 and no_store(form)
    assert text.status_code == 422 and no_store(text)


def test_a_body_over_16_kb_is_a_413_before_it_is_read_and_the_largest_legal_body_fits(tmp_path):
    serve(tmp_path)
    largest = {
        "acts": [f"{n:02d}" + "中" * 78 for n in range(25)],
        "pairs": [[f"{n:02d}" + "中" * 78, f"{n + 5:02d}" + "中" * 78] for n in range(5)],
        "mode": "saved",
    }
    text = json.dumps(largest, ensure_ascii=False).encode()
    assert len(text) < 16 * 1024
    gridprice.GridPriceRequest.model_validate_json(text)
    with TestClient(app) as client:
        legal = client.post(PATH, content=text, headers={"content-type": "application/json"})
        over = client.post(PATH, content=b" " * (16 * 1024 + 1), headers={"content-type": "application/json"})
        slash = client.post(
            PATH + "/", content=b" " * (16 * 1024 + 1), headers={"content-type": "application/json"}
        )
    assert legal.status_code == 422 and code(legal) == "not_a_saved_day"  # parsed: the route's own answer
    assert over.status_code == 413 and over.json() == {"detail": "Request too large."} and no_store(over)
    assert slash.status_code == 413


def test_the_body_limit_still_caps_every_other_route():
    limit = gridprice.BodyLimitWithPriceGrid(app=None, limit=5, runs_limit=10, score_limit=20)
    for path, cap in (
        ("/api/price-grid", 5),
        ("/api/price-grid/", 5),
        ("/api/pair", 5),
        ("/api/presets/day/whatif", 5),
        ("/api/runs", 10),
        ("/api/schedule/score", 20),
    ):
        assert limit._limit_for({"type": "http", "method": "POST", "path": path}) == cap, path
    assert limit._limit_for({"type": "http", "method": "GET", "path": "/api/price-grid"}) is None
    assert limit._limit_for({"type": "http", "method": "POST", "path": "/api/other"}) is None


# ----------------------------------------------------------------------------------- the live mode


def test_live_is_off_by_default_and_refused_before_qloo_or_the_limiter(tmp_path):
    defaults = Settings(_env_file=None)
    assert defaults.price_grid_enabled is False
    assert (
        defaults.price_grid_per_visitor_hour,
        defaults.price_grid_per_visitor_day,
        defaults.price_grid_global_per_day,
    ) == (1, 2, 4)
    serve(tmp_path)  # a key, but the switch is off
    with TestClient(app) as client:
        response = price(client, LIVE_NAMES[:4], [LIVE_NAMES[:2]], mode="live")
        health = client.get("/api/health").json()
    assert response.status_code == 503 and no_store(response)
    assert response.json()["detail"] == {
        "code": "live_off",
        "message": "Live pricing is switched off on this server. A saved day still prices.",
    }
    assert health["price_grid_live"] is False


@pytest.mark.parametrize("settings", [{"qloo_api_key": None}, {"qloo_record_fixtures": True}])
def test_live_stays_off_without_a_key_or_while_fixtures_are_recorded(tmp_path, settings):
    serve(tmp_path, price_grid_enabled=True, **settings)
    with TestClient(app) as client:
        response = price(client, LIVE_NAMES[:4], [LIVE_NAMES[:2]], mode="live")
    assert response.status_code == 503 and code(response) == "live_off"


def counting_limiter() -> RunLimiter:
    return RunLimiter(100, 100, 100, messages=PRICE_GRID_MESSAGES)


def build_value(names: list[str], a: str, b: str, matched: list[str]) -> float:
    """The build's arithmetic over the matched names: each one's percentile in the other's row, averaged."""

    def row(signal: str) -> dict[str, float]:
        return percentiles({f"q:{n}": affinity(f"q:{signal}", f"q:{n}") for n in matched if n != signal})

    return round((row(a)[f"q:{b}"] + row(b)[f"q:{a}"]) / 2, 4)


def test_a_live_answer_sends_at_most_need_private_requests_and_prices_with_the_build_arithmetic(tmp_path):
    fake = FakeQloo()
    qloo = fake.client()
    limiter = counting_limiter()
    serve(tmp_path, qloo, limiter, price_grid_enabled=True)
    names = LIVE_NAMES
    pairs = [[names[0], names[1]], [names[2], names[3]], [names[0], names[4]]]
    with TestClient(app) as client:
        response = price(client, names, pairs, mode="live")
    assert response.status_code == 200, response.text
    assert no_store(response)
    body = response.json()
    assert_allowlisted(body)
    need = gridprice.need_for(names, [tuple(p) for p in pairs])
    assert need == 8 + 5
    assert body["requests_used"] == len(fake.seen) == need
    assert fake.paths().count("/search") == 8 and fake.paths().count("/v2/insights") == 5
    assert "/v2/analysis/compare" not in fake.paths()
    assert body["source"] == "qloo_live" and body["preset_id"] is None and body["fetched_at"].endswith("Z")
    assert body["coverage"] == {
        "acts": 8,
        "matched": 8,
        "priced": 8,
        "unpriced": [],
        "no_signal": [],
        "ambiguous": [],
    }
    assert body["comparator"] == {"kind": "live_subset", "acts": 8}
    values = [build_value(names, a, b, names) for a, b in pairs]
    assert [pair["taste_overlap"] for pair in body["pairs"]] == values
    assert [pair["pair_rank"] for pair in body["pairs"]] == [
        1 + sum(1 for other in values if other > value) for value in values
    ]
    # no control acts, and each ranking is the other matched acts only
    for request in fake.seen:
        if request.url.path == "/v2/insights":
            signal = request.url.params["signal.interests.entities"]
            candidates = request.url.params["filter.results.entities"].split(",")
            assert sorted(candidates) == sorted(f"q:{n}" for n in names if f"q:{n}" != signal)
    assert qloo._reserved == 0 and len(limiter._all) == 1


def test_unmatched_and_shared_artists_are_unpriced_and_cost_no_ranking(tmp_path):
    names = LIVE_NAMES[:7]
    fake = FakeQloo(unknown={names[6]}, alias={names[5]: names[4]})  # 4 and 5 both match the artist of 4
    qloo = fake.client()
    serve(tmp_path, qloo, counting_limiter(), price_grid_enabled=True)
    pairs = [[names[0], names[1]], [names[0], names[6]], [names[4], names[2]]]
    with TestClient(app) as client:
        response = price(client, names, pairs, mode="live")
    body = response.json()
    assert response.status_code == 200, response.text
    assert_allowlisted(body)
    assert body["coverage"] == {
        "acts": 7,
        "matched": 4,
        "priced": 4,
        "unpriced": [names[4], names[5], names[6]],
        "no_signal": [],
        "ambiguous": [],
    }
    assert body["comparator"] == {"kind": "live_subset", "acts": 4}
    assert [pair["status"] for pair in body["pairs"]] == ["priced", "unpriced", "unpriced"]
    assert [pair["reason"] for pair in body["pairs"]] == [None, "no_signal", "no_signal"]
    assert fake.paths().count("/v2/insights") == 2  # only the pair that can be priced is ranked
    matched = names[:4]
    assert body["pairs"][0]["taste_overlap"] == build_value(names, names[0], names[1], matched)
    assert body["requests_used"] == 9 <= gridprice.need_for(names, [tuple(p) for p in pairs])


def test_a_name_with_two_same_name_artists_is_ambiguous_with_no_pick_of_the_popular_one(tmp_path, caplog):
    names = LIVE_NAMES[:7]
    fake = FakeQloo(twins={names[0]}, unknown={names[6]})
    qloo = fake.client()
    serve(tmp_path, qloo, counting_limiter(), price_grid_enabled=True)
    pairs = [[names[0], names[1]], [names[2], names[3]], [names[6], names[0]]]
    with caplog.at_level(logging.DEBUG), TestClient(app) as client:
        response = price(client, names, pairs, mode="live")
    assert response.status_code == 200, response.text
    body = response.json()
    assert_allowlisted(body)
    assert body["coverage"] == {
        "acts": 7,
        "matched": 5,
        "priced": 5,
        "unpriced": [names[0], names[6]],
        "no_signal": [],
        "ambiguous": [names[0]],
    }
    assert body["comparator"] == {"kind": "live_subset", "acts": 5}
    assert [(pair["status"], pair["reason"]) for pair in body["pairs"]] == [
        ("unpriced", "ambiguous"),
        ("priced", None),
        ("unpriced", "ambiguous"),  # ambiguous is named before no_signal
    ]
    # neither same-name artist was ranked or used as a signal, and only the priceable pair was ranked
    assert fake.paths().count("/v2/insights") == 2
    for request in fake.seen:
        assert "#" not in str(request.url.params.get("filter.results.entities", ""))
        assert "#" not in str(request.url.params.get("signal.interests.entities", ""))
    text = "\n".join(record.getMessage() for record in caplog.records)
    assert "1 ambiguous" in text and names[0] not in text


def test_a_match_without_a_usable_insights_row_is_never_counted_as_priced(tmp_path):
    names = LIVE_NAMES[:6]
    fake = FakeQloo(empty=True)  # every name matches one artist; every ranking comes back empty
    qloo = fake.client()
    serve(tmp_path, qloo, counting_limiter(), price_grid_enabled=True)
    with TestClient(app) as client:
        response = price(client, names, [names[:2], names[2:4]], mode="live")
    assert response.status_code == 200, response.text
    body = response.json()
    assert_allowlisted(body)
    assert body["coverage"] == {
        "acts": 6,
        "matched": 6,
        "priced": 0,
        "unpriced": names,
        "no_signal": names,
        "ambiguous": [],
    }
    assert [(pair["status"], pair["reason"]) for pair in body["pairs"]] == [("unpriced", "no_signal")] * 2
    assert body["requests_used"] == 6 + 4


def test_an_act_no_ranking_scored_is_no_signal_and_the_rest_stay_priced(tmp_path):
    names = LIVE_NAMES[:6]
    fake = FakeQloo(drop=f"q:{names[5]}")  # matched, not a pair act, left out of every ranking
    qloo = fake.client()
    serve(tmp_path, qloo, counting_limiter(), price_grid_enabled=True)
    with TestClient(app) as client:
        response = price(client, names, [names[:2]], mode="live")
    body = response.json()
    assert_allowlisted(body)
    coverage = body["coverage"]
    assert (coverage["matched"], coverage["priced"]) == (6, 5)
    assert coverage["no_signal"] == coverage["unpriced"] == [names[5]]
    assert body["pairs"][0]["status"] == "priced"


def test_with_no_priceable_pair_no_ranking_is_asked_and_no_act_is_priced(tmp_path):
    names = LIVE_NAMES[:6]
    fake = FakeQloo(unknown={names[5]})
    qloo = fake.client()
    serve(tmp_path, qloo, counting_limiter(), price_grid_enabled=True)
    with TestClient(app) as client:
        response = price(client, names, [[names[0], names[5]]], mode="live")
    body = response.json()
    assert_allowlisted(body)
    assert fake.paths() == ["/search"] * 6 and body["requests_used"] == 6
    assert (body["coverage"]["matched"], body["coverage"]["priced"]) == (5, 0)
    assert body["coverage"]["no_signal"] == names[:5]
    assert body["pairs"][0]["reason"] == "no_signal"


def test_fewer_than_4_matched_is_a_422_after_the_searches_only(tmp_path):
    names = LIVE_NAMES[:5]
    fake = FakeQloo(unknown=set(names[2:]))
    qloo = fake.client()
    serve(tmp_path, qloo, counting_limiter(), price_grid_enabled=True)
    with TestClient(app) as client:
        response = price(client, names, [names[:2]], mode="live")
    assert response.status_code == 422 and no_store(response)
    assert response.json()["detail"] == {
        "code": "too_few_found",
        "message": "Qloo matched fewer than 4 of these acts, so nothing was priced.",
    }
    assert fake.paths() == ["/search"] * 5 and qloo._reserved == 0


@pytest.mark.parametrize("path", ["/search", "/v2/insights"])
def test_a_failed_request_is_never_retried_and_nothing_is_priced(tmp_path, path):
    fake = FakeQloo(fail=path)
    qloo = fake.client(max_retries=3)  # the client would retry; the route turns retries off
    serve(tmp_path, qloo, counting_limiter(), price_grid_enabled=True)
    names = LIVE_NAMES[:5]
    with TestClient(app) as client:
        response = price(client, names, [names[:2]], mode="live")
    assert response.status_code == 503 and no_store(response)
    assert response.json()["detail"] == {
        "code": "no_answer",
        "message": "Qloo did not answer in time; nothing was priced.",
    }
    expected = 5 if path == "/search" else 5 + 2
    assert len(fake.seen) == expected  # one request per call, no retry
    assert qloo._reserved == 0


def test_a_saved_fixture_served_in_place_of_a_live_answer_is_refused(tmp_path):
    names = LIVE_NAMES[:4]
    fixtures = tmp_path / "fixtures"
    fixtures.mkdir()
    params = normalize_params({"query": names[0], "types": ["urn:entity:artist"], "take": 3})
    saved = {"response": {"results": [{"entity_id": "q:x", "name": names[0]}]}}
    (fixtures / f"{request_key('/search', params)}.json").write_text(json.dumps(saved), encoding="utf-8")
    fake = FakeQloo(fail="/search")
    qloo = fake.client(fixtures_dir=fixtures)
    serve(tmp_path, qloo, counting_limiter(), price_grid_enabled=True)
    with TestClient(app) as client:
        response = price(client, names, [names[:2]], mode="live")
    assert response.status_code == 503 and code(response) == "no_answer" and qloo._reserved == 0


def test_a_slow_qloo_is_a_503_and_the_reservation_comes_back(tmp_path, monkeypatch):
    monkeypatch.setattr(gridprice, "QLOO_TIMEOUT_SECONDS", 0.05)
    fake = FakeQloo(delay=1.0)
    qloo = fake.client()
    serve(tmp_path, qloo, counting_limiter(), price_grid_enabled=True)
    names = LIVE_NAMES[:4]
    with TestClient(app) as client:
        response = price(client, names, [names[:2]], mode="live")
    assert response.status_code == 503 and code(response) == "no_answer" and qloo._reserved == 0


def test_below_the_floor_live_is_paused_before_the_limiter_and_costs_nothing(tmp_path):
    fake = FakeQloo()
    qloo = fake.client()
    qloo.month_remaining = 1500 + 12  # the floor plus 12: an answer needing 13 is paused
    serve(tmp_path, qloo, NoLimiter(), price_grid_enabled=True, qloo_quota_floor=1500)
    names = LIVE_NAMES[:8]
    pairs = [[names[0], names[1]], [names[2], names[3]], [names[0], names[4]]]
    with TestClient(app) as client:
        response = price(client, names, pairs, mode="live")
    assert response.status_code == 503 and no_store(response)
    assert code(response) == "paused" and fake.seen == [] and qloo._reserved == 0


def test_the_caps_refuse_before_qloo_with_the_stated_message_and_give_the_reservation_back(tmp_path):
    fake = FakeQloo()
    qloo = fake.client()
    limiter = RunLimiter(1, 2, 4, messages=PRICE_GRID_MESSAGES)
    serve(tmp_path, qloo, limiter, price_grid_enabled=True)
    names = LIVE_NAMES[:4]
    with TestClient(app) as client:
        first = price(client, names, [names[:2]], mode="live")
        sent = len(fake.seen)
        second = price(client, names, [names[:2]], mode="live")
    assert first.status_code == 200 and sent == 6
    assert second.status_code == 429 and no_store(second) and len(fake.seen) == sent
    assert second.json()["detail"] == {"code": "limit", "message": PRICE_GRID_MESSAGES.hour}
    assert qloo._reserved == 0
    assert (
        PRICE_GRID_MESSAGES.day
        == PRICE_GRID_MESSAGES.global_day
        == (
            "Live pricing has reached today's limit. Your rule results are unchanged, and a saved day prices "
            "without a limit."
        )
    )
    everyone = RunLimiter(10, 10, 0, messages=PRICE_GRID_MESSAGES)
    app.dependency_overrides[get_price_grid_limiter] = lambda: everyone
    with TestClient(app) as client:
        third = price(client, names, [names[:2]], mode="live")
    assert third.json()["detail"]["message"] == PRICE_GRID_MESSAGES.global_day and qloo._reserved == 0


def test_the_shared_limiter_uses_the_price_grid_settings(monkeypatch):
    from app import deps

    monkeypatch.setattr(deps, "_price_grid_limiter", None)
    monkeypatch.setattr(deps, "get_settings", lambda: Settings(_env_file=None))
    limiter = deps.get_price_grid_limiter()
    assert (limiter.per_hour, limiter.per_day, limiter.global_per_day) == (1, 2, 4)
    assert limiter.messages is PRICE_GRID_MESSAGES
    assert deps.get_price_grid_limiter() is limiter


def test_need_is_at_most_35():
    acts = [f"Act {n}" for n in range(25)]
    pairs = [(acts[2 * n], acts[2 * n + 1]) for n in range(5)]
    assert gridprice.need_for(acts, pairs) == 35 == gridprice.MAX_NEED


# ----------------------------------------------------------------------------------------- the logs


def test_no_name_reaches_any_log_on_any_path(tmp_path, caplog):
    preset_names = scored_names(invented(), 6)
    fake = FakeQloo()
    qloo = fake.client()
    serve(tmp_path, qloo, counting_limiter(), price_grid_enabled=True)
    with caplog.at_level(logging.DEBUG), TestClient(app) as client:
        assert price(client, preset_names, [preset_names[:2]]).status_code == 200
        assert price(client, LIVE_NAMES, [LIVE_NAMES[:2]]).status_code == 422  # not a saved day
        assert price(client, LIVE_NAMES, [LIVE_NAMES[:2]], mode="live").status_code == 200
        fake.fail = "/v2/insights"
        assert price(client, LIVE_NAMES, [LIVE_NAMES[:2]], mode="live").status_code == 503
    text = "\n".join(record.getMessage() for record in caplog.records)
    assert any(record.name == "app.gridprice" for record in caplog.records)
    for name in preset_names + LIVE_NAMES:
        assert name not in text, name
        assert str(httpx.QueryParams({"query": name})).split("=", 1)[1] not in text, name  # as a URL holds it
