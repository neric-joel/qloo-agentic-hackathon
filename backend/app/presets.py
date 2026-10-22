"""Demo presets: real festival days scored ahead of time, served without spending Qloo quota.

Presets are built by ``scripts/build_preset.py`` into ``backend/presets/`` (or ``PRESETS_DIR``). They hold
Qloo-derived data, so that folder is git-ignored: it ships with the deployment, never with the repository.

A clone has no such folder. When the folder is missing or holds no preset, the API serves one invented day
instead (``synthetic: true``), generated here from a set seed: invented acts and affinities, no Qloo data.
"""

from __future__ import annotations

import json
import logging
import threading
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from .config import Settings, get_settings
from .schedule.metrics import score_festival
from .schedule.models import Festival, OverlapMatrix
from .schedule.synthetic import synthetic_festival

router = APIRouter(prefix="/api/presets", tags=["presets"])
log = logging.getLogger(__name__)

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
    synthetic: bool = False


class Preset(BaseModel):
    id: str
    title: str
    built_at: str | None = None
    location: str | None = Field(
        default=None,
        description=(
            "The city every audience ranking of the build was sent with (Qloo's signal.location.query), or "
            "None when the day was ranked without a location: a global reading, not a local one."
        ),
    )
    synthetic: bool = Field(
        default=False,
        description="True for the invented day served when no preset was built: no Qloo data in it.",
    )
    festival: Festival
    matrix: OverlapMatrix
    report: dict[str, Any]
    requests: list[dict[str, Any]] = []
    sources: list[dict[str, Any]] = []
    overlap_notes: list[str] = []
    evidence: dict[str, Any] | None = Field(
        default=None, description="Sourced examples: hidden-clash wall, clash receipts, same-size twins."
    )
    matched_names: dict[str, str] = Field(
        default_factory=dict,
        description=(
            "{act id: the name Qloo's /search returned for the act's entity id}, read from the saved /search "
            "responses by scripts/enrich_matched_names.py (no request sent). Empty when the preset was not "
            "enriched, and on the invented day."
        ),
    )


class PresetResponse(Preset):
    decision: dict[str, Any] | None = Field(
        default=None,
        description=(
            "The worked decision for the preset's first day with sets, exactly as GET "
            "/api/presets/{id}/decision answers it for that day; null when the engine has none."
        ),
    )


@lru_cache(maxsize=4)
def _load_all(directory: str) -> dict[str, Preset]:
    presets: dict[str, Preset] = {}
    for path in sorted(Path(directory).glob("*.json")):
        preset = Preset.model_validate(json.loads(path.read_text(encoding="utf-8")))
        presets[preset.id] = preset
    return presets


def build_synthetic_preset(*, seed: int = 7, acts: int = 24) -> Preset:
    """A reproducible one-day festival of invented acts: no key, no Qloo request, no saved Qloo response."""
    festival, matrix = synthetic_festival(seed, days=1, stages=4, acts=acts)
    report = score_festival(festival, matrix)
    return Preset(
        id=f"{festival.id}-friday",
        title="Lanternfield Friday (synthetic demo)",
        synthetic=True,
        festival=festival,
        matrix=matrix,
        report=report.model_dump(mode="json"),
        requests=[],
        sources=[],
        overlap_notes=[
            "Synthetic example day: every artist, set time, popularity and affinity here is invented.",
            "No Qloo request was made. Nothing on this day says anything about a real festival.",
        ],
    )


@lru_cache(maxsize=1)
def synthetic_presets() -> dict[str, Preset]:
    """The fallback day, built once per process (one object, which the engine's caches rely on)."""
    preset = build_synthetic_preset()
    return {preset.id: preset}


def load_presets(settings: Settings) -> dict[str, Preset]:
    """The presets built into ``presets_dir``; empty when the folder is missing or holds none."""
    if settings.presets_dir is None or not settings.presets_dir.is_dir():
        return {}
    return _load_all(str(settings.presets_dir))


def get_presets(settings: Annotated[Settings, Depends(get_settings)]) -> dict[str, Preset]:
    """The built presets, or the one invented day when there are none (a clone has no presets folder)."""
    return load_presets(settings) or synthetic_presets()


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
        synthetic=preset.synthetic,
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


@router.get("/{preset_id}", response_model=PresetResponse, response_model_exclude={"matrix"})
def get_preset(preset_id: str, presets: Presets, response: Response) -> PresetResponse:
    """A preset festival day with its score report and the Qloo requests behind it.

    The full overlap matrix stays on the server (the agent's tools read it); the page needs only the scores.
    Popularity is served to 4 decimals; the engine keeps the full values.

    ``decision`` is the engine's own answer for the first day with sets, read from its cache (filled at
    startup), so the page gets the preset and its decision in one response. It is computed from the loaded
    preset, never from the public copy: the cache keys on the loaded object. It is null when no day has sets
    or the engine fails; the preset is served either way.
    """
    from .decision import decision as decide  # app.decision imports this module

    preset = presets.get(preset_id)
    if preset is None:
        raise HTTPException(status_code=404, detail=f"No preset {preset_id!r}.")
    response.headers["Cache-Control"] = CACHE_CONTROL
    days = {slot.day for slot in preset.festival.timetable}
    answer: dict[str, Any] | None = None
    if days:
        try:
            answer = decide(preset, min(days))
        except Exception:
            log.exception("decision for preset %s failed; served without it", preset_id)
    return PresetResponse(**dict(public_copy(preset)), decision=answer)
