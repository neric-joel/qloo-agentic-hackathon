"""Live pair check: ask Qloo again about one pair of acts, with no language model.

``POST /api/pair`` with the JSON body ``{"preset": <id>, "a": <act_id>, "b": <act_id>}`` sends 3 Qloo
requests: the saved audience-ranking request for each act, re-sent exactly as the preset build sent it (so
the live request is the saved request), and one comparison of the two acts. From the answers it works out the
pair's taste overlap again with the build's own rank arithmetic, where each act came in the other's ranking,
and the tags, and returns them beside the saved value with the three request records and Qloo's request ids.
It never changes a preset and never serves a cached or saved answer as live: every 200 is a live answer, and
nothing is cached. Every response, refusals included, is ``Cache-Control: no-store``.

A check is at most 3 Qloo requests whether it succeeds or fails (no retries), and each is private: it neither
shares nor joins an identical request in flight, so checks running at once never fail each other. Only a JSON
body is read (a form or plain-text body is a 422 before anything else runs) and there is no GET, so another
site cannot start a check from a link, an image or a form.

It is off unless ``PAIR_CHECK_ENABLED`` (and a Qloo key) is set, capped per visitor and per day, and paused
while the requests left in Qloo's month, less those reserved by checks still running, are below the floor, or
after 6 requests sent without an answer that said how many are left (for 10 minutes after the last of them).
Only pairs the page already shows can be checked (the day's ranked clashes and its
clash receipts), so the saved value it returns is one the page already prints for that pair. No raw affinity
is served.
"""

from __future__ import annotations

import asyncio
import logging
import sys
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import Settings, get_settings
from .deps import get_pair_limiter, get_qloo
from .limits import RunLimiter, visitor_key
from .presets import Preset, Presets
from .qloo.client import QlooClient, RequestRecord, record_requests
from .qloo.overlap import parse_shared_tags, percentiles, rank_position, row_scores
from .schedule.models import Act


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

router = APIRouter(prefix="/api", tags=["pair"])

PAIR_PATH = "/api/pair"
NO_STORE = {"Cache-Control": "no-store"}
QLOO_TIMEOUT_SECONDS = 8.0  # for all three requests together
CALLS_PER_CHECK = 3
TAG_TAKE = 8
INSIGHTS = "/v2/insights"
COMPARE = "/v2/analysis/compare"
CANDIDATES = "filter.results.entities"
SIGNAL = "signal.interests.entities"

SWITCHED_OFF = "Live checks are switched off on this server."
NOT_ON_THIS_DAY = "That set is not on this festival day."
SAME_SET = "Pick two different sets."
NOT_PRICED = (
    "Qloo has no usable signal for one of these acts, so this pair is not priced and cannot be re-checked."
)
NOT_ON_THE_PAGE = "That pair is not one of this day's ranked clashes, so it cannot be re-checked."
NO_SAVED_ROWS = "This pair's saved audience rankings are not available, so it cannot be re-checked."
PAUSED = (
    "Live checks are paused to protect this demo's monthly Qloo allowance. The saved result is unchanged."
)
NO_ANSWER = "Qloo did not answer in time, so nothing was re-checked. The saved result is unchanged."


class PairRequest(BaseModel):
    """The body of a check: the festival day and the two acts, nothing else."""

    model_config = ConfigDict(extra="forbid")

    preset: str = Field(max_length=80)
    a: str = Field(max_length=80)
    b: str = Field(max_length=80)


class PairAct(BaseModel):
    act_id: str
    name: str


class OverlapNow(BaseModel):
    live: float = Field(description="Taste overlap worked out from the three answers just now, 0 to 1.")
    saved: float = Field(description="The preset's taste overlap, saved when the day was built, 0 to 1.")


class AudienceRank(BaseModel):
    for_act_id: str = Field(description="The act whose audience Qloo ranked.")
    partner_act_id: str
    position: int = Field(description="1 + how many acts Qloo scored strictly higher for that audience.")
    of: int = Field(description="How many acts were scored, a few unrelated control acts included.")


class PairTag(BaseModel):
    name: str
    kind: str
    score: float


class LiveRequest(BaseModel):
    path: str
    params: dict[str, str]
    status: int
    latency_ms: int
    cached: bool
    recorded: bool
    request_id: str | None


class PairCheck(BaseModel):
    preset_id: str
    fetched_at: str = Field(description="When Qloo answered: UTC, ISO 8601, whole seconds.")
    a: PairAct
    b: PairAct
    taste_overlap: OverlapNow
    rankings: list[AudienceRank]
    tags: list[PairTag]
    requests: list[LiveRequest] = Field(description="Row for a, row for b, then the comparison; all live.")


