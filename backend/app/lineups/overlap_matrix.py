"""Attach Qloo audience overlap to a festival: entity ids, popularity, genres and the overlap matrix."""

from __future__ import annotations

from ..qloo.client import QlooClient
from ..qloo.overlap import OverlapResult, ResolvedAct, build_overlap
from ..schedule.models import Festival, OverlapMatrix


def genre_label(tag_id: str) -> str:
    """``urn:tag:genre:alternative_rock`` -> ``Alternative Rock``."""
    return tag_id.rsplit(":", 1)[-1].replace("_", " ").title()


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
    coverage = {
        a.id: (by_name[a.name].coverage if a.name in by_name and a.name in result.values else "none")
        for a in festival.acts
    }
    matrix = OverlapMatrix(act_ids=ids, values=values, coverage=coverage, source="qloo")
    return festival.model_copy(update={"acts": acts}), matrix


async def qloo_overlap(
    client: QlooClient, festival: Festival, *, city: str | None = None
) -> tuple[Festival, OverlapMatrix, OverlapResult]:
    """Resolve every act in Qloo and score pairwise audience overlap for the whole lineup."""
    result = await build_overlap(client, [a.name for a in festival.acts], city=city)
    enriched, matrix = apply_overlap(festival, result)
    return enriched, matrix, result
