"""The matched-name enrichment, on a small invented preset and cache: no request leaves the test.

Every act, entity id and name here is invented. The script reads saved /search responses by the Qloo client's
cache key, adds only ``matched_names`` and stops, writing nothing, when a saved response is missing."""

import copy
import importlib.util
import json
import socket
from pathlib import Path

import pytest

from app.presets import Preset, build_synthetic_preset, public_copy
from app.qloo.client import request_key

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "enrich_matched_names.py"


def load_script():
    spec = importlib.util.spec_from_file_location("enrich_matched_names_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def search(query: str) -> dict:
    return {
        "path": "/search",
        "params": {"query": query, "types": "urn:entity:artist", "take": "3"},
        "status": 200,
        "cached": True,
        "request_id": None,
    }


PRESET = {
    "id": "invented-day",
    "title": "Invented Day",
    "built_at": "2026-10-03T00:13:52+00:00",
    "festival": {
        "acts": [
            {
                "id": "lantern-and-her-band",
                "name": "Lantern and Her Band",
                "qloo_id": "E-1",
                "popularity": 0.5,
            },
            {"id": "moth-choir", "name": "Moth Choir", "qloo_id": "E-2", "popularity": 0.25},
            {"id": "no-signal", "name": "No Signal", "qloo_id": None, "popularity": None},
        ]
    },
    "report": {"metrics": {"regret": 1.5}},
    "requests": [
        search("Lantern and Her Band"),
        search("Moth Choir"),
        search("No Signal"),
        {
            "path": "/v2/insights",
            "params": {"signal.interests.entities": "E-1"},
            "status": 200,
            "cached": True,
        },
    ],
}

RESULTS = {
    "Lantern and Her Band": [
        {"name": "Lantern Band Tribute", "entity_id": "E-9"},
        {"name": "Lantern", "entity_id": "E-1"},
    ],
    "Moth Choir": [{"name": "Moth Choir", "entity_id": "E-2"}],
    "No Signal": [],
}


def write_cache(cache: Path, skip: str | None = None) -> None:
    cache.mkdir(parents=True, exist_ok=True)
    for record in PRESET["requests"]:
        if record["path"] != "/search" or record["params"]["query"] == skip:
            continue
        body = {
            "request": {"path": "/search", "params": record["params"]},
            "response": {"results": RESULTS[record["params"]["query"]]},
        }
        (cache / f"{request_key('/search', record['params'])}.json").write_text(
            json.dumps(body), encoding="utf-8"
        )


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("the enrichment opened a network connection")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.delenv("QLOO_API_KEY", raising=False)


def test_adds_only_the_matched_names(tmp_path):
    cache, file = tmp_path / "cache", tmp_path / "preset.json"
    write_cache(cache)
    file.write_bytes(json.dumps(PRESET, indent=1).replace("\n", "\r\n").encode("utf-8"))

    names = load_script().enrich(file, cache)

    assert names == {"lantern-and-her-band": "Lantern", "moth-choir": "Moth Choir"}
    raw = file.read_bytes().decode("utf-8")
    assert "\r\n" in raw and "\n" not in raw.replace("\r\n", "")  # line endings kept
    after = json.loads(raw)
    assert after.pop("matched_names") == names
    assert after == PRESET  # every score, rank, date and other field as it was


def test_a_missing_saved_response_fails_and_writes_nothing(tmp_path):
    cache, file = tmp_path / "cache", tmp_path / "preset.json"
    write_cache(cache, skip="Moth Choir")
    before = json.dumps(PRESET, indent=1)
    file.write_text(before, encoding="utf-8")
    script = load_script()

    with pytest.raises(script.EnrichError, match="no saved response"):
        script.enrich(file, cache)
    assert file.read_text(encoding="utf-8") == before


def test_an_entity_no_saved_search_returned_fails(tmp_path):
    cache, file = tmp_path / "cache", tmp_path / "preset.json"
    write_cache(cache)
    preset = copy.deepcopy(PRESET)
    preset["festival"]["acts"][1]["qloo_id"] = "E-404"
    file.write_text(json.dumps(preset), encoding="utf-8")
    script = load_script()

    with pytest.raises(script.EnrichError, match="E-404"):
        script.enrich(file, cache)


def test_the_served_preset_carries_the_names():
    base = build_synthetic_preset()
    assert base.matched_names == {}
    act = base.festival.acts[0]
    enriched = Preset.model_validate({**base.model_dump(mode="json"), "matched_names": {act.id: "Qloo Name"}})
    assert public_copy(enriched).model_dump(mode="json")["matched_names"] == {act.id: "Qloo Name"}
