"""Caps on agent runs and live pair checks, so a public demo can't run up the model bill or the Qloo month.

Counts live in memory per server instance: a soft guard in front of the provider's own spend limit, which is
the hard stop. When a cap is hit the request is refused with a short reason.
"""

from __future__ import annotations

import time
from collections import deque
from collections.abc import Callable
from typing import NamedTuple

HOUR = 3600
DAY = 24 * HOUR


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

    def try_acquire(self, visitor: str) -> str | None:
        """Record a request for this visitor, or return why it is refused (a refusal stores nothing)."""
        now = self.clock()
        stamps = self._visitors.get(visitor, deque())
        for queue in (stamps, self._all):
            while queue and now - queue[0] >= DAY:
                queue.popleft()
        if len(self._all) >= self.global_per_day:
            return self.messages.global_day
        if len(stamps) >= self.per_day:
            return self.messages.day
        if sum(1 for t in stamps if now - t < HOUR) >= self.per_hour:
            return self.messages.hour
        stamps.append(now)
        self._visitors[visitor] = stamps
        self._all.append(now)
        return None


def visitor_key(headers: dict[str, str], fallback: str | None) -> str:
    """The caller's address: first hop of X-Forwarded-For (set by the hosting proxy), else the socket peer."""
    forwarded = headers.get("x-forwarded-for", "")
    first = forwarded.split(",")[0].strip()
    return first or headers.get("x-real-ip", "") or fallback or "unknown"
