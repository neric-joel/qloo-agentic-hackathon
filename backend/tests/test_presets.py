import json
import logging

from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import app
from app.schedule.metrics import score_festival
from app.schedule.synthetic import synthetic_festival


def write_preset(directory, preset_id: str, title: str, *, days: int = 1) -> None:
    festival, matrix = synthetic_festival(3, days=days, acts=12 * days)
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


def test_no_presets_directory_serves_only_the_invented_day(tmp_path):
    try:
        with client_for(tmp_path / "absent") as client:
            listed = client.get("/api/presets").json()
            assert [p["id"] for p in listed] == ["synthetic-lanternfield-friday"]
            assert listed[0]["synthetic"] is True
    finally:
        app.dependency_overrides.clear()


def test_built_presets_replace_the_invented_day_and_are_not_flagged(tmp_path):
    write_preset(tmp_path, "a-day", "A Day")
    try:
        with client_for(tmp_path) as client:
            listed = client.get("/api/presets").json()
            assert [p["id"] for p in listed] == ["a-day"]
            assert listed[0]["synthetic"] is False
            assert client.get("/api/presets/a-day").json()["synthetic"] is False
            assert client.get("/api/presets/synthetic-lanternfield-friday").status_code == 404
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


def test_a_preset_says_where_its_rankings_were_located_or_null_for_a_global_reading(tmp_path):
    write_preset(tmp_path, "global-day", "Global Day")  # built before the field: no location key
    write_preset(tmp_path, "local-day", "Local Day")
    raw = json.loads((tmp_path / "local-day.json").read_text(encoding="utf-8"))
    raw["location"] = "Lantern City"
    (tmp_path / "local-day.json").write_text(json.dumps(raw), encoding="utf-8")
    try:
        with client_for(tmp_path) as client:
            global_day = client.get("/api/presets/global-day").json()
            local_day = client.get("/api/presets/local-day").json()
    finally:
        app.dependency_overrides.clear()
    assert global_day["location"] is None
    assert local_day["location"] == "Lantern City"
    assert "matrix" not in local_day


INVENTED_ID = "synthetic-lanternfield-friday"


def first_day(body: dict) -> int:
    return min(slot["day"] for slot in body["festival"]["timetable"])


def test_the_invented_day_carries_its_decision_as_the_decision_route_answers_it(tmp_path):
    try:
        with client_for(tmp_path / "absent") as client:
            served = client.get(f"/api/presets/{INVENTED_ID}")
            worked = client.get(f"/api/presets/{INVENTED_ID}/decision")
    finally:
        app.dependency_overrides.clear()
    assert served.status_code == 200 and worked.status_code == 200
    body = served.json()
    assert body["synthetic"] is True and "matrix" not in body
    assert body["decision"] == worked.json()
    assert body["decision"]["kind"] == "decision" and body["decision"]["day"] == first_day(body)
    assert body["decision"]["clash"] is not None and body["decision"]["move"] is not None


def test_a_built_preset_carries_the_decision_of_its_lowest_day_with_sets(tmp_path):
    write_preset(tmp_path, "one-day", "One Day")
    write_preset(tmp_path, "two-days", "Two Days", days=2)
    try:
        with client_for(tmp_path) as client:
            one = client.get("/api/presets/one-day").json()
            one_worked = client.get("/api/presets/one-day/decision").json()
            two = client.get("/api/presets/two-days").json()
            days = sorted({slot["day"] for slot in two["festival"]["timetable"]})
            by_default = client.get("/api/presets/two-days/decision").json()
            lowest = client.get("/api/presets/two-days/decision", params={"day": days[0]}).json()
            highest = client.get("/api/presets/two-days/decision", params={"day": days[-1]}).json()
    finally:
        app.dependency_overrides.clear()
    assert "matrix" not in one and "matrix" not in two
    assert one["decision"] == one_worked and one["decision"]["day"] == first_day(one)
    assert len(days) == 2
    assert two["decision"] == by_default == lowest
    assert two["decision"]["day"] == days[0] and highest["day"] == days[-1]
    assert two["decision"] != highest  # the field is the lowest day's answer, not any day's


def test_a_second_preset_request_reads_the_decision_from_the_engines_cache(tmp_path, monkeypatch):
    import app.decision as engine

    computed: list[int] = []
    compute = engine.compute_decision

    def counting(preset, day):
        if preset.id == "cached-day":
            computed.append(day)
        return compute(preset, day)

    monkeypatch.setattr(engine, "compute_decision", counting)
    write_preset(tmp_path, "cached-day", "Cached Day")
    try:
        client = client_for(tmp_path)  # no startup warm: the first request computes, as on a cold cache
        first = client.get("/api/presets/cached-day").json()
        second = client.get("/api/presets/cached-day").json()
        worked = client.get("/api/presets/cached-day/decision").json()
    finally:
        app.dependency_overrides.clear()
    assert computed == [first_day(first)]  # once, for the first day with sets
    assert first["decision"] == second["decision"] == worked


def test_the_startup_warm_fills_the_cache_the_preset_response_reads(tmp_path, monkeypatch):
    import app.decision as engine

    computed: list[int] = []
    compute = engine.compute_decision

    def counting(preset, day):
        if preset.id == "warm-day":
            computed.append(day)
        return compute(preset, day)

    monkeypatch.setattr(engine, "compute_decision", counting)
    write_preset(tmp_path, "warm-day", "Warm Day")
    try:
        with client_for(tmp_path) as client:  # the lifespan warms every preset day first
            assert len(computed) == 1
            served = client.get("/api/presets/warm-day").json()
            again = client.get("/api/presets/warm-day").json()
    finally:
        app.dependency_overrides.clear()
    assert len(computed) == 1 and served["decision"] == again["decision"]
    assert served["decision"]["day"] == computed[0] == first_day(served)


def test_a_preset_whose_engine_fails_is_served_with_a_null_decision(tmp_path, monkeypatch, caplog):
    import app.decision as engine

    def failing(preset, day):
        raise RuntimeError("engine failed")

    monkeypatch.setattr(engine, "compute_decision", failing)
    write_preset(tmp_path, "broken-day", "Broken Day")
    try:
        client = client_for(tmp_path)
        with caplog.at_level(logging.ERROR, logger="app.presets"):
            response = client.get("/api/presets/broken-day")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    body = response.json()
    assert "decision" in body and body["decision"] is None
    assert body["id"] == "broken-day" and len(body["festival"]["timetable"]) == 12 and "matrix" not in body
    assert response.headers["cache-control"].startswith("public, s-maxage=")
    failed = [r for r in caplog.records if r.name == "app.presets" and r.levelno == logging.ERROR]
    assert len(failed) == 1 and failed[0].exc_info and "broken-day" in failed[0].getMessage()


def test_a_preset_with_no_day_of_sets_is_served_with_a_null_decision(tmp_path):
    write_preset(tmp_path, "empty-day", "Empty Day")
    raw = json.loads((tmp_path / "empty-day.json").read_text(encoding="utf-8"))
    raw["festival"]["timetable"] = []
    (tmp_path / "empty-day.json").write_text(json.dumps(raw), encoding="utf-8")
    try:
        client = client_for(tmp_path)
        response = client.get("/api/presets/empty-day")
        worked = client.get("/api/presets/empty-day/decision")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200 and response.json()["decision"] is None
    assert worked.status_code == 422  # the decision route has no day to answer for either
