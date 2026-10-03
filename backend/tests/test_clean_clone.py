"""A fresh clone has no .env and no presets folder: every public route must still answer, with no Qloo call.

Settings come from their defaults (no env file, no key), the presets directory is missing or empty, and Qloo
is replaced by an object that raises on any use.
"""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.deps import get_qloo
from app.main import app
from app.presets import synthetic_presets

SYNTHETIC_ID = "synthetic-lanternfield-friday"


class NoQloo:
    """Stands in for the Qloo client: any attribute use fails the test."""

    def __getattr__(self, name: str):
        raise AssertionError(f"Qloo was used ({name}) on a clean clone")


@pytest.fixture(params=["missing", "empty"])
def clone(request, tmp_path):
    presets = tmp_path / "presets"
    if request.param == "empty":
        presets.mkdir()
    settings = Settings(_env_file=None, presets_dir=presets, recordings_dir=presets / "recordings")
    assert settings.qloo_api_key is None and settings.llm_provider == "none"
    assert settings.pair_check_enabled is False
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_qloo] = lambda: NoQloo()
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()


def test_the_list_and_the_preset_are_the_flagged_invented_day(clone):
    listed = clone.get("/api/presets")
    assert listed.status_code == 200
    assert [p["id"] for p in listed.json()] == [SYNTHETIC_ID]
    assert listed.json()[0]["synthetic"] is True

    served = clone.get(f"/api/presets/{SYNTHETIC_ID}")
    assert served.status_code == 200
    body = served.json()
    assert body["synthetic"] is True
    assert body["requests"] == [] and body["sources"] == [] and body["built_at"] is None
    assert "matrix" not in body
    assert body["report"]["metrics"]["clash_budget_index"] is not None
    assert "Synthetic example day" in " ".join(body["overlap_notes"])
    assert clone.get("/api/presets/glastonbury-2025-sun").status_code == 404


def test_the_invented_day_holds_no_qloo_data():
    preset = synthetic_presets()[SYNTHETIC_ID]
    assert preset.synthetic and preset.matrix.source == "synthetic"
    assert all(act.qloo_id is None for act in preset.festival.acts)
    assert preset.requests == [] and preset.sources == [] and preset.evidence is None
    assert preset.festival.name.endswith("(synthetic)")


def test_every_read_route_answers_on_it(clone):
    base = f"/api/presets/{SYNTHETIC_ID}"
    assert clone.get(f"{base}/recordings").json() == {"runs": []}

    lenses = clone.get(f"{base}/lenses")
    assert lenses.status_code == 200 and lenses.json()["kind"]

    decision = clone.get(f"{base}/decision")
    assert decision.status_code == 200
    worked = decision.json()
    assert worked["kind"] == "decision" and worked["move"] is not None

    rule = worked["rule"]
    a, b = rule["a"]["act_id"], rule["b"]["act_id"]
    fixes = clone.get(f"{base}/rule-fixes", params={"a": a, "b": b, "limit": 3})
    assert fixes.status_code == 200
    assert fixes.json()["a"]["act_id"] == a and len(fixes.json()["fixes"]) <= 3

    act = worked["move"]["act_id"]
    moves = clone.get(f"{base}/moves", params={"act": act, "limit": 4})
    assert moves.status_code == 200 and moves.json()["kind"] == "move_options"


def test_the_plan_route_prices_a_move_and_a_kept_rule_change(clone):
    base = f"/api/presets/{SYNTHETIC_ID}"
    worked = clone.get(f"{base}/decision").json()
    move = worked["move"]
    step = {"act": move["act_id"], "stage_id": move["stage_id"], "day": move["day"], "start": move["start"]}

    empty = clone.post(f"{base}/whatif", json={"moves": []})
    assert empty.status_code == 200
    published = empty.json()["published_budget"]
    assert empty.json()["plan"]["steps"] == []

    priced = clone.post(f"{base}/whatif", json={"moves": [step]})
    assert priced.status_code == 200
    assert priced.json()["plan"]["steps"][0]["budget_after"] == move["budget_after"]
    assert priced.json()["published_budget"] == published

    rule = worked["rule"]
    fix = rule["fixes"][0]
    kept = {
        "rule": {"a": rule["a"]["act_id"], "b": rule["b"]["act_id"]},
        "moves": [
            {"act": m["act_id"], "stage_id": m["stage_id"], "day": m["day"], "start": m["start"]}
            for m in fix["moves"]
        ],
    }
    ruled = clone.post(f"{base}/whatif", json={"moves": [kept]})
    assert ruled.status_code == 200
    assert ruled.json()["plan"]["steps"][0]["rule_holds_after"] is True


def test_the_live_routes_stay_off_without_keys(clone):
    health = clone.get("/api/health").json()
    assert health["qloo_key_configured"] is False and health["llm_configured"] is False
    assert health["pair_check"] is False
    pair = clone.post("/api/pair", json={"preset": SYNTHETIC_ID, "a": "act-01", "b": "act-02"})
    assert pair.status_code == 503
    run = clone.post(
        "/api/runs", json={"input": {"scenario": "clash", "preset_id": SYNTHETIC_ID, "message": "hi"}}
    )
    assert run.status_code in (422, 503)
