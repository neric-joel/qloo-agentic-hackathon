"""Async client for the Qloo Taste AI API.

Features:
- one shared ``httpx.AsyncClient`` per client instance
- in-process TTL cache keyed on (path, params) so repeated requests don't spend quota
- retries with exponential backoff on 429 and 5xx responses (a caller can turn them off per request)
- optional fixture record/replay so preloaded demo flows keep working if the API is slow or down
- a fail-closed allowance guard: the requests left in Qloo's month, read from each answer, and a count of
  requests sent since the last answer that said, so callers can pause live requests when either is unsafe
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import random
import time
from collections import OrderedDict
from collections.abc import Callable, Iterable, Iterator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

log = logging.getLogger(__name__)

HACKATHON_BASE_URL = "https://hackathon.api.qloo.com"
RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
DEFAULT_MAX_RPS = 4.5  # hackathon keys allow 5 requests per second
# Requests sent without an answer that carried the month's allowance header, after which live requests pause
BLIND_REQUEST_LIMIT = 6
# A pause for blind requests lifts after this long without a new blind request, for one probe at a time: a
# single lease per client (per server instance). An answer with the header ends the pause for good; a blind
# answer or a failure ends the lease and the window starts again. A lease never answered expires.
BLIND_PROBE_AFTER_SECONDS = 600
PROBE_LEASE_SECONDS = 60
# A higher requests-left value than the one held is taken as stale (an answer that was slower than a later
# one) unless the held value is at least this old
STALE_REMAINING_SECONDS = 120

Params = Mapping[str, Any]


@dataclass(frozen=True)
class RequestRecord:
    """One Qloo request as shown in the app's "How Qloo was used" view (the key is never included)."""

    path: str
    params: dict[str, str]
    status: int
    latency_ms: int
    cached: bool = False
    recorded: bool = False
    request_id: str | None = None


_request_log: ContextVar[list[RequestRecord] | None] = ContextVar("qloo_request_log", default=None)


@contextmanager
def record_requests() -> Iterator[list[RequestRecord]]:
    """Collect every Qloo request made inside this context (asyncio tasks inherit it)."""
    records: list[RequestRecord] = []
    token = _request_log.set(records)
    try:
        yield records
    finally:
        _request_log.reset(token)


def _record(path: str, params: dict[str, str], started: float, **fields: Any) -> None:
    records = _request_log.get()
    if records is not None:
        latency_ms = round((time.perf_counter() - started) * 1000)
        records.append(RequestRecord(path=path, params=params, latency_ms=latency_ms, **fields))


class QlooError(Exception):
    """The Qloo API returned an error or could not be reached."""

    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        payload: Any = None,
        request_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.payload = payload
        self.request_id = request_id

    @property
    def reason(self) -> str | None:
        """Qloo's error reason; the gateway nests it under ``error``, the API docs show it flat."""
        if not isinstance(self.payload, dict):
            return None
        body = self.payload.get("error", self.payload)
        return body.get("reason") if isinstance(body, dict) else None


class TTLCache:
    """Small LRU cache whose entries expire after ``ttl`` seconds."""

    def __init__(self, maxsize: int = 1024, ttl: float = 6 * 3600) -> None:
        self.maxsize = maxsize
        self.ttl = ttl
        self._data: OrderedDict[str, tuple[float, Any]] = OrderedDict()

    def get(self, key: str) -> Any | None:
        item = self._data.get(key)
        if item is None:
            return None
        expires_at, value = item
        if expires_at < time.monotonic():
            del self._data[key]
            return None
        self._data.move_to_end(key)
        return value

    def set(self, key: str, value: Any, ttl: float | None = None) -> None:
        self._data[key] = (time.monotonic() + (self.ttl if ttl is None else ttl), value)
        self._data.move_to_end(key)
        while len(self._data) > self.maxsize:
            self._data.popitem(last=False)

    def __len__(self) -> int:
        return len(self._data)


def normalize_params(params: Params | None) -> dict[str, str]:
    """Drop empty values and encode lists the way Qloo expects (comma-separated)."""
    out: dict[str, str] = {}
    for key, value in (params or {}).items():
        if value is None or value == "" or value == [] or value == ():
            continue
        if isinstance(value, bool):
            out[key] = "true" if value else "false"
        elif isinstance(value, (list, tuple, set)):
            out[key] = ",".join(str(v) for v in value)
        else:
            out[key] = str(value)
    return out


