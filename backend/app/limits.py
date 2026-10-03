"""Caps on agent runs, so a public demo can't run up the model bill.

Counts live in memory per server instance: a soft guard in front of the provider's own spend limit, which is
the hard stop. When a cap is hit the run is refused with a short reason.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from collections.abc import Callable

HOUR = 3600
DAY = 24 * HOUR


class RunLimiter:
    def __init__(
        self,
        per_hour: int,
        per_day: int,
        global_per_day: int,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.per_hour = per_hour
        self.per_day = per_day
        self.global_per_day = global_per_day
        self.clock = clock
        self._visitors: dict[str, deque[float]] = defaultdict(deque)
        self._all: deque[float] = deque()

    def try_acquire(self, visitor: str) -> str | None:
        """Record a run for this visitor, or return why it is refused."""
        now = self.clock()
        stamps = self._visitors[visitor]
        for queue in (stamps, self._all):
            while queue and now - queue[0] >= DAY:
                queue.popleft()
        if len(self._all) >= self.global_per_day:
            return "The live agent has reached today's limit. Please try again tomorrow."
        if len(stamps) >= self.per_day:
            return "You have reached today's limit of live agent runs. Please try again tomorrow."
        if sum(1 for t in stamps if now - t < HOUR) >= self.per_hour:
            return "Too many live agent runs this hour. Please try again later."
        stamps.append(now)
        self._all.append(now)
        return None


def visitor_key(headers: dict[str, str], fallback: str | None) -> str:
    """The caller's address: first hop of X-Forwarded-For (set by the hosting proxy), else the socket peer."""
    forwarded = headers.get("x-forwarded-for", "")
    first = forwarded.split(",")[0].strip()
    return first or headers.get("x-real-ip", "") or fallback or "unknown"
