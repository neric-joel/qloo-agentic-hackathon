"""Events streamed to the web app while an agent run executes (server-sent events)."""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any, Literal

Provenance = Literal["qloo", "derived", "llm", "recorded"]
Event = dict[str, Any]
Emit = Callable[[Event], Awaitable[None]]

KEEPALIVE_SECONDS = 15.0


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def encode(event: Event) -> str:
    """Serialize one event as an SSE frame."""
    return f"data: {json.dumps(event, ensure_ascii=False, separators=(',', ':'), default=str)}\n\n"


class EventChannel:
    """Queue between a running agent task and the streaming HTTP response."""

    def __init__(self) -> None:
        self._queue: asyncio.Queue[Event | None] = asyncio.Queue()

    async def emit(self, event: Event) -> None:
        await self._queue.put(event)

    async def close(self) -> None:
        await self._queue.put(None)

    async def frames(self, keepalive: float = KEEPALIVE_SECONDS) -> AsyncIterator[str]:
        """Yield SSE frames until the channel closes, with comment pings while idle."""
        while True:
            try:
                event = await asyncio.wait_for(self._queue.get(), timeout=keepalive)
            except TimeoutError:
                yield ": keep-alive\n\n"
                continue
            if event is None:
                return
            yield encode(event)
