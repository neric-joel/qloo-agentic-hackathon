"""Audience-overlap matrix for a lineup, built from Qloo's taste graph.

For each act A, one Insights call scores every other act on the lineup for A's audience
(``filter.results.entities`` shortlist ranking). Rows are rank-normalized so acts with very
different popularity are comparable, then the two directions are averaged into a symmetric matrix.
Control acts from unrelated genres are scored alongside the lineup: if they don't land near the
bottom, the signal can't discriminate and the result says so instead of pretending.
"""

from __future__ import annotations

import asyncio
import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any, Literal

from .client import QlooClient, QlooError

ARTIST = "urn:entity:artist"
MAX_SHORTLIST = 50
CONCURRENCY = 6
MIN_POPULARITY_STRONG = 0.3
MIN_NAME_SIMILARITY = 0.92
SEARCH_TAKE = 3
CONTROL_ARTISTS = ("Vienna Philharmonic", "Raffi", "Frankie Yankovic", "Mormon Tabernacle Choir")

Coverage = Literal["strong", "weak", "none"]


@dataclass
class ResolvedAct:
    name: str
    entity_id: str | None
    matched_name: str | None = None
    popularity: float | None = None
    coverage: Coverage = "none"
    alternatives: list[str] = field(default_factory=list)
    genres: list[str] = field(default_factory=list)  # Qloo genre tag ids, e.g. urn:tag:genre:indie
    scored_as: str | None = None  # for "A b2b B" billings: the component whose audience stands in


@dataclass
class OverlapResult:
    acts: list[ResolvedAct]
    values: dict[str, dict[str, float]]  # act name -> act name -> overlap 0-1 (symmetric)
    discriminates: bool | None  # None when there were too few acts to check
    control_rank: float | None  # mean percentile of control acts (lower is better)
    source: Literal["qloo"] = "qloo"
    notes: list[str] = field(default_factory=list)


def _genres(entity: dict[str, Any]) -> list[str]:
    return [
        t["tag_id"] for t in entity.get("tags") or [] if t.get("type") == "urn:tag:genre" and t.get("tag_id")
    ]


def _normalize(name: str) -> str:
    """Casefold, drop accents and punctuation, '&' -> 'and', drop a leading 'the'."""
    decomposed = unicodedata.normalize("NFKD", name.casefold().replace("&", " and "))
    kept = "".join(
        " " if unicodedata.category(ch)[0] in "PSZ" else ch
        for ch in decomposed
        if not unicodedata.combining(ch)
    )
    words = kept.split()
    if len(words) > 1 and words[0] == "the":
        words = words[1:]
    return " ".join(words)


def _similar(a: str, b: str) -> float:
    return SequenceMatcher(None, _normalize(a), _normalize(b)).ratio()


_SET_SUFFIX = re.compile(
    r"\s*(?:\((?:dj set|live|live set|hybrid set|dj)\)|(?:and|&)\s+(?:his|her|their)\s+band)\s*$",
    re.IGNORECASE,
)
_BILLING_SPLIT = re.compile(r"\s+(?:b2b|b3b|x|vs\.?|with|presents)\s+", re.IGNORECASE)
_BAND_SPLIT = re.compile(r"\s+(?:&|and)\s+", re.IGNORECASE)


def _billing_parts(name: str) -> list[str]:
    """Names to try when a billing doesn't match an artist as printed.

    'Tinashe (DJ set)' and 'Patti Smith and Her Band' -> the artist; 'A b2b B' -> ['A', 'B'];
    'Elvis Costello & The Imposters' -> ['Elvis Costello', 'The Imposters']. Empty when no such form.
    """
    stripped = _SET_SUFFIX.sub("", name).strip()
    parts = [p.strip() for p in _BILLING_SPLIT.split(stripped) if p.strip()]
    if len(parts) < 2:
        parts = [p.strip() for p in _BAND_SPLIT.split(stripped) if p.strip()]
    if stripped == name and len(parts) < 2:
        return []
    return parts


