"""The invented day is reproducible, flagged, free of Qloo data, and the script writes the same day."""

import json

from app.presets import Preset, build_synthetic_preset, synthetic_presets
from scripts.make_synthetic_preset import build_preset


def test_keyless_preset_is_reproducible_and_explicitly_synthetic():
    first = build_preset()
    second = build_preset()

    assert first.model_dump(mode="json") == second.model_dump(mode="json")
    assert first.synthetic is True
    assert first.matrix.source == "synthetic"
    assert first.requests == [] and first.sources == [] and first.evidence is None
    assert all(act.qloo_id is None for act in first.festival.acts)
    assert len(first.festival.timetable) == 24
    assert first.report["clashes"]
    assert first.report["metrics"]["clash_budget_index"] is not None
    assert "synthetic" in first.title.lower()


def test_the_served_day_is_the_script_default_and_one_object():
    assert synthetic_presets() is synthetic_presets()
    (served,) = synthetic_presets().values()
    assert served.model_dump(mode="json") == build_synthetic_preset().model_dump(mode="json")


def test_the_written_file_loads_back_as_the_same_flagged_preset(tmp_path):
    generated = build_preset(acts=16)
    path = tmp_path / "00-synthetic.json"
    path.write_text(json.dumps(generated.model_dump(mode="json")), encoding="utf-8")
    loaded = Preset.model_validate(json.loads(path.read_text(encoding="utf-8")))
    assert loaded.id == generated.id and loaded.synthetic is True
    assert len(loaded.festival.timetable) == 16
