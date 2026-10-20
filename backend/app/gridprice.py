"""Grid pricing: the taste overlap of a pasted grid's longest overlaps, by act name, with no language model.

``POST /api/price-grid`` with the JSON body ``{"acts": [...], "pairs": [["A", "B"], ...], "mode": ...}`` takes
the act names of one pasted day and some of its pairs, and nothing else: no times, stages or rules. A live
body holds 4 to 25 names and up to 5 pairs; a saved body, which sends no Qloo request, up to 60 names and
10 pairs. It answers each pair's taste overlap, the build's rank-normalised value from 0 to 1, and its rank
among the priced pairs sent. Its fields and refusals follow the price-grid contract (kept outside this
repository).

``mode: "saved"`` matches the names to a saved festival day, or to the invented example day, which is always a
candidate, and reads the values the day was built with. It never calls Qloo and never takes a limiter slot.
Under 80% of the names found on every day is, while live pricing is off on this server, a 200 with
``status: "no_saved_day"`` and ``requests_used`` 0 (nothing priced, nothing the browser need log as an
error); with live pricing on it is a 422 (``not_a_saved_day``), the answer the page offers the live step
after. A saved value does not depend on the other names sent, so a body may hold only the names of the pairs
it asks about (and enough names of the day to match it). On a real day only the pairs the
home page prints a taste overlap or a taste rank for get a value (``pair.taste_pairs``: the day's ranked
clashes, its clash receipts and twins, and the pairs of its "Two rankings of this day" lens), each the saved
value the page's own arithmetic reads; any other pair is ``not_ranked_on_saved_day``. The invented day is
exempt and labelled ``invented_day``.

``mode: "live"`` asks Qloo now: one ``/search`` per act and one ``/v2/insights`` per pair act, ranking the
other matched acts for its audience, with the build's rank arithmetic and no comparison request. That is at
most ``need`` requests (the acts plus the distinct pair acts, at most 35), each private and never retried, all
within 25 seconds. It is off unless ``PRICE_GRID_ENABLED`` (and a Qloo key) is set, capped per visitor and per
day, and paused while the requests left in Qloo's month, less those reserved by live calls still running, are
below the floor. The order is as in ``pair.py``: switched off, the body's checks, the reservation against the
floor, the limiter, then Qloo; every refusal before Qloo costs nothing and the reservation is given back on
every path.

The saved mode never falls back to live: a pair or act the saved day cannot answer is answered as unpriced
with its reason, and nothing is fetched.

Names are never logged (counts and the preset id only) and nothing is stored. The answer carries no
affinity, entity id, act id, popularity, tag or request record. Every response, refusals included, is
``Cache-Control: no-store``. Only a JSON body is read and there is no GET.
"""

from __future__ import annotations

import asyncio
import logging
import sys
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import Settings, get_settings
from .deps import get_price_grid_limiter, get_qloo
from .limits import RunLimiter, visitor_key
from .pair import taste_pairs
from .presets import Preset, Presets, synthetic_presets
from .qloo.client import QlooClient, RequestRecord, record_requests
from .qloo.overlap import ARTIST, SEARCH_TAKE, _match, _normalize, percentiles, row_scores
from .schedule.models import Act
from .whatif import BodyLimit


class _StderrHandler(logging.Handler):
    """Writes to the current ``sys.stderr``, so the info line reaches the server log under any host."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            sys.stderr.write(self.format(record) + "\n")
        except Exception:
            self.handleError(record)


log = logging.getLogger(__name__)
if not log.handlers:  # app loggers print nothing below WARNING unless the host sets logging up
    _handler = _StderrHandler()
    _handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
    log.addHandler(_handler)
    log.setLevel(logging.INFO)


class NoQueryInHttpxLog(logging.Filter):
    """Drops the query string from the URL in httpx's request log line, so a host that logs httpx at INFO
    never writes a searched act name (``/search?query=<name>``) to the server log."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(
                str(arg).split("?", 1)[0] if isinstance(arg, httpx.URL) else arg for arg in record.args
            )
        return True


_httpx_log = logging.getLogger("httpx")
if not any(isinstance(f, NoQueryInHttpxLog) for f in _httpx_log.filters):
    _httpx_log.addFilter(NoQueryInHttpxLog())

