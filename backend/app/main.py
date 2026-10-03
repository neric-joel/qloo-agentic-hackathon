import asyncio
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse

from .agent.events import EventChannel
from .agent.llm import LLMBackend, build_backend, llm_configured
from .config import Settings, get_settings
from .deps import get_qloo
from .limits import RunLimiter, visitor_key
from .pair import NoStoreOnPairRoute
from .pair import router as pair_router
from .presets import Presets
from .presets import router as presets_router
from .qloo.client import QlooClient
from .recordings import router as recordings_router
from .runs import ClashInput, ExploreInput, RunRequest, SessionError, clash_state, execute_run
from .schedule.api import router as schedule_router
from .whatif import router as whatif_router

MAX_ERRORS = 10  # validation errors returned in one 422 body
MAX_ERROR_TEXT = 200


def _docs_urls(settings: Settings) -> dict[str, Any]:
    """The interactive docs and the OpenAPI schema stay off on the public deployment unless DOCS_ENABLED."""
    if settings.docs_enabled:
        return {}
    return {"docs_url": None, "redoc_url": None, "openapi_url": None}


app = FastAPI(title="Clash Control API", version="0.1.0", **_docs_urls(get_settings()))
app.include_router(schedule_router)
app.include_router(presets_router)
app.include_router(recordings_router)
app.include_router(pair_router)
app.include_router(whatif_router)
app.add_middleware(NoStoreOnPairRoute)

_limiter: RunLimiter | None = None


@app.exception_handler(RequestValidationError)
async def validation_failed(request: Request, exc: RequestValidationError) -> JSONResponse:
    """A 422 that names what is wrong but never echoes the request back (no ``input``, no ``ctx``).

    Echoing made huge bodies come back doubled, and a non-finite number in the input crashed the encoder.
    """
    detail = [
        {
            "loc": [part if isinstance(part, int) else str(part)[:MAX_ERROR_TEXT] for part in error["loc"]],
            "msg": str(error.get("msg", ""))[:MAX_ERROR_TEXT],
            "type": str(error.get("type", "")),
        }
        for error in exc.errors()[:MAX_ERRORS]
    ]
    return JSONResponse(status_code=422, content={"detail": detail}, headers={"Cache-Control": "no-store"})


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
async def health(request: Request, settings: Annotated[Settings, Depends(get_settings)]) -> dict[str, object]:
    return {
        "status": "ok",
        "qloo_key_configured": bool(settings.qloo_api_key),
        "llm_configured": llm_configured(settings, dict(request.headers)),
        "pair_check": settings.pair_check_enabled and bool(settings.qloo_api_key),
    }


@app.post("/api/runs")
async def create_run(
    body: RunRequest,
    request: Request,
    backend: Annotated[LLMBackend | None, Depends(get_backend)],
    qloo: Annotated[QlooClient, Depends(get_qloo)],
    presets: Presets,
    limiter: Annotated[RunLimiter, Depends(get_limiter)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> StreamingResponse:
    if backend is None:
        raise HTTPException(status_code=503, detail="The agent is not configured on this server yet.")
    # Refuse what cannot run before it takes a limiter slot. What runs follows the input's shape (a scenario
    # that contradicts it is a 422 already).
    if isinstance(body.input, ExploreInput) and not settings.allow_explore:
        raise HTTPException(status_code=404, detail="That scenario is not available.")
    if isinstance(body.input, ClashInput):
        preset = presets.get(body.input.preset_id)
        if preset is None:
            raise HTTPException(status_code=404, detail="That festival day is not available.")
        try:
            clash_state(preset, body.input)
        except SessionError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    host = request.client.host if request.client else None
    refusal = limiter.try_acquire(visitor_key(dict(request.headers), host))
    if refusal:
        raise HTTPException(status_code=429, detail=refusal)

    channel = EventChannel()
    task = asyncio.create_task(
        execute_run(
            channel,
            backend,
            qloo,
            body,
            presets,
            max_turns=settings.agent_max_turns,
            max_tool_calls=settings.agent_max_tool_calls_per_turn,
            max_qloo_calls=settings.agent_max_qloo_calls_per_run,
            max_reslots=settings.agent_max_reslots_per_run,
            max_engine_seconds=settings.agent_max_engine_seconds,
            qloo_floor=settings.qloo_quota_floor,
        )
    )

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