class NotLive(Exception):
    """Qloo failed, timed out or gave something other than a live answer this check can use."""


def _refuse(status: int, detail: str) -> HTTPException:
    return HTTPException(status_code=status, detail=detail, headers=NO_STORE)


class NoStoreOnPairRoute:
    """Marks every response on the pair route ``Cache-Control: no-store``, the framework's own included (the
    405 for a GET, a 422 for a body that is not JSON), so no cache ever keeps a check or a refusal."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"].rstrip("/") != PAIR_PATH:
            await self.app(scope, receive, send)
            return

        async def send_no_store(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message).update(NO_STORE)
            await send(message)

        await self.app(scope, receive, send_no_store)


def page_pairs(preset: Preset) -> set[frozenset[str]]:
    """The pairs the page shows a taste overlap for: the day's ranked clashes and its clash receipts.

    Receipts are keyed by the two act ids joined with ``|``; a key that is not two ids is skipped.
    """
    pairs: set[frozenset[str]] = set()
    clashes = preset.report.get("clashes")
    for clash in clashes if isinstance(clashes, list) else []:
        sides = [clash.get(side) if isinstance(clash, dict) else None for side in ("a", "b")]
        ids = [side.get("act_id") if isinstance(side, dict) else None for side in sides]
        if all(isinstance(act_id, str) for act_id in ids):
            pairs.add(frozenset(ids))
    receipts = (preset.evidence or {}).get("receipts")
    for key in receipts if isinstance(receipts, dict) else {}:
        ids = key.split("|") if isinstance(key, str) else []
        if len(ids) == 2:
            pairs.add(frozenset(ids))
    return {pair for pair in pairs if len(pair) == 2}


def saved_row(preset: Preset, act: Act) -> dict[str, str] | None:
    """The params of the one saved Insights request that ranked the candidates for this act's audience.

    None when the act has no Qloo id or there is no such request, or more than one (a lineup scored in chunks,
    which this check does not support).
    """
    if not act.qloo_id:
        return None
    rows = [
        request["params"]
        for request in preset.requests
        if request.get("path") == INSIGHTS
        and isinstance(request.get("params"), dict)
        and request["params"].get(SIGNAL) == act.qloo_id
    ]
    if len(rows) != 1:
        return None
    params = rows[0]
    if not all(isinstance(value, str) for value in params.values()) or not params.get(CANDIDATES):
        return None
    return dict(params)


def _candidates(params: dict[str, str]) -> list[str]:
    return params[CANDIDATES].split(",")


def _live(record: RequestRecord) -> bool:
    return record.status == 200 and not record.cached and not record.recorded


async def _fetch(qloo: QlooClient, path: str, params: dict[str, Any]) -> tuple[Any, list[RequestRecord]]:
    # Each call in its own task, so each gets exactly its own record. Private (no cache, no sharing of a
    # request in flight) and never retried, so a check is at most 3 Qloo requests, answered or not.
    with record_requests() as records:
        body = await qloo.get(path, params, use_cache=False, max_retries=0)
    return body, records


async def ask_qloo(
    qloo: QlooClient, calls: list[tuple[str, dict[str, Any]]]
) -> list[tuple[dict, RequestRecord]]:
    """Send the calls together and return each answer with its record, in the order given.

    Raises NotLive unless every call was answered live (status 200, not cached, not a saved fixture) in time.
    """
    async with asyncio.timeout(QLOO_TIMEOUT_SECONDS):
        results = await asyncio.gather(
            *(_fetch(qloo, path, params) for path, params in calls), return_exceptions=True
        )
    answered: list[tuple[dict, RequestRecord]] = []
    for result in results:
        if isinstance(result, BaseException):
            raise NotLive(type(result).__name__) from result
        body, records = result
        if len(records) != 1 or not _live(records[0]) or not isinstance(body, dict):
            raise NotLive("not a live answer")
        answered.append((body, records[0]))
    return answered


def _rank(scores: dict[str, float], for_act: Act, partner: Act) -> AudienceRank:
    place = rank_position(scores, partner.qloo_id or "")
    if place is None:
        raise NotLive("partner missing from the answer")
    return AudienceRank(for_act_id=for_act.id, partner_act_id=partner.id, position=place[0], of=place[1])


def work_out(
    preset: Preset,
    act_a: Act,
    act_b: Act,
    answers: list[tuple[dict, RequestRecord]],
    rows: tuple[dict[str, str], dict[str, str]],
) -> PairCheck:
    """The pair's taste overlap, rank positions and tags from the three live answers."""
    (answer_a, _), (answer_b, _), (comparison, _) = answers
    scores_a = row_scores(answer_a, _candidates(rows[0]))
    scores_b = row_scores(answer_b, _candidates(rows[1]))
    rankings = [_rank(scores_a, act_a, act_b), _rank(scores_b, act_b, act_a)]
    # The build's arithmetic: each act's rank in the other's row, as a 0-1 percentile, averaged
    live = (percentiles(scores_a)[act_b.qloo_id or ""] + percentiles(scores_b)[act_a.qloo_id or ""]) / 2
    return PairCheck(
        preset_id=preset.id,
        fetched_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        a=PairAct(act_id=act_a.id, name=act_a.name),
        b=PairAct(act_id=act_b.id, name=act_b.name),
        taste_overlap=OverlapNow(live=round(live, 4), saved=preset.matrix.value(act_a.id, act_b.id)),
        rankings=rankings,
        tags=[
            PairTag(name=tag.name, kind=tag.kind, score=tag.score)
            for tag in parse_shared_tags(comparison, TAG_TAKE)
        ],
        requests=[LiveRequest(**asdict(record)) for _, record in answers],
    )


