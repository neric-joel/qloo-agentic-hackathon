"""Attach Qloo audience overlap to a festival: entity ids, popularity, genres and the overlap matrix.

The matrix holds a number for every pair, so a pair Qloo gave no score either way is written as 0.0 there and
listed by ``unknown_pairs``: pass that list to the scorer so the pair is left out, not scored as zero. An act
with no pair score at all gets coverage "none" and is left out whole.
"""

from __future__ import annotations

from ..qloo.client import QlooClient
from ..qloo.overlap import OverlapResult, ResolvedAct, build_overlap
from ..schedule.models import Coverage, Festival, OverlapMatrix

PairKey = tuple[str, str]


def genre_label(tag_id: str) -> str:
    """``urn:tag:genre:alternative_rock`` -> ``Alternative Rock``."""
    return tag_id.rsplit(":", 1)[-1].replace("_", " ").title()


def _scored(result: OverlapResult, name: str) -> bool:
    """The act has overlap scores: it is in the result and, when it has others to pair with, has one score."""
    if name not in result.values:
        return False
    return bool(result.values[name]) or len(result.values) < 2


def apply_overlap(festival: Festival, result: OverlapResult) -> tuple[Festival, OverlapMatrix]:
    """Merge an overlap result (keyed by act name) into the festival's acts and build the matrix."""
    by_name: dict[str, ResolvedAct] = {a.name: a for a in result.acts}
    acts = []
    for act in festival.acts:
        resolved = by_name.get(act.name)
        if resolved is None or resolved.entity_id is None:
            acts.append(act)
            continue
        acts.append(
            act.model_copy(
                update={
                    "qloo_id": resolved.entity_id,
                    "popularity": resolved.popularity,
                    "genre": genre_label(resolved.genres[0]) if resolved.genres else None,
                }
            )
        )

    ids = [a.id for a in festival.acts]
    names = [a.name for a in festival.acts]
    values = [
        [
            0.0 if i == j else float(result.values.get(names[i], {}).get(names[j], 0.0))
            for j in range(len(ids))
        ]
        for i in range(len(ids))
    ]
    coverage: dict[str, Coverage] = {
        a.id: (by_name[a.name].coverage if a.name in by_name and _scored(result, a.name) else "none")
        for a in festival.acts
    }
    matrix = OverlapMatrix(act_ids=ids, values=values, coverage=coverage, source="qloo")
    return festival.model_copy(update={"acts": acts}), matrix


def _scored_acts(festival: Festival, result: OverlapResult) -> list[tuple[str, str]]:
    """(act id, act name) of every act the matrix scores, in lineup order."""
    by_name = {a.name for a in result.acts}
    return [(a.id, a.name) for a in festival.acts if a.name in by_name and _scored(result, a.name)]


def _pairs_with(festival: Festival, result: OverlapResult, wanted: int | None) -> frozenset[PairKey]:
    scored = _scored_acts(festival, result)
    found = set()
    for index, (a_id, a_name) in enumerate(scored):
        for b_id, b_name in scored[index + 1 :]:
            if a_id == b_id:
                continue
            if b_name in result.values.get(a_name, {}):
                count = result.directions.get(a_name, {}).get(b_name, 2)
            else:
                count = None
            if count == wanted:
                found.add((a_id, b_id) if a_id < b_id else (b_id, a_id))
    return frozenset(found)


def unknown_pairs(festival: Festival, result: OverlapResult) -> frozenset[PairKey]:
    """Act-id pairs (sorted) of two scored acts with no overlap score in either direction.

    Their matrix cell is 0.0 only because the matrix needs a number: score with these as ``unknown_pairs``.
    """
    return _pairs_with(festival, result, None)


def one_direction_pairs(festival: Festival, result: OverlapResult) -> frozenset[PairKey]:
    """Act-id pairs (sorted) whose overlap rests on one act's ranking only; the value is used as it is."""
    return _pairs_with(festival, result, 1)


async def qloo_overlap(
    client: QlooClient, festival: Festival, *, city: str | None = None
) -> tuple[Festival, OverlapMatrix, OverlapResult]:
    """Resolve every act in Qloo and score pairwise audience overlap for the whole lineup.

    Score the result with ``unknown_pairs(enriched, result)`` so pairs with no score are left out.
    """
    result = await build_overlap(client, [a.name for a in festival.acts], city=city)
    enriched, matrix = apply_overlap(festival, result)
    return enriched, matrix, result
