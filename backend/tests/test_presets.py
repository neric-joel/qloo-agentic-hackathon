import json

from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import app
from app.schedule.metrics import score_festival
from app.schedule.synthetic import synthetic_festival


def write_preset(directory, preset_id: str, title: str) -> None:
    festival, matrix = synthetic_festival(3, days=1, acts=12)
    report = score_festival(festival, matrix)
    preset = {
        "id": preset_id,
        "title": title,
        "festival": festival.model_dump(mode="json"),
        "matrix": matrix.model_dump(mode="json"),
        "report": report.model_dump(mode="json"),
        "requests": [{"path": "/v2/insights", "params": {"take": "5"}, "status": 200, "cached": True}],
    }
    (directory / f"{preset_id}.json").write_text(json.dumps(preset), encoding="utf-8")


def client_for(directory) -> TestClient:
    app.dependency_overrides[get_settings] = lambda: Settings(presets_dir=directory, _env_file=None)
    return TestClient(app)


def test_lists_and_serves_presets(tmp_path):
    write_preset(tmp_path, "a-day", "A Day")
    write_preset(tmp_path, "b-day", "B Day")
    try:
        with client_for(tmp_path) as client:
            response = client.get("/api/presets")
            assert response.headers["cache-control"].startswith("public, s-maxage=")
            listed = response.json()
            assert [p["id"] for p in listed] == ["a-day", "b-day"]
            assert listed[0]["sets"] == 12 and listed[0]["title"] == "A Day"
            assert 0 < listed[0]["scored_share"] <= 1

            one = client.get("/api/presets/b-day").json()
            assert one["festival"]["id"] and len(one["festival"]["acts"]) == 12
            assert "matrix" not in one  # the overlap matrix stays on the server
            assert one["requests"][0]["path"] == "/v2/insights"
            assert client.get("/api/presets/missing").status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_no_presets_directory_means_an_empty_list(tmp_path):
    try:
        with client_for(tmp_path / "absent") as client:
            assert client.get("/api/presets").json() == []
    finally:
        app.dependency_overrides.clear()


def decimals_of(value: float) -> int:
    text = repr(value)
    return len(text.split(".")[1]) if "." in text and "e" not in text else 99


def test_served_popularity_is_rounded_but_the_engine_keeps_the_full_value(tmp_path):
    from app.presets import POPULARITY_DECIMALS, get_presets, public_copy
    from app.runs import published_state

    write_preset(tmp_path, "a-day", "A Day")
    path = tmp_path / "a-day.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    for n, act in enumerate(data["festival"]["acts"]):  # unrounded values, as Qloo returns them
        act["popularity"] = (n + 1) / 13 + 1e-7 * n
    data["festival"]["acts"][0]["popularity"] = 0.8146694960713334  # 81.467: three decimals would print 82
    path.write_text(json.dumps(data), encoding="utf-8")
    settings = Settings(presets_dir=tmp_path, _env_file=None)
    loaded = get_presets(settings)["a-day"]
    originals = {act.id: act.popularity for act in loaded.festival.acts}
    assert any(p is not None and decimals_of(p) > POPULARITY_DECIMALS for p in originals.values())
    try:
        with client_for(tmp_path) as client:
            served = client.get("/api/presets/a-day").json()
    finally:
        app.dependency_overrides.clear()
    popularity = [a["popularity"] for a in served["festival"]["acts"] if a["popularity"] is not None]
    assert popularity and all(decimals_of(p) <= POPULARITY_DECIMALS for p in popularity)
    # What the page prints (a whole number out of 100) does not move
    for act in served["festival"]["acts"]:
        original = originals[act["id"]]
        assert (act["popularity"] is None) == (original is None)
        if original is not None:
            assert abs(act["popularity"] - original) <= 0.5 * 10**-POPULARITY_DECIMALS
            assert round(act["popularity"] * 100) == round(original * 100)

    # The engine reads the loaded preset: same object, same values, same matrix, same prices
    state = published_state(loaded)
    assert state["festival"] is loaded.festival
    assert {act.id: act.popularity for act in state["festival"].acts} == originals
    public = public_copy(loaded)
    assert public is not loaded and public_copy(loaded) is public  # built once per preset object
    assert public.matrix is loaded.matrix and public.report == loaded.report
    assert {act.id: act.popularity for act in loaded.festival.acts} == originals
    assert public_copy(loaded.model_copy()) is not public  # a reloaded preset gets its own copy


def test_an_act_without_popularity_stays_without(tmp_path):
    from app.presets import get_presets, public_copy

    write_preset(tmp_path, "a-day", "A Day")
    loaded = get_presets(Settings(presets_dir=tmp_path, _env_file=None))["a-day"]
    acts = [loaded.festival.acts[0].model_copy(update={"popularity": None}), *loaded.festival.acts[1:]]
    bare = loaded.model_copy(update={"festival": loaded.festival.model_copy(update={"acts": acts})})
    assert public_copy(bare).festival.acts[0].popularity is None
