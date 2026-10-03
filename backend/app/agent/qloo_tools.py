"""General-purpose Qloo tools the agent can call: resolve names to entities, get recommendations."""

from __future__ import annotations

import asyncio
import json
from difflib import SequenceMatcher
from typing import Any

from .tools import Tool, ToolContext, ToolInputError, ToolOutput

ENTITY_TYPES = [
    "urn:entity:artist",
    "urn:entity:movie",
    "urn:entity:tv_show",
    "urn:entity:book",
    "urn:entity:podcast",
    "urn:entity:place",
    "urn:entity:destination",
    "urn:entity:brand",
    "urn:entity:person",
]
GEO_TYPES = {"urn:entity:place", "urn:entity:destination"}
MAX_NAMES = 12
MAX_SIGNALS = 10
MAX_TAKE = 20


def _compact(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def _name_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a.casefold().strip(), b.casefold().strip()).ratio()


def candidate_summary(entity: dict[str, Any]) -> dict[str, Any]:
    return {
        "entity_id": entity.get("entity_id"),
        "name": entity.get("name"),
        "popularity": _round(entity.get("popularity")),
        "disambiguation": entity.get("disambiguation"),
    }


def result_summary(entity: dict[str, Any]) -> dict[str, Any]:
    query = entity.get("query") or {}
    return {
        "entity_id": entity.get("entity_id"),
        "name": entity.get("name"),
        "affinity": _round(query.get("affinity")),
        "popularity": _round(entity.get("popularity")),
        "tags": [tag.get("name") for tag in (entity.get("tags") or [])[:4] if tag.get("name")],
        "explainability": query.get("explainability"),
    }


def _round(value: Any, digits: int = 3) -> Any:
    return round(value, digits) if isinstance(value, float) else value


# ------------------------------------------------------------------ resolve_entities


def _search_count(args: dict[str, Any]) -> int:
    """Qloo searches one resolve_entities call sends: one per name (a call with too many names is refused by
    the handler before any request, so its count is capped)."""
    names = args.get("names")
    count = sum(1 for n in names if isinstance(n, str) and n.strip()) if isinstance(names, list) else 0
    return min(count, MAX_NAMES)


async def resolve_entities(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
    names = [n.strip() for n in args.get("names", []) if isinstance(n, str) and n.strip()]
    entity_type = args.get("entity_type")
    if not names:
        raise ToolInputError("Provide at least one name.")
    if len(names) > MAX_NAMES:
        raise ToolInputError(f"Resolve at most {MAX_NAMES} names per call.")
    if entity_type not in ENTITY_TYPES:
        raise ToolInputError(f"entity_type must be one of {ENTITY_TYPES}.")

    responses = await asyncio.gather(*(ctx.qloo.search(name, types=[entity_type], take=3) for name in names))
    resolved = []
    for name, response in zip(names, responses, strict=True):
        candidates = [candidate_summary(e) for e in (response.get("results") or [])]
        best = candidates[0] if candidates else None
        ambiguous = bool(
            best
            and (
                _name_similarity(name, best["name"] or "") < 0.75
                or any(_name_similarity(c["name"] or "", best["name"] or "") > 0.95 for c in candidates[1:])
            )
        )
        resolved.append(
            {"query": name, "match": best, "alternatives": candidates[1:], "ambiguous": ambiguous}
        )

    found = sum(1 for r in resolved if r["match"])
    return ToolOutput(
        content=_compact(resolved),
        summary=f"Resolved {found} of {len(names)} names",
        data=resolved,
    )


RESOLVE_ENTITIES = Tool(
    name="resolve_entities",
    description=(
        "Look up names (artists, films, shows, books, podcasts, places, brands, people) in Qloo and "
        f"return their Qloo entity ids. Up to {MAX_NAMES} names per call, all of one entity type. Each "
        "result has the best match, alternatives, and an 'ambiguous' flag; when a match is ambiguous, "
        "ask the user which one they mean instead of guessing."
    ),
    input_schema={
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "names": {"type": "array", "items": {"type": "string"}, "description": "Names to look up."},
            "entity_type": {"type": "string", "enum": ENTITY_TYPES},
        },
        "required": ["names", "entity_type"],
    },
    handler=resolve_entities,
    qloo_calls=_search_count,
)


# ------------------------------------------------------------------------- recommend


async def recommend(args: dict[str, Any], ctx: ToolContext) -> ToolOutput:
    ids = [i for i in args.get("signal_entity_ids", []) if isinstance(i, str) and i]
    target = args.get("target_type")
    location = (args.get("location") or "").strip()
    take = args.get("take") or 10
    if not ids:
        raise ToolInputError("Provide at least one Qloo entity id as a signal (use resolve_entities first).")
    if len(ids) > MAX_SIGNALS:
        raise ToolInputError(f"Use at most {MAX_SIGNALS} signal entities.")
    if target not in ENTITY_TYPES:
        raise ToolInputError(f"target_type must be one of {ENTITY_TYPES}.")
    if not isinstance(take, int) or take < 1:
        raise ToolInputError("take must be a positive integer.")

    params: dict[str, Any] = {
        "filter.type": target,
        "signal.interests.entities": ids,
        "feature.explainability": True,
        "take": min(take, MAX_TAKE),
    }
    if location:
        params["filter.location.query" if target in GEO_TYPES else "signal.location.query"] = location

    response = await ctx.qloo.insights(params)
    entities = ((response.get("results") or {}).get("entities")) or []
    picks = [result_summary(e) for e in entities]
    label = target.rsplit(":", 1)[-1].replace("_", " ")
    return ToolOutput(
        content=_compact(picks),
        summary=f"{len(picks)} {label} results" + (f" near {location}" if location else ""),
        data=picks,
    )


RECOMMEND = Tool(
    name="recommend",
    description=(
        "Get Qloo taste-based recommendations of one entity type for an audience described by up to "
        f"{MAX_SIGNALS} signal entities (Qloo ids from resolve_entities). Works across domains: e.g. artists "
        "as signals, restaurants or books as the target. Optional location (a city or neighborhood name) "
        "localizes results. Each result includes an affinity score (0-1, relative ranking only), popularity, "
        "a few taste tags, and Qloo's explainability data for which signals drove it."
    ),
    input_schema={
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "signal_entity_ids": {"type": "array", "items": {"type": "string"}},
            "target_type": {"type": "string", "enum": ENTITY_TYPES},
            "location": {"type": "string", "description": "City or neighborhood; empty string for none."},
            "take": {"type": "integer", "description": f"How many results, 1-{MAX_TAKE}."},
        },
        "required": ["signal_entity_ids", "target_type", "location", "take"],
    },
    handler=recommend,
    qloo_calls=lambda args: 1,
)

GENERAL_TOOLS = [RESOLVE_ENTITIES, RECOMMEND]
