import asyncio
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse

from .agent.events import EventChannel
from .agent.llm import LLMBackend, build_backend
from .config import get_settings
from .limits import RunLimiter, visitor_key
from .presets import Presets
from .presets import router as presets_router
from .qloo.client import QlooClient
from .runs import RunRequest, execute_run
from .schedule.api import router as schedule_router

app = FastAPI(title="Agent API", version="0.1.0")
app.include_router(schedule_router)
app.include_router(presets_router)

_qloo: QlooClient | None = None
_limiter: RunLimiter | None = None


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


def get_limiter() -> RunLimiter:
    global _limiter
    if _limiter is None:
        settings = get_settings()
        _limiter = RunLimiter(
            settings.runs_per_visitor_hour, settings.runs_per_visitor_day, settings.runs_per_day
        )
    return _limiter


def get_backend(request: Request) -> LLMBackend | None:
    return build_backend(get_settings(), dict(request.headers))


@app.get("/api/health")
async def health(request: Request) -> dict[str, object]:
    settings = get_settings()
    return {
        "status": "ok",
        "qloo_key_configured": bool(settings.qloo_api_key),
        "llm_configured": get_backend(request) is not None,
    }


@app.post("/api/runs")
async def create_run(
    body: RunRequest,
    request: Request,
    backend: Annotated[LLMBackend | None, Depends(get_backend)],
    qloo: Annotated[QlooClient, Depends(get_qloo)],
    presets: Presets,
    limiter: Annotated[RunLimiter, Depends(get_limiter)],
) -> StreamingResponse:
    if backend is None:
        raise HTTPException(status_code=503, detail="The agent is not configured on this server yet.")
    host = request.client.host if request.client else None
    refusal = limiter.try_acquire(visitor_key(dict(request.headers), host))
    if refusal:
        raise HTTPException(status_code=429, detail=refusal)

    channel = EventChannel()
    task = asyncio.create_task(execute_run(channel, backend, qloo, body, presets))

    async def frames() -> AsyncIterator[str]:
        try:
            async for frame in channel.frames():
                if await request.is_disconnected():
                    break
                yield frame
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        frames(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )
