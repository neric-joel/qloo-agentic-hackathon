"""Shared per-instance dependencies: the Qloo client and the live pair check's limiter.

Both are created lazily on first use (serverless-friendly: no lifespan hooks needed). Tests replace them with
``app.dependency_overrides``.
"""

from __future__ import annotations

from .config import get_settings
from .limits import PAIR_MESSAGES, RunLimiter
from .qloo.client import QlooClient

_qloo: QlooClient | None = None
_pair_limiter: RunLimiter | None = None


def get_qloo() -> QlooClient:
    """Create the shared Qloo client lazily (serverless-friendly: no lifespan hooks needed)."""
    global _qloo
    if _qloo is None:
        settings = get_settings()
        _qloo = QlooClient(
            settings.qloo_api_key,
            settings.qloo_base_url,
            fixtures_dir=settings.fixtures_dir,
            record_fixtures=settings.qloo_record_fixtures,
        )
    return _qloo


def get_pair_limiter() -> RunLimiter:
    """Caps on live pair checks, per visitor and for the whole instance."""
    global _pair_limiter
    if _pair_limiter is None:
        settings = get_settings()
        _pair_limiter = RunLimiter(
            settings.pair_checks_per_visitor_hour,
            settings.pair_checks_per_visitor_day,
            settings.pair_checks_per_day,
            messages=PAIR_MESSAGES,
        )
    return _pair_limiter