router = APIRouter(prefix="/api", tags=["price-grid"])

PRICE_GRID_PATH = "/api/price-grid"
NO_STORE = {"Cache-Control": "no-store"}
NAME_LENGTH = 80
MIN_ACTS = 4
MAX_ACTS = 25
MAX_PAIRS = 5
MAX_NEED = MAX_ACTS + 2 * MAX_PAIRS  # 35
SAVED_MAX_ACTS = 60  # a saved answer sends no Qloo request, so a whole published day's names fit
SAVED_MAX_PAIRS = 10
SAVED_SHARE = 0.8  # the share of the sent names a saved day must hold
QLOO_TIMEOUT_SECONDS = 25.0  # for every request of one answer together
CONCURRENCY = 6
INSIGHTS = "/v2/insights"
SEARCH = "/search"

SCOPE_NOTES = {
    "saved_day": (
        "Priced from a saved festival day. No Qloo request was sent. A rank among the acts on that day, "
        "not attendance."
    ),
    "invented_day": (
        "Priced from the invented example day: its acts and affinities are invented, not Qloo data. "
        "No Qloo request was sent."
    ),
    "qloo_live": (
        "Asked Qloo just now. A rank among the acts you pasted, not attendance, and not comparable with a "
        "published day's figures."
    ),
}

TOO_FEW_ACTS = "Send at least 4 different acts."
DUPLICATE_ACT = "Each act can be sent once."
PAIR_NOT_IN_ACTS = "Every pair must name two of the acts sent."
SAME_ACT_PAIR = "A pair must name two different acts."
DUPLICATE_PAIR = "Each pair can be sent once."
NOT_A_SAVED_DAY = "These acts are not on a saved festival day."
NO_SAVED_DAY = (
    "These acts are not on a saved festival day, and live pricing is off on this server, so nothing was "
    "compared. No Qloo request was sent."
)
TOO_FEW_FOUND = "Qloo matched fewer than 4 of these acts, so nothing was priced."
SWITCHED_OFF = "Live pricing is switched off on this server. A saved day still prices."
PAUSED = (
    "Live pricing is paused to protect this demo's monthly Qloo allowance. Your rule results are unchanged."
)
NO_ANSWER = "Qloo did not answer in time; nothing was priced."
LIVE_TOO_MANY = f"A live answer takes at most {MAX_ACTS} acts and {MAX_PAIRS} pairs."

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=NAME_LENGTH)]
Source = Literal["saved_day", "invented_day", "qloo_live"]
Reason = Literal["ambiguous", "no_signal", "not_ranked_on_saved_day"]


class GridPriceRequest(BaseModel):
    """The body: the pasted day's act names, the pairs to price, and the mode. Nothing else is accepted.

    The schema takes the saved caps (60 names, 10 pairs); a live body over the live caps (25 names, 5 pairs)
    is refused by the validator below with the same framework 422, before the route runs."""

    model_config = ConfigDict(extra="forbid")

    acts: list[Name] = Field(min_length=1, max_length=SAVED_MAX_ACTS)
    pairs: list[tuple[Name, Name]] = Field(min_length=1, max_length=SAVED_MAX_PAIRS)
    mode: Literal["saved", "live"]

    @model_validator(mode="after")
    def live_caps(self) -> GridPriceRequest:
        if self.mode == "live" and (len(self.acts) > MAX_ACTS or len(self.pairs) > MAX_PAIRS):
            raise ValueError(LIVE_TOO_MANY)
        return self


class GridCoverage(BaseModel):
    acts: int = Field(description="How many acts were sent.")
    matched: int = Field(description="How many were found as exactly one act (on the day or in Qloo).")
    priced: int = Field(description="How many of the matched acts have a usable taste signal.")
    unpriced: list[str] = Field(description="The others, as sent, in request order.")
    no_signal: list[str] = Field(description="The matched acts with no usable signal, as sent.")
    ambiguous: list[str] = Field(description="The names that matched more than one act of that name.")


class GridComparator(BaseModel):
    kind: Literal["saved_day", "live_subset"] = Field(description="The day's lineup, or the matched acts.")
    acts: int = Field(description="How many acts each taste overlap is a rank among.")


