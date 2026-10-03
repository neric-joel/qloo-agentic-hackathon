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
            assert one["festival"]["id"] and len(one["matrix"]["act_ids"]) == 12
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