def _match(name: str, results: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, bool]:
    """Pick the result that is the same act, not just a similar name. Returns (match, ambiguous)."""
    target = _normalize(name)
    exact = [r for r in results if _normalize(r.get("name") or "") == target]
    if exact:
        exact.sort(key=lambda r: r.get("popularity") or 0, reverse=True)
        return exact[0], len(exact) > 1
    close = [r for r in results if _similar(name, r.get("name") or "") >= MIN_NAME_SIMILARITY]
    if close:
        return max(close, key=lambda r: _similar(name, r.get("name") or "")), False
    return None, False


async def resolve_acts(
    client: QlooClient, names: Sequence[str], city: str | None = None
) -> list[ResolvedAct]:
    """Find each act in Qloo. A similar name is not enough: an act we can't match stays unscored
    (with the closest names offered as alternatives) rather than borrowing another artist's audience."""
    sem = asyncio.Semaphore(CONCURRENCY)

    async def lookup(query: str) -> list[dict[str, Any]]:
        async with sem:
            try:
                response = await client.search(query, types=[ARTIST], take=SEARCH_TAKE)
            except QlooError:
                return []
        return response.get("results") or []

    async def one(name: str) -> ResolvedAct:
        results = await lookup(name)
        best, ambiguous = _match(name, results)
        if best is None:
            parts = _billing_parts(name)
            if parts:
                found = [(part, _match(part, await lookup(part))[0]) for part in parts]
                found = [(part, r) for part, r in found if r is not None]
                if found:
                    part, best = max(found, key=lambda pr: pr[1].get("popularity") or 0)
                    return ResolvedAct(
                        name=name,
                        entity_id=best.get("entity_id"),
                        matched_name=best.get("name"),
                        popularity=best.get("popularity"),
                        coverage="weak",
                        genres=_genres(best),
                        scored_as=best.get("name"),
                    )
            return ResolvedAct(
                name=name, entity_id=None, alternatives=[r["name"] for r in results if r.get("name")]
            )
        popularity = best.get("popularity")
        strong = not ambiguous and (popularity or 0) >= MIN_POPULARITY_STRONG
        return ResolvedAct(
            name=name,
            entity_id=best.get("entity_id"),
            matched_name=best.get("name"),
            popularity=popularity,
            coverage="strong" if strong else "weak",
            alternatives=[r["name"] for r in results if r is not best and r.get("name")],
            genres=_genres(best),
        )

    return list(await asyncio.gather(*(one(n) for n in names)))


async def _row(
    client: QlooClient, signal_id: str, candidate_ids: list[str], city: str | None, sem: asyncio.Semaphore
) -> dict[str, float]:
    """Affinity of each candidate for the audience of ``signal_id``."""
    scores: dict[str, float] = {}
    for start in range(0, len(candidate_ids), MAX_SHORTLIST):
        chunk = candidate_ids[start : start + MAX_SHORTLIST]
        params: dict[str, Any] = {
            "filter.type": ARTIST,
            "signal.interests.entities": [signal_id],
            "filter.results.entities": chunk,
            "take": len(chunk),
        }
        if city:
            params["signal.location.query"] = city
        async with sem:
            response = await client.insights(params)
        scores.update(row_scores(response, chunk))
    return scores


def row_scores(response: dict[str, Any], candidate_ids: Sequence[str]) -> dict[str, float]:
    """Each candidate's affinity in one Insights answer; entities outside the candidates are ignored."""
    candidates = set(candidate_ids)
    scores: dict[str, float] = {}
    for entity in (response.get("results") or {}).get("entities") or []:
        affinity = (entity.get("query") or {}).get("affinity")
        if entity.get("entity_id") in candidates and isinstance(affinity, (int, float)):
            scores[entity["entity_id"]] = float(affinity)
    return scores


def rank_position(scores: dict[str, float], entity_id: str) -> tuple[int, int] | None:
    """``(1 + how many scored strictly higher, how many were scored)``, or None when the id was not scored."""
    if entity_id not in scores:
        return None
    mine = scores[entity_id]
    return 1 + sum(1 for value in scores.values() if value > mine), len(scores)


