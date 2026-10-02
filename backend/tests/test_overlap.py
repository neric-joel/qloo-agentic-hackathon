import httpx

from app.qloo.client import QlooClient
from app.qloo.overlap import (
    CONTROL_ARTISTS,
    _billing_parts,
    _normalize,
    _percentiles,
    build_overlap,
    resolve_acts,
)

CLUSTERS = {"Indie A": "indie", "Indie B": "indie", "Electro C": "electro", "Electro D": "electro"}


def fake_qloo(cluster_of, control_affinity=0.05, missing=()):
    calls = {"insights": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        params = request.url.params
        if request.url.path == "/search":
            name = params["query"]
            if name in missing:
                return httpx.Response(200, json={"results": []})
            return httpx.Response(
                200, json={"results": [{"name": name, "entity_id": f"id:{name}", "popularity": 0.8}]}
            )
        calls["insights"] += 1
        signal = params["signal.interests.entities"].removeprefix("id:")
        entities = []
        for cid in params["filter.results.entities"].split(","):
            name = cid.removeprefix("id:")
            if name in CONTROL_ARTISTS:
                affinity = control_affinity
            else:
                affinity = 0.9 if cluster_of(name) == cluster_of(signal) else 0.3
            entities.append({"entity_id": cid, "name": name, "query": {"affinity": affinity}})
        return httpx.Response(200, json={"results": {"entities": entities}})

    return QlooClient("k", backoff=0, max_rps=None, transport=httpx.MockTransport(handler)), calls


async def test_overlap_is_symmetric_and_follows_shared_audiences():
    client, _ = fake_qloo(CLUSTERS.get)
    result = await build_overlap(client, list(CLUSTERS), city="San Francisco")
    v = result.values
    assert v["Indie A"]["Indie B"] == v["Indie B"]["Indie A"]
    assert v["Indie A"]["Indie B"] > v["Indie A"]["Electro C"]
    assert result.discriminates is True
    assert result.control_rank is not None and result.control_rank <= 0.35
    assert all(a.coverage == "strong" for a in result.acts)
    await client.aclose()


async def test_missing_acts_are_left_out_not_scored_zero():
    client, _ = fake_qloo(CLUSTERS.get, missing={"Electro D"})
    result = await build_overlap(client, list(CLUSTERS))
    assert "Electro D" not in result.values
    assert any("Electro D" in note for note in result.notes)
    await client.aclose()


async def test_flags_when_controls_do_not_rank_low():
    client, _ = fake_qloo(CLUSTERS.get, control_affinity=0.95)
    result = await build_overlap(client, list(CLUSTERS))
    assert result.discriminates is False
    assert any("Control acts" in note for note in result.notes)
    await client.aclose()


async def test_large_lineups_are_scored_in_chunks():
    names = [f"Act {i}" for i in range(60)]
    client, calls = fake_qloo(lambda n: "x" if n.endswith(("1", "3", "5")) else "y")
    result = await build_overlap(client, names)
    # 60 acts + 4 controls as candidates -> 63 candidates per row -> 2 shortlist calls per act
    assert calls["insights"] == 120
    assert len(result.values["Act 0"]) == 59
    await client.aclose()


def test_percentiles_handle_ties_and_single_values():
    assert _percentiles({}) == {}
    assert _percentiles({"a": 0.5}) == {"a": 1.0}
    ranks = _percentiles({"a": 0.1, "b": 0.5, "c": 0.5, "d": 0.9})
    assert ranks == {"a": 0.0, "b": 0.5, "c": 0.5, "d": 1.0}


def search_only(results_by_query):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": results_by_query.get(request.url.params["query"], [])})

    return QlooClient("k", backoff=0, max_rps=None, transport=httpx.MockTransport(handler))


async def test_resolution_rejects_a_similar_but_different_name():
    client = search_only({"Sienna Spiro": [{"name": "Sienna Skies", "entity_id": "x", "popularity": 0.96}]})
    [act] = await resolve_acts(client, ["Sienna Spiro"])
    assert act.entity_id is None and act.coverage == "none"
    assert act.alternatives == ["Sienna Skies"]
    await client.aclose()


async def test_resolution_prefers_an_exact_name_further_down_and_flags_twins():
    client = search_only(
        {
            "Momma": [
                {"name": "Mommy", "entity_id": "a", "popularity": 0.99},
                {
                    "name": "MOMMA",
                    "entity_id": "b",
                    "popularity": 0.9,
                    "tags": [{"type": "urn:tag:genre", "tag_id": "urn:tag:genre:indie"}],
                },
            ],
            "Geese": [
                {"name": "Geese", "entity_id": "g1", "popularity": 0.9},
                {"name": "Geese", "entity_id": "g2", "popularity": 0.4},
            ],
        }
    )
    momma, geese = await resolve_acts(client, ["Momma", "Geese"])
    assert (momma.entity_id, momma.coverage, momma.genres) == ("b", "strong", ["urn:tag:genre:indie"])
    assert (geese.entity_id, geese.coverage) == ("g1", "weak")
    await client.aclose()


def test_normalize_ignores_case_accents_punctuation_and_leading_the():
    assert _normalize("The Neighbourhood") == _normalize("neighbourhood")
    assert _normalize("RÜFÜS DU SOL") == "rufus du sol"
    assert _normalize("Sultan + Shepard") == "sultan shepard"
    assert _normalize("Simon & Garfunkel") == "simon and garfunkel"


def test_billing_parts_split_b2b_and_strip_set_labels():
    assert _billing_parts("Tinashe (DJ set)") == ["Tinashe"]
    assert _billing_parts("Armin van Buuren b2b Adam Beyer") == ["Armin van Buuren", "Adam Beyer"]
    assert _billing_parts("Afrojack x Shimza") == ["Afrojack", "Shimza"]
    assert _billing_parts("Sultan + Shepard") == []
    assert _billing_parts("Lil Nas X") == []


async def test_b2b_billing_is_scored_as_its_best_known_component():
    client = search_only(
        {
            "Prospa b2b Josh Baker": [{"name": "Chet Baker", "entity_id": "c", "popularity": 1.0}],
            "Prospa": [{"name": "Prospa", "entity_id": "p", "popularity": 0.7}],
            "Josh Baker": [{"name": "Josh Baker", "entity_id": "j", "popularity": 0.6}],
        }
    )
    [act] = await resolve_acts(client, ["Prospa b2b Josh Baker"])
    assert (act.entity_id, act.coverage, act.scored_as) == ("p", "weak", "Prospa")
    await client.aclose()
