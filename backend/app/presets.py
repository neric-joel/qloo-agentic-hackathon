"""Demo presets: real festival days scored ahead of time, served without spending Qloo quota.

Presets are built by ``scripts/build_preset.py`` into ``backend/presets/`` (or ``PRESETS_DIR``). They hold
Qloo-derived data, so that folder is git-ignored: it ships with the deployment, never with the repository.
"""

from __future__ import annotations

import json
import threading
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from .config import Settings, get_settings
from .schedule.models import Festival, OverlapMatrix

router = APIRouter(prefix="/api/presets", tags=["presets"])

# Presets change only on redeploy, so let the CDN serve them.
CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400"
# Decimals of Qloo popularity in the served copy. The page prints it as a whole number out of 100; at 3
# decimals one saved act would round to a different whole number (round-5 parity check), so 4.
POPULARITY_DECIMALS = 4


class PresetSummary(BaseModel):
    id: str
    title: str
    city: str | None
    sets: int
    stages: int
    scored_share: float | None


class Preset(BaseModel):
    id: str
    title: str
    built_at: str | None = None
    festival: Festival
    matrix: OverlapMatrix
    report: dict[str, Any]
    requests: list[dict[str, Any]] = []
    sources: list[dict[str, Any]] = []
    overlap_notes: list[str] = []
    evidence: dict[str, Any] | None = Field(
        default=None, description="Sourced examples: hidden-clash wall, clash receipts, same-size twins."
    )


@lru_cache(maxsize=4)
def _load_all(directory: str) -> dict[str, Preset]:
    presets: dict[str, Preset] = {}
    for path in sorted(Path(directory).glob("*.json")):
        preset = Preset.model_validate(json.loads(path.read_text(encoding="utf-8")))
        presets[preset.id] = preset
    return presets


def get_presets(settings: Annotated[Settings, Depends(get_settings)]) -> dict[str, Preset]:
    if settings.presets_dir is None or not settings.presets_dir.is_dir():
        return {}
    return _load_all(str(settings.presets_dir))


Presets = Annotated[dict[str, Preset], Depends(get_presets)]


def summarize(preset: Preset) -> PresetSummary:
    coverage = preset.report.get("coverage") or {}
    return PresetSummary(
        id=preset.id,
        title=preset.title,
        city=preset.festival.city,
        sets=len(preset.festival.timetable),
        stages=len(preset.festival.stages),
        scored_share=coverage.get("scored_share"),
    )


_public: dict[str, tuple[Preset, Preset]] = {}
_public_lock = threading.Lock()


def public_copy(preset: Preset) -> Preset:
    """The preset as the page receives it: each act's popularity rounded to 4 decimals.

    A copy, built once per preset object: the loaded preset (and everything the engine reads from it) keeps
    the full values, since rounding those would change prices.
    """
    with _public_lock:
        hit = _public.get(preset.id)
    if hit is not None and hit[0] is preset:
        return hit[1]
    acts = [
        act
        if act.popularity is None
        else act.model_copy(update={"popularity": round(act.popularity, POPULARITY_DECIMALS)})
        for act in preset.festival.acts
    ]
    public = preset.model_copy(update={"festival": preset.festival.model_copy(update={"acts": acts})})
    with _public_lock:
        _public[preset.id] = (preset, public)
    return public


@router.get("", response_model=list[PresetSummary])
def list_presets(presets: Presets, response: Response) -> list[PresetSummary]:
    """Preset festival days, in file-name order (the first is the landing preset)."""
    response.headers["Cache-Control"] = CACHE_CONTROL
    return [summarize(p) for p in presets.values()]


@router.get("/{preset_id}", response_model=Preset, response_model_exclude={"matrix"})
def get_preset(preset_id: str, presets: Presets, response: Response) -> Preset:
    """A preset festival day with its score report and the Qloo requests behind it.

    The full overlap matrix stays on the server (the agent's tools read it); the page needs only the scores.
    Popularity is served to 4 decimals; the engine keeps the full values.
    """
    preset = presets.get(preset_id)
    if preset is None:
        raise HTTPException(status_code=404, detail=f"No preset {preset_id!r}.")
    response.headers["Cache-Control"] = CACHE_CONTROL
    return public_copy(preset)
