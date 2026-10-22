"""Add Qloo's matched name for each act to a saved preset, from the saved /search responses only.

    uv run python scripts/enrich_matched_names.py --cache <dir> <preset.json> [<preset.json> ...]

For every /search request the preset recorded, the saved response is read from ``--cache`` under the Qloo
client's own cache key (``app.qloo.client.request_key``). Nothing is fetched: there is no network call, no
Qloo key is read and no quota is spent. A missing or mismatched saved response stops the script with an error
and leaves the preset untouched.

Each act whose ``qloo_id`` is set gets the name Qloo returned for that entity id in its saved /search results
(for example "Patti Smith and Her Band" was matched as "Patti Smith"). The names go in one new top-level
field, ``matched_names`` ({act id: name}); no score, rank, date or other field is changed. The output holds
Qloo-derived data: keep it out of version control, like the preset itself.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.qloo.client import request_key  # noqa: E402

FIELD = "matched_names"


class EnrichError(RuntimeError):
    """A saved response is missing or does not match the recorded request."""


def _same(a: str, b: str) -> bool:
    return a.strip().lower() == b.strip().lower()


def _saved_search(cache: Path, record: dict[str, Any]) -> dict[str, Any]:
    path = record["path"]
    params = {str(k): str(v) for k, v in (record.get("params") or {}).items()}
    file = cache / f"{request_key(path, params)}.json"
    if not file.is_file():
        raise EnrichError(f"no saved response for {path} {params!r} (expected {file})")
    saved = json.loads(file.read_text(encoding="utf-8"))
    request = saved.get("request") or {}
    if request.get("path") != path or request.get("params") != params:
        raise EnrichError(f"{file} holds a different request than {path} {params!r}")
    response = saved.get("response")
    if not isinstance(response, dict):
        raise EnrichError(f"{file} holds no response")
    return response


def matched_names(preset: dict[str, Any], cache: Path) -> dict[str, str]:
    """{act id: the name Qloo returned for the act's entity id}, read from the saved /search responses."""
    searches: list[tuple[str, dict[str, str]]] = []  # (query, {entity id: name}) per recorded /search
    for record in preset.get("requests") or []:
        if not str(record.get("path", "")).endswith("/search"):
            continue
        response = _saved_search(cache, record)
        names = {
            str(item["entity_id"]): str(item["name"])
            for item in response.get("results") or []
            if isinstance(item, dict) and item.get("entity_id") and isinstance(item.get("name"), str)
        }
        searches.append((str((record.get("params") or {}).get("query", "")), names))

    out: dict[str, str] = {}
    for act in preset["festival"]["acts"]:
        entity = act.get("qloo_id")
        if not entity:
            continue
        # Prefer the search sent for this act's own name, then any saved search that returned the entity.
        own = [names for query, names in searches if _same(query, act["name"])]
        found = next((names[entity] for names in own if entity in names), None)
        if found is None:
            found = next((names[entity] for _, names in searches if entity in names), None)
        if found is None:
            raise EnrichError(f"no saved /search result holds {act['name']!r}'s entity {entity}")
        out[act["id"]] = found
    return out


def enrich(preset_file: Path, cache: Path) -> dict[str, str]:
    """Write ``matched_names`` into ``preset_file`` (keeping its line endings) and return it."""
    raw = preset_file.read_bytes().decode("utf-8")
    preset = json.loads(raw)
    names = matched_names(preset, cache)  # raises before anything is written
    preset[FIELD] = names
    text = json.dumps(preset, indent=1, ensure_ascii=False)
    if "\r\n" in raw:
        text = text.replace("\n", "\r\n")
    preset_file.write_bytes(text.encode("utf-8"))
    return names


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache", type=Path, required=True, help="directory of saved Qloo responses")
    ap.add_argument("presets", type=Path, nargs="+", help="preset JSON files, enriched in place")
    args = ap.parse_args(argv)
    if not args.cache.is_dir():
        raise EnrichError(f"no cache directory {args.cache}")
    for file in args.presets:
        names = enrich(file, args.cache)
        renamed = sum(
            1
            for act in json.loads(file.read_text(encoding="utf-8"))["festival"]["acts"]
            if act["id"] in names and not _same(act["name"], names[act["id"]])
        )
        print(f"{file.name}: {len(names)} matched names, {renamed} differ from the billed name")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
