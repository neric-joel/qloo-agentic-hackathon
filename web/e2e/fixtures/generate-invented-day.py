"""Writes the invented-day API answers that e2e/invented-day.spec.ts serves from fixtures.

The local API serves the invented example day (Lanternfield, synthetic: true) only when it has no built
festival days, and the suite runs against a server that has them. So the invented-day spec answers the
browser's /api requests from the files this script writes, taken from the backend's own generator
(seed 7, 24 acts). Nothing here calls Qloo or a language model: the invented day is made from a seed.

Run from the repository root with the backend's interpreter, only when the backend's contract changes:

    backend/.venv/Scripts/python.exe web/e2e/fixtures/generate-invented-day.py
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent / "invented-day"

# No presets folder, no keys, no model: the app then serves its invented day.
nowhere = tempfile.mkdtemp()
os.environ["PRESETS_DIR"] = os.path.join(nowhere, "none")
os.environ["RECORDINGS_DIR"] = os.path.join(nowhere, "none-recordings")
os.environ["QLOO_API_KEY"] = ""
os.environ["LLM_PROVIDER"] = "none"
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)


def get(path: str):
    response = client.get(path)
    response.raise_for_status()
    return response.json()


def write(name: str, value) -> None:
    (OUT / name).write_text(json.dumps(value, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


OUT.mkdir(parents=True, exist_ok=True)
days = get("/api/presets")
assert len(days) == 1 and days[0]["synthetic"] is True, days
pid = days[0]["id"]
preset = get(f"/api/presets/{pid}")
decision = get(f"/api/presets/{pid}/decision?day=0")
write("presets.json", days)
write("preset.json", preset)
write("decision.json", decision)
write("lenses.json", get(f"/api/presets/{pid}/lenses?day=0"))
write("recordings.json", get(f"/api/presets/{pid}/recordings"))

moves = {}
for act in preset["festival"]["acts"]:
    moves[act["id"]] = get(f"/api/presets/{pid}/moves?act={act['id']}&limit=8")
write("moves.json", moves)

# What "Keep this move" asks: the card's one move, priced with no set picked.
move = decision["move"]
step = {"act": move["act_id"], "stage_id": move["stage_id"], "day": move["day"], "start": move["start"]}
response = client.post(f"/api/presets/{pid}/whatif", json={"moves": [step], "act": None, "limit": 8})
response.raise_for_status()
write("whatif-card-move.json", {"step": step, "answer": response.json()})
print(f"wrote {len(list(OUT.iterdir()))} files to {OUT}")
