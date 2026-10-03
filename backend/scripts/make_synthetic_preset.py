"""Write the built-in synthetic day to a JSON file, to read it or to serve it as a preset.

From ``backend/``::

    uv run python scripts/make_synthetic_preset.py --out presets/00-synthetic.json

You do not need this to run the app: with no preset built, the API serves this same day from memory. The
file holds invented acts, times, popularity values and affinities, and no Qloo data. Do not put it in a
presets folder next to real presets unless you want it listed first.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.presets import Preset, build_synthetic_preset  # noqa: E402


def build_preset(*, seed: int = 7, acts: int = 24) -> Preset:
    """The synthetic preset the API serves when no preset was built."""
    return build_synthetic_preset(seed=seed, acts=acts)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True, help="output JSON file")
    parser.add_argument("--seed", type=int, default=7, help="repeatable synthetic festival seed")
    parser.add_argument("--acts", type=int, default=24, help="number of invented acts (4-120)")
    args = parser.parse_args()
    preset = build_preset(seed=args.seed, acts=args.acts)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(preset.model_dump(mode="json"), indent=2) + "\n", encoding="utf-8")
    print(f"Wrote synthetic preset to {args.out}")


if __name__ == "__main__":
    main()