def request_key(path: str, params: Mapping[str, str]) -> str:
    canonical = json.dumps([path, sorted(params.items())], separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()[:32]


class QlooClient:
    """Thin async wrapper around the Qloo REST API."""

    # Requests left in this key's month, from the last response that said (None until one does)
    month_remaining: int | None = None

    def __init__(
        self,
        api_key: str | None,
        base_url: str = HACKATHON_BASE_URL,
        *,
        timeout: float = 15.0,
        max_retries: int = 2,
        backoff: float = 0.5,
        cache: TTLCache | None = None,
        fixtures_dir: Path | None = None,
        record_fixtures: bool = False,
        fixtures_first: bool = False,
        max_rps: float | None = DEFAULT_MAX_RPS,
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.api_key = api_key
        self.clock = clock
        self.max_retries = max_retries
        self.backoff = backoff
        self.cache = cache if cache is not None else TTLCache()
        self.fixtures_dir = fixtures_dir
        self.record_fixtures = record_fixtures
        # Serve a saved response before calling the API (a persistent cache that saves monthly quota).
        self.fixtures_first = fixtures_first
        self._min_interval = 1.0 / max_rps if max_rps else 0.0
        self._next_slot = 0.0
        self._slot_lock = asyncio.Lock()
        headers = {"Accept": "application/json"}
        if api_key:
            headers["X-Api-Key"] = api_key
        self._http = httpx.AsyncClient(
            base_url=base_url.rstrip("/"), headers=headers, timeout=timeout, transport=transport
        )
        self._inflight: dict[str, asyncio.Future[dict[str, Any]]] = {}
        # Requests sent since the last answer that carried the allowance header: a response without it, a
        # transport error, a timeout or a cancelled request adds one; an answer with it resets the count.
        self.blind_requests = 0
        self._last_blind = 0.0  # when the last blind request was counted (``clock`` time)
        self._lease_at: float | None = None  # when the probe lease in flight was granted, if one is
        self._lease_reserved = False  # the lease was granted to a ``reserve`` (its ``release`` ends it)
        self._leases = 0  # leases granted so far
        self._remaining_at = 0.0  # when ``month_remaining`` was last taken from an answer
        # Requests promised to live calls that have not finished yet (see ``reserve``)
        self._reserved = 0

    async def aclose(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> QlooClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    # ------------------------------------------------------------------ core

    def allowance_low(self, floor: int | None, needed: int = 0) -> bool:
        """True when live requests should pause to protect the month's allowance.

        That is when ``BLIND_REQUEST_LIMIT`` requests have gone out without an answer that carried the
        allowance header (whatever an older answer said), or when the requests left are known and, less the
        requests reserved for live calls still running in this process, fewer than ``floor`` plus the
        ``needed`` requests the caller is about to send. Never with no floor.

        The blind pause lifts ``BLIND_PROBE_AFTER_SECONDS`` after the last blind request, for one caller at a
        time: the first caller after the window gets a lease (False here) and every other caller is paused
        while it is in flight. The lease ends when an answer arrives: with the header the pause is over, blind
        or failed the window starts again. A lease never answered expires after ``PROBE_LEASE_SECONDS``.
        """
        if floor is None:
            return False
        left = None if self.month_remaining is None else self.month_remaining - self._reserved
        month_low = left is not None and left < floor + needed
        if self.blind_requests < BLIND_REQUEST_LIMIT:
            return month_low
        now = self.clock()
        if self._lease_at is not None and now - self._lease_at < PROBE_LEASE_SECONDS:
            return True  # one probe is already out
        if now - self._last_blind < BLIND_PROBE_AFTER_SECONDS or month_low:
            return True
        self._lease_at = now
        self._lease_reserved = False
        self._leases += 1
        return False

    def reserve(self, floor: int | None, needed: int) -> bool:
        """Promise ``needed`` requests to a live call, or return False when ``allowance_low`` says pause.

        Synchronous (no ``await``), so the test and the reservation cannot interleave with another call on the
        event loop: two calls started together at the floor cannot both pass in this process. The floor is
        best-effort: other server instances keep their own counts, so it can still be crossed across
        instances. Pair each True with ``release``.
        """
        leases = self._leases
        if self.allowance_low(floor, needed):
            return False
        if self._leases != leases:  # this call was granted the probe lease
            self._lease_reserved = True
        self._reserved += needed
        return True

    def release(self, needed: int) -> None:
        """Give back requests promised by ``reserve`` (never below zero). A probe lease taken by a reservation
        that sent nothing (refused by a cap) ends here, without starting the window again."""
        self._reserved = max(0, self._reserved - needed)
        if self._lease_reserved:
            self._lease_at = None
            self._lease_reserved = False

    def _count_blind(self) -> None:
        self.blind_requests += 1
        self._last_blind = self.clock()
        self._lease_at = None  # a probe that went blind is over; the window starts again from now
        self._lease_reserved = False

    def _saw_remaining(self, remaining: int) -> None:
        """An answer that carried the allowance header: the blind count resets, and the value is kept unless
        it is higher than the one held and that one is recent (a slower answer arriving after a newer one)."""
        self.blind_requests = 0
        self._lease_at = None
        self._lease_reserved = False
        now = self.clock()
        if (
            self.month_remaining is None
            or remaining <= self.month_remaining
            or now - self._remaining_at >= STALE_REMAINING_SECONDS
        ):
            self.month_remaining = remaining
            self._remaining_at = now

    async def get(
        self,
        path: str,
        params: Params | None = None,
        *,
        use_cache: bool = True,
        ttl: float | None = None,
        max_retries: int | None = None,
    ) -> dict[str, Any]:
        """GET ``path`` and return the decoded JSON body.

        Identical concurrent requests share one HTTP call, so parallel agent tool calls don't
        spend quota twice. ``use_cache=False`` makes a private live request instead: it reads no cache,
        neither joins nor shares an identical request in flight, and caches nothing. ``max_retries``
        overrides the client's retry count for this request (``None`` keeps it).
        """
        query = normalize_params(params)
        key = request_key(path, query)
        started = time.perf_counter()

        future: asyncio.Future[dict[str, Any]] | None = None
        if use_cache:
            if (cached := self.cache.get(key)) is not None:
                _record(path, query, started, status=200, cached=True)
                return cached
            if (pending := self._inflight.get(key)) is not None:
                data = await asyncio.shield(pending)
                _record(path, query, started, status=200, cached=True)
                return data
            future = asyncio.get_running_loop().create_future()
            self._inflight[key] = future
        try:
            data, meta = await self._fetch(path, query, key, max_retries)
        except BaseException as exc:
            if future is not None:
                future.set_exception(exc)
                future.exception()  # mark retrieved so a lone caller doesn't log "never retrieved"
            if isinstance(exc, QlooError):
                _record(path, query, started, status=exc.status or 0, request_id=exc.request_id)
            raise
        else:
            if future is not None:
                future.set_result(data)
                self.cache.set(key, data, ttl)
            _record(path, query, started, **meta)
            return data
        finally:
            if future is not None:  # only a call that registered may remove the in-flight entry
                del self._inflight[key]

    async def _fetch(
        self, path: str, query: dict[str, str], key: str, max_retries: int | None = None
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        if self.fixtures_first and self.api_key and (saved := self._load_fixture(key)) is not None:
            return saved, {"status": 200, "cached": True}
        if not self.api_key:
            data = self._load_fixture(key)
            if data is None:
                raise QlooError(f"No API key configured and no fixture for {path} {query}")
            return data, {"status": 200, "recorded": True}

        try:
            data, status, request_id = await self._request_with_retries(path, query, max_retries)
        except QlooError as exc:
            fallback = self._load_fixture(key)
            if fallback is not None:
                log.warning("Qloo request failed (%s); serving recorded fixture for %s", exc, path)
                return fallback, {"status": 200, "recorded": True}
            raise

        if self.record_fixtures:
            self._save_fixture(key, path, query, data)
        return data, {"status": status, "request_id": request_id}

    async def _request_with_retries(
        self, path: str, query: dict[str, str], max_retries: int | None = None
    ) -> tuple[dict[str, Any], int, str | None]:
        retries = self.max_retries if max_retries is None else max_retries
        attempt = 0
        while True:
            retry_after: float | None = None
            await self._wait_for_slot()
            try:
                response = await self._http.get(path, params=query)
            except httpx.HTTPError as exc:  # a transport error or a timeout: sent, never answered
                self._count_blind()
                if attempt >= retries:
                    raise QlooError(f"Qloo request to {path} failed: {exc}") from exc
            except asyncio.CancelledError:  # the caller gave up while the request was out
                self._count_blind()
                raise
            else:
                if (remaining := _month_remaining(response)) is not None:
                    self._saw_remaining(remaining)
                else:
                    self._count_blind()
                if response.status_code < 400:
                    return (
                        response.json(),
                        response.status_code,
                        response.headers.get("x-qloo-request-id"),
                    )
                request_id = response.headers.get("x-qloo-request-id")
                if response.status_code not in RETRY_STATUSES or attempt >= retries:
                    log.warning("Qloo HTTP %s for %s (request id %s)", response.status_code, path, request_id)
                    raise QlooError(
                        f"Qloo returned HTTP {response.status_code} for {path}",
                        status=response.status_code,
                        payload=_safe_json(response),
                        request_id=request_id,
                    )
                retry_after = _retry_after_seconds(response)
            attempt += 1
            delay = self.backoff * (2 ** (attempt - 1)) * (1 + random.random() / 2)
            await asyncio.sleep(min(retry_after if retry_after is not None else delay, 10.0))

    async def _wait_for_slot(self) -> None:
        """Space request starts so the client stays under the per-second rate limit."""
        if not self._min_interval:
            return
        async with self._slot_lock:
            now = time.monotonic()
            wait = self._next_slot - now
            self._next_slot = max(now, self._next_slot) + self._min_interval
        if wait > 0:
            await asyncio.sleep(wait)

    # -------------------------------------------------------------- fixtures

    def _fixture_path(self, key: str) -> Path | None:
        return self.fixtures_dir / f"{key}.json" if self.fixtures_dir else None

    def _load_fixture(self, key: str) -> dict[str, Any] | None:
        path = self._fixture_path(key)
        if path is None or not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))["response"]

    def _save_fixture(self, key: str, path: str, query: dict[str, str], data: dict[str, Any]) -> None:
        target = self._fixture_path(key)
        if target is None:
            return
        target.parent.mkdir(parents=True, exist_ok=True)
        record = {"request": {"path": path, "params": query}, "response": data}
        target.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")

    # ------------------------------------------------------------- endpoints

    async def search(
        self, query: str, *, types: Iterable[str] | None = None, take: int = 10
    ) -> dict[str, Any]:
        """Find entities by name. ``types`` are entity URNs such as ``urn:entity:artist``."""
        return await self.get("/search", {"query": query, "types": list(types or []), "take": take})

    async def entities(self, entity_ids: Iterable[str]) -> dict[str, Any]:
        """Look up full entity records by Qloo id."""
        return await self.get("/entities", {"entity_ids": list(entity_ids)})

    async def insights(self, params: Params) -> dict[str, Any]:
        """Call the Insights API. ``params`` use Qloo's dotted names, e.g. ``filter.type``."""
        if "filter.type" not in params:
            raise ValueError("insights() requires 'filter.type'")
        return await self.get("/v2/insights", params, ttl=INSIGHTS_TTL)

    async def tags(self, params: Params) -> dict[str, Any]:
        """Search tags (genres, keywords, cuisines, styles...)."""
        return await self.get("/v2/tags", params, ttl=LOOKUP_TTL)

    async def tag_types(self) -> dict[str, Any]:
        return await self.get("/v2/tags/types", ttl=LOOKUP_TTL)

    async def audiences(self, params: Params) -> dict[str, Any]:
        """Search audience segments."""
        return await self.get("/v2/audiences", params, ttl=LOOKUP_TTL)

    async def audience_types(self) -> dict[str, Any]:
        return await self.get("/v2/audiences/types", ttl=LOOKUP_TTL)

    async def trending(self, params: Params) -> dict[str, Any]:
        """Entities whose audience is growing over a date range."""
        return await self.get("/v2/trending", params, ttl=TRENDING_TTL)

    async def compare(self, params: Params) -> dict[str, Any]:
        """What two groups of signals have in common (``a.*`` and ``b.*`` params)."""
        return await self.get("/v2/analysis/compare", params, ttl=INSIGHTS_TTL)


LOOKUP_TTL = 24 * 3600
INSIGHTS_TTL = 6 * 3600
TRENDING_TTL = 3600


def _retry_after_seconds(response: httpx.Response) -> float | None:
    value = response.headers.get("retry-after")
    try:
        return max(0.0, float(value)) if value is not None else None
    except ValueError:
        return None


def _month_remaining(response: httpx.Response) -> int | None:
    """Qloo's ``X-Month-RateLimit-Remaining`` header as a whole number, or None when absent or malformed."""
    value = (response.headers.get("x-month-ratelimit-remaining") or "").strip()
    return int(value) if value.isascii() and value.isdigit() else None


def _safe_json(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return response.text[:500]
