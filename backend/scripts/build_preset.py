"""Build a demo preset: one day of a published timetable, scored with Qloo audience overlap.

    uv run python scripts/build_preset.py glastonbury-2025 Sun --stages main --cache <dir> --out <file>

``--stages main`` keeps the main-tier stages; a comma list picks stages by id. Qloo responses are read from
and saved to ``--cache`` first, so rebuilding a preset spends no quota. The output holds Qloo-derived data:
keep it out of version control.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings  # noqa: E402
from app.lineups.overlap_matrix import qloo_overlap  # noqa: E402
from app.lineups.timetable import PublishedTimetable, to_festival  # noqa: E402
from app.qloo.client import QlooClient, record_requests  # noqa: E402
from app.schedule.metrics import score_festival  # noqa: E402

DATA = Path(__file__).resolve().parents[1] / "app" / "lineups" / "data"


def load_timetable(festival_id: str) -> PublishedTimetable:
    path = DATA / f"{festival_id}.json"
    if not path.exists():
        known = ", ".join(p.stem for p in sorted(DATA.glob("*.json")))
        raise SystemExit(f"unknown festival {festival_id!r}; known: {known}")
    return PublishedTimetable.model_validate_json(path.read_text(encoding="utf-8"))


async def build(args: argparse.Namespace) -> dict:
    timetable = load_timetable(args.festival)
    if args.stages == "main":
        stage_ids = [s.id for s in timetable.stages if s.tier == "main"]
    elif args.stages:
        stage_ids = [s.strip() for s in args.stages.split(",")]
    else:
        stage_ids = None
    festival = to_festival(timetable, args.day, stage_ids=stage_ids, start_after=args.start_after)

    settings = get_settings()
    client = QlooClient(
        settings.qloo_api_key,
        settings.qloo_base_url,
        timeout=40,
        fixtures_dir=args.cache,
        record_fixtures=True,
        fixtures_first=True,
    )
    with record_requests() as log:
        festival, matrix, result = await qloo_overlap(client, festival)
    await client.aclose()

    report = score_festival(festival, matrix)
    live = sum(1 for r in log if not r.cached)
    print(f"{festival.name}: {len(festival.acts)} sets, coverage {report.coverage.model_dump()}")
    print(f"Qloo requests: {len(log)} ({live} live)")
    return {
        "id": args.id or festival.id,
        "title": args.title or festival.name,
        "built_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "festival": festival.model_dump(mode="json"),
        "matrix": matrix.model_dump(mode="json"),
        "report": report.model_dump(mode="json"),
        "overlap_notes": result.notes,
        "discriminates": result.discriminates,
        "requests": [
            {"path": r.path, "params": r.params, "status": r.status, "cached": r.cached, "request_id": r.request_id}
            for r in log
        ],
        "sources": [s for s in json.loads((DATA / f"{args.festival}.json").read_text(encoding="utf-8"))["sources"]],
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("festival")
    ap.add_argument("day")
    ap.add_argument("--stages", default=None, help="'main' or a comma list of stage ids (default: non-minor)")
    ap.add_argument("--start-after", default=None, help="drop sets starting before HH:MM")
    ap.add_argument("--id")
    ap.add_argument("--title")
    ap.add_argument("--cache", type=Path, required=True, help="directory for saved Qloo responses")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    preset = asyncio.run(build(args))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(preset, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
