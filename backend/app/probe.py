"""The limiter probe: which key the caps count a request against, read from outside with no Qloo call.

Only when ``LIMITER_PROBE_TOKEN`` is set, a GET or HEAD of ``/api/health`` that sends the header ``x-probe``
equal to the token gets four more response headers:

- ``x-probe-key``: the first 8 hex characters of SHA-256 of the token followed by the limiter key, the key
  worked out exactly as the caps work it out (visitor stamp included), so the key itself is never shown
- ``x-probe-hops``: how many non-empty hops ``X-Forwarded-For`` carries
- ``x-probe-src``: where the address part of the key came from: ``xff``, ``real-ip`` or ``peer``
- ``x-probe-stamp``: ``ok``, ``bad`` or ``none`` for the visitor stamp

Nothing else changes: no header appears without the token, with a wrong one, or with the setting unset, and
the body is the usual health answer. Set the token only while testing.
"""

from __future__ import annotations

import hashlib
import hmac

from fastapi import FastAPI
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import Settings
from .limits import stamp_state, visitor_key

PROBE_PATH = "/api/health"
PROBE_HEADER = "x-probe"


def key_source(headers: dict[str, str]) -> str:
    """Where ``visitor_key`` takes the address from when there is no valid stamp."""
    if headers.get("x-forwarded-for", "").split(",")[0].strip():
        return "xff"
    if headers.get("x-real-ip", ""):
        return "real-ip"
    return "peer"


def probe_headers(token: str, stamp_secret: str | None, headers: dict[str, str], peer: str | None) -> dict:
    key = visitor_key(headers, peer, stamp_secret)
    hops = [hop for hop in headers.get("x-forwarded-for", "").split(",") if hop.strip()]
    return {
        "x-probe-key": hashlib.sha256((token + key).encode()).hexdigest()[:8],
        "x-probe-hops": str(len(hops)),
        "x-probe-src": key_source(headers),
        "x-probe-stamp": stamp_state(headers, stamp_secret),
    }


class LimiterProbe:
    """Adds the probe headers to a health answer whose request carries the right ``x-probe`` header."""

    def __init__(self, app: ASGIApp, token: str, stamp_secret: str | None) -> None:
        self.app = app
        self.token = token.encode()
        self.stamp_secret = stamp_secret

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] != PROBE_PATH:
            await self.app(scope, receive, send)
            return
        headers = dict(Headers(scope=scope))
        offered = headers.get(PROBE_HEADER)
        if offered is None or not hmac.compare_digest(offered.encode("utf-8", "replace"), self.token):
            await self.app(scope, receive, send)
            return
        client = scope.get("client")
        peer = client[0] if client else None
        extra = probe_headers(self.token.decode(), self.stamp_secret, headers, peer)

        async def send_with_probe(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message).update(extra)
            await send(message)

        await self.app(scope, receive, send_with_probe)


def install_probe(app: FastAPI, settings: Settings) -> None:
    """Add the probe to the app when ``limiter_probe_token`` is set; otherwise add nothing."""
    if settings.limiter_probe_token:
        app.add_middleware(
            LimiterProbe, token=settings.limiter_probe_token, stamp_secret=settings.visitor_stamp_secret
        )