def _priced(preset: Preset, act: Act) -> bool:
    matrix = preset.matrix
    return bool(act.qloo_id) and act.id in matrix.act_ids and matrix.coverage_of(act.id) != "none"


@router.post("/pair", response_model=PairCheck)
async def check_pair(
    body: PairRequest,
    request: Request,
    response: Response,
    presets: Presets,
    settings: Annotated[Settings, Depends(get_settings)],
    qloo: Annotated[QlooClient, Depends(get_qloo)],
    limiter: Annotated[RunLimiter, Depends(get_pair_limiter)],
) -> PairCheck:
    """Re-send a pair's two saved audience rankings to Qloo, ask for a fresh comparison, and work the pair's
    taste overlap and tags out again, beside the saved value. Nothing on the preset changes.

    Every refusal comes before the limiter and the limiter before Qloo, so a refused check costs nothing and a
    check that reaches Qloo always takes a slot."""
    if not (settings.pair_check_enabled and settings.qloo_api_key):
        raise _refuse(503, SWITCHED_OFF)
    a, b = body.a, body.b
    preset = presets.get(body.preset)
    if preset is None:
        raise _refuse(404, f"No preset {body.preset!r}.")
    acts = preset.festival.act_by_id()
    scheduled = {slot.act_id for slot in preset.festival.timetable}
    if not {a, b} <= scheduled or not {a, b} <= acts.keys():
        raise _refuse(404, NOT_ON_THIS_DAY)
    if a == b:
        raise _refuse(422, SAME_SET)
    act_a, act_b = acts[a], acts[b]
    if not (_priced(preset, act_a) and _priced(preset, act_b)):
        raise _refuse(422, NOT_PRICED)
    if frozenset((a, b)) not in page_pairs(preset):
        raise _refuse(422, NOT_ON_THE_PAGE)
    row_a, row_b = saved_row(preset, act_a), saved_row(preset, act_b)
    if (
        row_a is None
        or row_b is None
        or act_b.qloo_id not in _candidates(row_a)
        or act_a.qloo_id not in _candidates(row_b)
    ):
        raise _refuse(422, NO_SAVED_ROWS)
    # Reserve the check's requests against the floor before anything is awaited, so two checks started
    # together at the floor cannot both pass in this process; every path below gives the reservation back.
    if not qloo.reserve(settings.qloo_quota_floor, CALLS_PER_CHECK):
        raise _refuse(503, PAUSED)
    host = request.client.host if request.client else None
    refusal = limiter.try_acquire(visitor_key(dict(request.headers), host, settings.visitor_stamp_secret))
    if refusal:
        qloo.release(CALLS_PER_CHECK)
        raise _refuse(429, refusal)

    compare = {
        "a.signal.interests.entities": [act_a.qloo_id],
        "b.signal.interests.entities": [act_b.qloo_id],
        "take": 50,
    }
    calls: list[tuple[str, dict[str, Any]]] = [(INSIGHTS, row_a), (INSIGHTS, row_b), (COMPARE, compare)]
    try:
        check = work_out(preset, act_a, act_b, await ask_qloo(qloo, calls), (row_a, row_b))
    except Exception as exc:  # Qloo's error, a timeout, a saved or cached answer, an answer this cannot read
        log.warning(
            "Live pair check on %s failed (%s); Qloo month remaining %s",
            preset.id,
            type(exc.__cause__ or exc).__name__,
            qloo.month_remaining,
        )
        raise _refuse(503, NO_ANSWER) from exc
    finally:
        qloo.release(CALLS_PER_CHECK)
    log.info(
        "Live pair check on %s: %s and %s; Qloo month remaining %s", preset.id, a, b, qloo.month_remaining
    )
    response.headers.update(NO_STORE)
    return check
