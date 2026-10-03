"""The human what-if: every legal place one set could go on a preset day, priced, with no model or session.

``GET /api/presets/{preset_id}/moves?act=<act_id>&limit=8`` runs the same search as the agent's ``find_moves``
on the published timetable and its locks, and adds what the page shows beside each place: the set's clashes
now and after the move, in Clash Budget Index points. Nothing is changed and no Qloo request is made. Answers
are kept in a small in-process cache, since a preset only changes on redeploy.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Response

from .agent.clash_tools import compute_move_options
from .presets import CACHE_CONTROL, Preset, Presets
from .runs import published_state

router = APIRouter(prefix="/api/presets", tags=["presets"])

MAX_LIMIT = 12
CACHE_SIZE = 512
NOT_ON_THIS_DAY = "That set is not on this festival day."

_cache: OrderedDict[tuple[str, str, int], tuple[Preset, dict[str, Any]]] = OrderedDict()
_cache_lock = threading.Lock()


def move_options(preset: Preset, act_id: str, limit: int) -> dict[str, Any]:
    """The priced places for one set, from the cache when this preset already answered them."""
    key = (preset.id, act_id, limit)
    with _cache_lock:
        hit = _cache.get(key)
    if hit is not None and hit[0] is preset:
        return hit[1]
    state = published_state(preset)
    found = compute_move_options(
        state["festival"], state["matrix"], state["config"], act_id, limit, partners=True
    )
    options = {"kind": "move_options", **found}
    with _cache_lock:
        _cache[key] = (preset, options)
        _cache.move_to_end(key)
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)  # the oldest entry goes first
    return options


@router.get("/{preset_id}/moves")
def get_moves(
    preset_id: str,
    presets: Presets,
    response: Response,
    act: Annotated[str, Query(max_length=80)],
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = 8,
) -> dict[str, Any]:
    """Every legal place a set could go on the published timetable, checking every start on a 5-minute grid,
    each priced with the Clash Budget after the move, best first. Tested only: nothing changes."""
    preset = presets.get(preset_id)
    if preset is None:
        raise HTTPException(status_code=404, detail=f"No preset {preset_id!r}.")
    if act not in {slot.act_id for slot in preset.festival.timetable}:
        raise HTTPException(status_code=404, detail=NOT_ON_THIS_DAY)
    response.headers["Cache-Control"] = CACHE_CONTROL
    return move_options(preset, act, limit)