def percentiles(scores: dict[str, float]) -> dict[str, float]:
    """Rank-normalize to 0-1 (1 = closest audience). Ties share the average rank."""
    if not scores:
        return {}
    ordered = sorted(scores.items(), key=lambda kv: kv[1])
    n = len(ordered)
    if n == 1:
        return {ordered[0][0]: 1.0}
    out: dict[str, float] = {}
    i = 0
    while i < n:
        j = i
        while j + 1 < n and ordered[j + 1][1] == ordered[i][1]:
            j += 1
        rank = (i + j) / 2 / (n - 1)
        for k in range(i, j + 1):
            out[ordered[k][0]] = rank
        i = j + 1
    return out


async def build_overlap(
    client: QlooClient,
    names: Sequence[str],
    *,
    city: str | None = None,
    controls: Sequence[str] = CONTROL_ARTISTS,
) -> OverlapResult:
    acts = await resolve_acts(client, names)
    control_acts = [c for c in await resolve_acts(client, controls) if c.entity_id]
    usable = [a for a in acts if a.entity_id and a.coverage != "none"]
    notes: list[str] = []
    missing = [a.name for a in acts if a not in usable]
    if missing:
        notes.append(
            f"No usable Qloo signal for: {', '.join(missing)}. They are left out, not scored as zero."
        )

    by_id = {a.entity_id: a for a in usable}
    control_ids = [c.entity_id for c in control_acts if c.entity_id not in by_id]
    sem = asyncio.Semaphore(CONCURRENCY)

    async def row_for(act: ResolvedAct) -> tuple[str, dict[str, float]]:
        candidates = [i for i in by_id if i != act.entity_id] + control_ids
        try:
            return act.entity_id, percentiles(await _row(client, act.entity_id, candidates, city, sem))
        except QlooError as exc:
            notes.append(f"Overlap row for {act.name} failed ({exc.status or 'network'}).")
            return act.entity_id, {}

    rows = dict(await asyncio.gather(*(row_for(a) for a in usable)))

    values: dict[str, dict[str, float]] = {a.name: {} for a in usable}
    for a in usable:
        for b in usable:
            if a is b:
                continue
            ab = rows[a.entity_id].get(b.entity_id)
            ba = rows[b.entity_id].get(a.entity_id)
            pair = [v for v in (ab, ba) if v is not None]
            if pair:
                values[a.name][b.name] = round(sum(pair) / len(pair), 4)

    control_scores = [row[cid] for row in rows.values() for cid in control_ids if cid in row]
    control_rank = round(sum(control_scores) / len(control_scores), 3) if control_scores else None
    discriminates = None if control_rank is None or len(usable) < 4 else control_rank <= 0.35
    if discriminates is False:
        notes.append("Control acts did not rank near the bottom; overlap scores may not discriminate here.")

    return OverlapResult(
        acts=acts, values=values, discriminates=discriminates, control_rank=control_rank, notes=notes
    )


# Tag kinds that explain an overlap in taste; instruments, regions and vague descriptors do not.
TASTE_TAG_KINDS = ("urn:tag:genre", "urn:tag:subgenre", "urn:tag:theme")


@dataclass
class SharedTag:
    name: str
    tag_id: str
    kind: str  # Qloo tag subtype, e.g. urn:tag:genre:music
    score: float


async def shared_taste(client: QlooClient, a_id: str, b_id: str, *, take: int = 8) -> list[SharedTag]:
    """What two acts' audiences have in common, by Qloo's comparison of their taste profiles.

    Only genre, subgenre and theme tags are kept: instruments, regions and descriptors such as
    "Energetic" say little about why two audiences lean toward each other.
    """
    response = await client.compare(
        {"a.signal.interests.entities": [a_id], "b.signal.interests.entities": [b_id], "take": 50}
    )
    return parse_shared_tags(response, take)


def parse_shared_tags(response: dict[str, Any], take: int) -> list[SharedTag]:
    """The genre, subgenre and theme tags in one comparison answer, highest score first."""
    shared = []
    for tag in (response.get("results") or {}).get("tags") or []:
        kind = tag.get("subtype") or tag.get("type") or ""
        score = (tag.get("query") or {}).get("score")
        if not tag.get("name") or not isinstance(score, (int, float)) or not kind.startswith(TASTE_TAG_KINDS):
            continue
        shared.append(
            SharedTag(name=tag["name"], tag_id=tag.get("tag_id", ""), kind=kind, score=float(score))
        )
    shared.sort(key=lambda t: t.score, reverse=True)
    return shared[:take]
