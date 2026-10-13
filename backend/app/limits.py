"""Caps on agent runs, live pair checks and live grid pricing, so a public demo can't run up the model bill
or the Qloo month.

Counts live in memory per server instance: a soft guard in front of the provider's own spend limit, which is
the hard stop. When a cap is hit the request is refused with a short reason. A visitor is the address the
web proxy signed (the visitor stamp) when a stamp secret is set and the stamp verifies, else the forwarded
address.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import time
from collections import deque
from collections.abc import Callable
from typing import NamedTuple

HOUR = 3600
DAY = 24 * HOUR
SWEEP_EVERY = 500  # acquisitions between sweeps of visitors with no request left in the window

# The visitor stamp the web proxy adds: the caller's address and its HMAC-SHA256 under the shared secret
STAMP_VISITOR = "x-clash-visitor"
STAMP_SIG = "x-clash-sig"
STAMP_ADDRESS = re.compile(r"[0-9A-Fa-f:.]{1,64}")


class LimitMessages(NamedTuple):
    """The refusal texts, one per cap."""

    hour: str  # this visitor, this hour
    day: str  # this visitor, today
    global_day: str  # everyone, today


RUN_MESSAGES = LimitMessages(
    hour="Too many live agent runs this hour. Please try again later.",
    day="You have reached today's limit of live agent runs. Please try again tomorrow.",
    global_day="The live agent has reached today's limit. Please try again tomorrow.",
)
PAIR_MESSAGES = LimitMessages(
    hour="Too many live checks this hour. Please try again later.",
    day="You have reached today's limit of live checks. Please try again tomorrow.",
    global_day="Live checks have reached today's limit. Please try again tomorrow.",
)

_PRICE_GRID_TODAY = (
    "Live pricing has reached today's limit. Your rule results are unchanged, and a saved day prices without "
    "a limit."
)
PRICE_GRID_MESSAGES = LimitMessages(
    hour=(
        "Live pricing has reached this hour's limit. Your rule results are unchanged, and a saved day prices "
        "without a limit."
    ),
    day=_PRICE_GRID_TODAY,
    global_day=_PRICE_GRID_TODAY,
)


class RunLimiter:
    def __init__(
        self,
        per_hour: int,
        per_day: int,
        global_per_day: int,
        clock: Callable[[], float] = time.time,
        messages: LimitMessages = RUN_MESSAGES,
    ) -> None:
        self.per_hour = per_hour
        self.per_day = per_day
        self.global_per_day = global_per_day
        self.clock = clock
        self.messages = messages
        self._visitors: dict[str, deque[float]] = {}
        self._all: deque[float] = deque()
        self._acquired = 0

    def try_acquire(self, visitor: str) -> str | None:
        """Record a request for this visitor, or return why it is refused (a refusal stores nothing)."""
        now = self.clock()
        stamps = self._visitors.get(visitor)
        if stamps is not None:
            _expire(stamps, now)
            if not stamps:  # nothing left in the window: forget the visitor
                del self._visitors[visitor]
                stamps = None
        _expire(self._all, now)
        if len(self._all) >= self.global_per_day:
            return self.messages.global_day
        if len(stamps or ()) >= self.per_day:
            return self.messages.day
        if sum(1 for t in stamps or () if now - t < HOUR) >= self.per_hour:
            return self.messages.hour
        if stamps is None:
            stamps = self._visitors[visitor] = deque()
        stamps.append(now)
        self._all.append(now)
        self._acquired += 1
        if self._acquired % SWEEP_EVERY == 0:
            self._sweep(now)
        return None

    def _sweep(self, now: float) -> None:
        """Drop every visitor whose requests have all left the window, so the table does not only grow."""
        for visitor in list(self._visitors):
            stamps = self._visitors[visitor]
            _expire(stamps, now)
            if not stamps:
                del self._visitors[visitor]


def _expire(stamps: deque[float], now: float) -> None:
    while stamps and now - stamps[0] >= DAY:
        stamps.popleft()


def stamp_signature(secret: str, visitor: str) -> str:
    """The stamp's signature: lowercase hex HMAC-SHA256 of the address, keyed with the secret (both UTF-8)."""
    return hmac.new(secret.encode(), visitor.encode(), hashlib.sha256).hexdigest()


def stamp_state(headers: dict[str, str], stamp_secret: str | None) -> str:
    """``ok`` when the request carries a stamp that verifies under the secret, ``none`` when it carries no
    stamp header, else ``bad`` (a stamp with no secret set here is ``bad`` too: it cannot be verified)."""
    visitor, sig = headers.get(STAMP_VISITOR), headers.get(STAMP_SIG)
    if visitor is None and sig is None:
        return "none"
    if not stamp_secret or visitor is None or sig is None or not STAMP_ADDRESS.fullmatch(visitor):
        return "bad"
    expected = stamp_signature(stamp_secret, visitor).encode()
    return "ok" if hmac.compare_digest(expected, sig.encode("utf-8", "replace")) else "bad"


def visitor_key(headers: dict[str, str], fallback: str | None, stamp_secret: str | None = None) -> str:
    """The key the caps count against.

    With a stamp secret and a stamp that verifies under it: ``stamp:`` and the address the web proxy saw.
    Otherwise the caller's address: first hop of X-Forwarded-For (set by the hosting proxy), else X-Real-IP,
    else the socket peer.
    """
    if stamp_secret and stamp_state(headers, stamp_secret) == "ok":
        return "stamp:" + headers[STAMP_VISITOR]
    forwarded = headers.get("x-forwarded-for", "")
    first = forwarded.split(",")[0].strip()
    return first or headers.get("x-real-ip", "") or fallback or "unknown"
