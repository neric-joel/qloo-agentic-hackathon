"""Recorded agent runs: real clash-agent streams saved per preset, replayed by the web app with no model call.

A recordings file is ``<recordings_dir>/<preset_id>.json`` holding ``{"preset_id": ..., "runs": [...]}``. Each
run keeps the events exactly as the backend streamed them, each with ``t``, the milliseconds since the run
started. Like presets, the files hold Qloo-derived data: they ship with the deployment, never with the
repository. A run that breaks the rules below is skipped with a warning and never served; a file that cannot
be read is skipped whole. Nothing here raises into a request.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from .config import Settings, get_settings
from .presets import CACHE_CONTROL, Presets

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/presets", tags=["presets"])

MAX_RUNS = 6
MAX_EVENTS = 400
MAX_RUN_BYTES = 200 * 1024
# A file bigger than every run at its limit is not read at all
MAX_FILE_BYTES = MAX_RUNS * MAX_RUN_BYTES + 64 * 1024


class TimedEvent(BaseModel):
    t: int = Field(ge=0, description="Milliseconds since the run started.")
    event: dict[str, Any] = Field(description="The event exactly as the backend streamed it.")

    @field_validator("event")
    @classmethod
    def _typed(cls, value: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(value.get("type"), str):
            raise ValueError("every event needs a string 'type'")
        return value


class Recording(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9-]{1,40}$")
    title: str = Field(min_length=1, max_length=90)
    question: str = Field(min_length=1, max_length=600)
    captured_at: str = Field(max_length=40, description="UTC capture time, ISO 8601.")
    model: str = Field(min_length=1, max_length=80)
    events: list[TimedEvent] = Field(min_length=2, max_length=MAX_EVENTS)

    @field_validator("captured_at")
    @classmethod
    def _iso_time(cls, value: str) -> str:
        datetime.fromisoformat(value)  # raises ValueError when it is not a time
        return value

    @model_validator(mode="after")
    def _complete_clash_run(self) -> Recording:
        types = [e.event["type"] for e in self.events]
        if types[0] != "run_started" or types[-1] != "run_finished":
            raise ValueError("a run must start with run_started and end with run_finished")
        if "error" in types:
            raise ValueError("a run with an error event is not served")
        results = [e.event for e in self.events if e.event["type"] == "result"]
        if len(results) != 1 or results[0].get("kind") != "clash":
            raise ValueError("a run needs exactly one result event, of kind clash")
        if any(later.t < earlier.t for earlier, later in zip(self.events, self.events[1:], strict=False)):
            raise ValueError("event times must not go backwards")
        size = len(json.dumps(self.model_dump(mode="json"), ensure_ascii=False, separators=(",", ":")).encode())
        if size > MAX_RUN_BYTES:
            raise ValueError(f"a run may be at most {MAX_RUN_BYTES // 1024} KB, this one is {size // 1024} KB")
        return self


class RecordingsFile(BaseModel):
    preset_id: str = Field(min_length=1, max_length=80)
    runs: list[Recording] = Field(max_length=MAX_RUNS)


def _first_error(exc: ValidationError) -> str:
    error = exc.errors()[0]
    where = ".".join(str(part) for part in error["loc"])
    message = str(error["msg"]).removeprefix("Value error, ")
    return f"{where}: {message}" if where else message


def _read(path: Path) -> list[Recording]:
    """The valid runs in one file; skips (and logs) each invalid run, or the whole file when it is unreadable."""
    if path.stat().st_size > MAX_FILE_BYTES:
        log.warning("Skipping recordings file %s: larger than %d bytes", path.name, MAX_FILE_BYTES)
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        log.warning("Skipping recordings file %s: %s", path.name, exc)
        return []
    if not isinstance(raw, dict) or raw.get("preset_id") != path.stem or not isinstance(raw.get("runs"), list):
        log.warning("Skipping recordings file %s: it needs preset_id %r and a runs list", path.name, path.stem)
        return []
    if len(raw["runs"]) > MAX_RUNS:
        log.warning("Skipping recordings file %s: more than %d runs", path.name, MAX_RUNS)
        return []
    runs: list[Recording] = []
    for index, item in enumerate(raw["runs"]):
        try:
            run = Recording.model_validate(item)
        except ValidationError as exc:
            log.warning("Skipping run %d in recordings file %s: %s", index, path.name, _first_error(exc))
            continue
        if any(r.id == run.id for r in runs):
            log.warning("Skipping run %d in recordings file %s: duplicate id %r", index, path.name, run.id)
            continue
        runs.append(run)
    return RecordingsFile(preset_id=path.stem, runs=runs).runs


@lru_cache(maxsize=2)
def load_recordings(directory: str) -> dict[str, list[Recording]]:
    """Every preset's valid recorded runs, keyed by preset id (the file name). Read once per directory."""
    recordings: dict[str, list[Recording]] = {}
    for path in sorted(Path(directory).glob("*.json")):
        try:
            runs = _read(path)
        except Exception:  # never let one bad file take the endpoint down
            log.warning("Skipping recordings file %s", path.name, exc_info=True)
            continue
        if runs:
            recordings[path.stem] = runs
    return recordings


def get_recordings(settings: Annotated[Settings, Depends(get_settings)]) -> dict[str, list[Recording]]:
    if settings.recordings_dir is None or not settings.recordings_dir.is_dir():
        return {}
    return load_recordings(str(settings.recordings_dir))


class RecordedRuns(BaseModel):
    runs: list[Recording]


@router.get("/{preset_id}/recordings", response_model=RecordedRuns)
def get_preset_recordings(
    preset_id: str,
    presets: Presets,
    recordings: Annotated[dict[str, list[Recording]], Depends(get_recordings)],
    response: Response,
) -> RecordedRuns:
    """Saved agent runs on a preset festival day, for replay; an empty list when the day has none."""
    if preset_id not in presets:
        raise HTTPException(status_code=404, detail=f"No preset {preset_id!r}.")
    response.headers["Cache-Control"] = CACHE_CONTROL
    return RecordedRuns(runs=recordings.get(preset_id, []))