class GridPair(BaseModel):
    a: str
    b: str
    status: Literal["priced", "unpriced"]
    taste_overlap: float | None = Field(description="The build's rank-normalised value, 0 to 1.")
    pair_rank: int | None = Field(description="1 = highest taste overlap among the priced pairs sent.")
    reason: Reason | None


class GridPrice(BaseModel):
    mode: Literal["saved", "live"]
    source: Source
    preset_id: str | None
    fetched_at: str | None = Field(description="Live: when Qloo answered. A saved day: when it was built.")
    coverage: GridCoverage
    comparator: GridComparator
    pairs: list[GridPair]
    requests_used: int
    scope_note: str


class GridNoSavedDay(BaseModel):
    """A saved body no saved day holds, while live pricing is off here: nothing priced, no request sent."""

    mode: Literal["saved"]
    status: Literal["no_saved_day"]
    requests_used: int
    message: str


class NotLive(Exception):
    """Qloo failed, timed out or gave something other than a live answer this route can use."""


class TooFewFound(Exception):
    """Qloo matched fewer than ``MIN_ACTS`` of the names."""


def _refuse(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message}, headers=NO_STORE)


class NoStoreOnPriceGridRoute:
    """Marks every response on the grid pricing route ``Cache-Control: no-store``, the framework's own
    included (the 405 for a GET, a 422 for a body that is not JSON)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"].rstrip("/") != PRICE_GRID_PATH:
            await self.app(scope, receive, send)
            return

        async def send_no_store(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message).update(NO_STORE)
            await send(message)

        await self.app(scope, receive, send_no_store)


class BodyLimitWithPriceGrid(BodyLimit):
    """``BodyLimit`` with the grid pricing route under the same 16 KB cap as the pair check. The largest live
    body (25 names and 5 pairs of 80 characters) is under 3 KB, or 9 KB in 3-byte characters; the largest
    saved body (60 names and 10 pairs of 80 characters) is under 8 KB in 1-byte characters."""

    def _limit_for(self, scope: Scope) -> int | None:
        if scope["type"] == "http" and scope["method"] == "POST":
            if scope["path"].rstrip("/") == PRICE_GRID_PATH:
                return self.limit
        return super()._limit_for(scope)


def checked(body: GridPriceRequest) -> tuple[list[str], list[tuple[str, str]]]:
    """The acts and pairs, or a 422 naming the first rule they break (never echoing a name)."""
    keys = [_normalize(name) for name in body.acts]
    if len(set(keys)) != len(keys):
        raise _refuse(422, "duplicate_act", DUPLICATE_ACT)
    if len(keys) < MIN_ACTS:
        raise _refuse(422, "too_few_acts", TOO_FEW_ACTS)
    names = set(body.acts)
    seen: set[frozenset[str]] = set()
    for a, b in body.pairs:
        if a not in names or b not in names:
            raise _refuse(422, "pair_not_in_acts", PAIR_NOT_IN_ACTS)
        if a == b:
            raise _refuse(422, "same_act_pair", SAME_ACT_PAIR)
        if frozenset((a, b)) in seen:
            raise _refuse(422, "duplicate_pair", DUPLICATE_PAIR)
        seen.add(frozenset((a, b)))
    return list(body.acts), [(a, b) for a, b in body.pairs]


def need_for(acts: list[str], pairs: list[tuple[str, str]]) -> int:
    """The most Qloo requests a live answer sends: one search per act, one ranking per distinct pair act."""
    return len(acts) + len({name for pair in pairs for name in pair})


def ranked(
    pairs: list[tuple[str, str]], values: dict[tuple[str, str], float], reasons: dict[tuple[str, str], Reason]
) -> list[GridPair]:
    """The pairs in request order, each priced pair with its rank (1 + how many priced pairs are higher)."""
    out: list[GridPair] = []
    for pair in pairs:
        value = values.get(pair)
        if value is None:
            out.append(
                GridPair(
                    a=pair[0],
                    b=pair[1],
                    status="unpriced",
                    taste_overlap=None,
                    pair_rank=None,
                    reason=reasons.get(pair, "no_signal"),
                )
            )
            continue
        rank = 1 + sum(1 for other in values.values() if other > value)
        out.append(
            GridPair(a=pair[0], b=pair[1], status="priced", taste_overlap=value, pair_rank=rank, reason=None)
        )
    return out


# ---------------------------------------------------------------------------------------- saved days


def day_acts(preset: Preset) -> tuple[dict[str, Act], set[str]]:
    """The day's scheduled acts by normalised name, and the names two or more of them share (left out of the
    index: they cannot be told apart)."""
    scheduled = {slot.act_id for slot in preset.festival.timetable}
    index: dict[str, Act | None] = {}
    for act in preset.festival.acts:
        if act.id in scheduled:
            key = _normalize(act.name)
            index[key] = None if key in index else act
    shared = {key for key, act in index.items() if act is None}
    return {key: act for key, act in index.items() if act is not None}, shared


def coverage_of(acts: list[str], matched: set[str], priced: set[str], ambiguous: set[str]) -> GridCoverage:
    """The coverage block; every list keeps the names as sent, in request order."""
    return GridCoverage(
        acts=len(acts),
        matched=len(matched),
        priced=len(priced),
        unpriced=[name for name in acts if name not in priced],
        no_signal=[name for name in acts if name in matched and name not in priced],
        ambiguous=[name for name in acts if name in ambiguous],
    )


def _scored(preset: Preset, act: Act) -> bool:
    matrix = preset.matrix
    usable = act.id in matrix.act_ids and matrix.coverage_of(act.id) != "none"
    return usable and (preset.synthetic or bool(act.qloo_id))


def price_saved(acts: list[str], pairs: list[tuple[str, str]], days: list[Preset]) -> GridPrice:
    """Price the pairs from the saved day holding the most of the names. Raises LookupError when no day holds
    ``SAVED_SHARE`` of them. No Qloo request, nothing stored."""
    best: tuple[Preset, dict[str, Act], set[str]] | None = None
    for preset in days:
        index, shared = day_acts(preset)
        found = {name: index[_normalize(name)] for name in acts if _normalize(name) in index}
        if best is None or len(found) > len(best[1]):
            best = (preset, found, {name for name in acts if _normalize(name) in shared})
    if best is None or len(best[1]) < SAVED_SHARE * len(acts):
        raise LookupError("not a saved day")
    preset, found, ambiguous = best
    scored = {name: act for name, act in found.items() if _scored(preset, act)}
    shown = None if preset.synthetic else taste_pairs(preset)
    values: dict[tuple[str, str], float] = {}
    reasons: dict[tuple[str, str], Reason] = {}
    for a, b in pairs:
        if a in ambiguous or b in ambiguous:
            reasons[(a, b)] = "ambiguous"
        elif a not in scored or b not in scored:
            reasons[(a, b)] = "no_signal"
        elif shown is not None and frozenset((scored[a].id, scored[b].id)) not in shown:
            reasons[(a, b)] = "not_ranked_on_saved_day"
        else:
            values[(a, b)] = round(preset.matrix.value(scored[a].id, scored[b].id), 4)
    source: Source = "invented_day" if preset.synthetic else "saved_day"
    scheduled = {slot.act_id for slot in preset.festival.timetable}
    lineup = sum(1 for act in preset.festival.acts if act.id in scheduled and _scored(preset, act))
    return GridPrice(
        mode="saved",
        source=source,
        preset_id=preset.id,
        fetched_at=None if preset.synthetic else preset.built_at,
        coverage=coverage_of(acts, set(found), set(scored), ambiguous),
        comparator=GridComparator(kind="saved_day", acts=lineup),
        pairs=ranked(pairs, values, reasons),
        requests_used=0,
        scope_note=SCOPE_NOTES[source],
    )


def saved_days(presets: dict[str, Preset]) -> list[Preset]:
    """The built days, then the invented example day (always a candidate, so the ``/check`` sample prices on
    every deployment), each once."""
    days = list(presets.values())
    days += [preset for preset in synthetic_presets().values() if preset.id not in presets]
    return days


# ------------------------------------------------------------------------------------------------- live


def _live(record: RequestRecord) -> bool:
    return record.status == 200 and not record.cached and not record.recorded


async def _fetch(
    qloo: QlooClient, sem: asyncio.Semaphore, path: str, params: dict[str, Any]
) -> dict[str, Any]:
    """One private request (no cache, no sharing of a request in flight), never retried, in its own task so
    it gets exactly its own record. Raises NotLive unless it was answered live."""
    async with sem:
        with record_requests() as records:
            body = await qloo.get(path, params, use_cache=False, max_retries=0)
    if len(records) != 1 or not _live(records[0]) or not isinstance(body, dict):
        raise NotLive("not a live answer")
    return body


async def _ask(
    qloo: QlooClient, sem: asyncio.Semaphore, calls: list[tuple[str, dict[str, Any]]]
) -> list[dict[str, Any]]:
    results = await asyncio.gather(
        *(_fetch(qloo, sem, path, params) for path, params in calls), return_exceptions=True
    )
    answers: list[dict[str, Any]] = []
    for result in results:
        if isinstance(result, BaseException):
            raise NotLive(type(result).__name__) from result
        answers.append(result)
    return answers


async def price_live(qloo: QlooClient, acts: list[str], pairs: list[tuple[str, str]]) -> GridPrice:
    """Search each act, rank the other matched acts for each pair act's audience, and price each pair with the
    build's arithmetic: each act's rank in the other's ranking as a 0-1 percentile, the two averaged.

    Raises TooFewFound when fewer than ``MIN_ACTS`` names match one Qloo artist, NotLive when any request
    failed or was not answered live, TimeoutError past ``QLOO_TIMEOUT_SECONDS``."""
    sem = asyncio.Semaphore(CONCURRENCY)
    sent = 0
    async with asyncio.timeout(QLOO_TIMEOUT_SECONDS):
        searches = [(SEARCH, {"query": name, "types": [ARTIST], "take": SEARCH_TAKE}) for name in acts]
        found = await _ask(qloo, sem, searches)
        sent += len(searches)
        matched: dict[str, str] = {}
        ambiguous: set[str] = set()
        for name, answer in zip(acts, found, strict=True):
            best, unsure = _match(name, answer.get("results") or [])
            if unsure:  # more than one artist of this name: never the most popular one picked
                ambiguous.add(name)
                continue
            entity = best.get("entity_id") if best else None
            if isinstance(entity, str) and entity:
                matched[name] = entity
        taken: dict[str, int] = {}
        for entity in matched.values():
            taken[entity] = taken.get(entity, 0) + 1
        matched = {name: entity for name, entity in matched.items() if taken[entity] == 1}  # one artist each
        if len(matched) < MIN_ACTS:
            raise TooFewFound
        priceable = [(a, b) for a, b in pairs if a in matched and b in matched]
        signals = list(dict.fromkeys(name for pair in priceable for name in pair))
        rows_asked: list[tuple[str, dict[str, Any]]] = []
        candidates: dict[str, list[str]] = {}
        for name in signals:
            others = [entity for other, entity in matched.items() if other != name]
            candidates[name] = others
            params = {
                "filter.type": ARTIST,
                "signal.interests.entities": [matched[name]],
                "filter.results.entities": others,
                "take": len(others),
            }
            rows_asked.append((INSIGHTS, params))
        answers = await _ask(qloo, sem, rows_asked)
        sent += len(rows_asked)
    rows = {
        name: percentiles(row_scores(answer, candidates[name]))
        for name, answer in zip(signals, answers, strict=True)
    }
    values: dict[tuple[str, str], float] = {}
    for a, b in priceable:
        directions = [v for v in (rows[a].get(matched[b]), rows[b].get(matched[a])) if v is not None]
        if directions:
            values[(a, b)] = round(sum(directions) / len(directions), 4)
    # Priced only with a usable affinity in a live answer: the act's own ranking is not empty, or another
    # act's ranking scored it. A match alone is not a signal.
    scored_entities = {entity for row in rows.values() for entity in row}
    priced = {name for name, entity in matched.items() if rows.get(name) or entity in scored_entities}
    reasons: dict[tuple[str, str], Reason] = {
        (a, b): "ambiguous" for a, b in pairs if a in ambiguous or b in ambiguous
    }
    return GridPrice(
        mode="live",
        source="qloo_live",
        preset_id=None,
        fetched_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        coverage=coverage_of(acts, set(matched), priced, ambiguous),
        comparator=GridComparator(kind="live_subset", acts=len(matched)),
        pairs=ranked(pairs, values, reasons),
        requests_used=sent,
        scope_note=SCOPE_NOTES["qloo_live"],
    )


def live_enabled(settings: Settings) -> bool:
    """Live pricing needs the switch and a key; it stays off while fixture recording would write names."""
    return settings.price_grid_enabled and bool(settings.qloo_api_key) and not settings.qloo_record_fixtures


@router.post("/price-grid", response_model=GridPrice | GridNoSavedDay)
async def price_grid(
    body: GridPriceRequest,
    request: Request,
    response: Response,
    presets: Presets,
    settings: Annotated[Settings, Depends(get_settings)],
    qloo: Annotated[QlooClient, Depends(get_qloo)],
    limiter: Annotated[RunLimiter, Depends(get_price_grid_limiter)],
) -> GridPrice | GridNoSavedDay:
    """Price up to 10 pairs (saved) or 5 (live) of a pasted day by taste overlap, from a saved day or (opt-in)
    from Qloo now.

    A saved answer never touches Qloo or the limiter. A live one is refused before the limiter and the limiter
    before Qloo, so a refused answer costs nothing; the reservation is given back on every path."""
    if body.mode == "live" and not live_enabled(settings):
        raise _refuse(503, "live_off", SWITCHED_OFF)
    acts, pairs = checked(body)
    if body.mode == "saved":
        try:
            answer = price_saved(acts, pairs, saved_days(presets))
        except LookupError:
            log.info("Grid price, saved: %d acts, %d pairs, no saved day", len(acts), len(pairs))
            if not live_enabled(settings):
                # Nothing the page could do next, so an answer, not an error; saved never falls back to live
                response.headers.update(NO_STORE)
                return GridNoSavedDay(
                    mode="saved", status="no_saved_day", requests_used=0, message=NO_SAVED_DAY
                )
            raise _refuse(422, "not_a_saved_day", NOT_A_SAVED_DAY) from None
        log.info(
            "Grid price, saved, on %s: %d acts, %d pairs, %d priced",
            answer.preset_id,
            len(acts),
            len(pairs),
            sum(1 for pair in answer.pairs if pair.status == "priced"),
        )
        response.headers.update(NO_STORE)
        return answer

    need = need_for(acts, pairs)
    # Reserve before anything is awaited, so two answers started together at the floor cannot both pass in
    # this process; every path below gives the reservation back.
    if not qloo.reserve(settings.qloo_quota_floor, need):
        raise _refuse(503, "paused", PAUSED)
    try:
        host = request.client.host if request.client else None
        refusal = limiter.try_acquire(visitor_key(dict(request.headers), host, settings.visitor_stamp_secret))
        if refusal:
            raise _refuse(429, "limit", refusal)
        try:
            answer = await price_live(qloo, acts, pairs)
        except TooFewFound:
            log.info("Grid price, live: %d acts, fewer than %d matched", len(acts), MIN_ACTS)
            raise _refuse(422, "too_few_found", TOO_FEW_FOUND) from None
        except (
            Exception
        ) as exc:  # Qloo's error, a timeout, a saved or cached answer, an answer it cannot read
            log.warning(
                "Grid price, live, failed (%s): %d acts, %d pairs; Qloo month remaining %s",
                type(exc.__cause__ or exc).__name__,
                len(acts),
                len(pairs),
                qloo.month_remaining,
            )
            raise _refuse(503, "no_answer", NO_ANSWER) from exc
    finally:
        qloo.release(need)
    log.info(
        "Grid price, live: %d acts, %d pairs, %d matched, %d priced, %d ambiguous, %d requests; "
        "Qloo month remaining %s",
        len(acts),
        len(pairs),
        answer.coverage.matched,
        answer.coverage.priced,
        len(answer.coverage.ambiguous),
        answer.requests_used,
        qloo.month_remaining,
    )
    response.headers.update(NO_STORE)
    return answer
