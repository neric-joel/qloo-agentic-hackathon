"""LLM backends for the agent loop.

The provider backend talks to the model provider either directly or through the hosting gateway (same
Messages API, different base URL and credentials). ``ScriptedBackend`` replays a fixed sequence
of assistant turns; it exists for tests and offline UI work and is never used in production.
"""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable, Sequence
from functools import lru_cache
from typing import Any, Protocol

from anthropic import AsyncAnthropic
from anthropic.types import Message, TextBlock, ToolUseBlock, Usage

from ..config import Settings
from .events import new_id

OnText = Callable[[str], Awaitable[None]]

GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh"
DEFAULT_MODELS = {
    "anthropic": "claude-sonnet-5-5",
    "gateway": "anthropic/claude-sonnet-5.5",
}


class LLMBackend(Protocol):
    name: str

    async def turn(
        self,
        *,
        system: Sequence[dict[str, Any]],
        messages: list[dict[str, Any]],
        tools: Sequence[dict[str, Any]],
        on_text: OnText,
    ) -> Message: ...


# Server-side refusal fallback: if the model declines, the API re-runs the turn on a fallback model.
FALLBACK_BETA = "server-side-fallback-2026-07-01"


def supports_effort(model: str) -> bool:
    """Some smaller models reject ``output_config.effort``; the default models accept it."""
    return "haiku" not in model


class AnthropicBackend:
    """One streamed Messages API call per agent turn.

    ``max_tokens`` caps one turn's output (thinking included), which bounds the cost of a runaway turn.
    ``fallbacks`` turns on the server-side refusal fallback (direct API only).
    """

    def __init__(
        self,
        client: AsyncAnthropic,
        model: str,
        *,
        effort: str = "medium",
        max_tokens: int = 8000,
        fallbacks: bool = False,
    ) -> None:
        self.client = client
        self.model = model
        self.effort = effort
        self.max_tokens = max_tokens
        self.fallbacks = fallbacks
        self.name = model

    async def turn(
        self,
        *,
        system: Sequence[dict[str, Any]],
        messages: list[dict[str, Any]],
        tools: Sequence[dict[str, Any]],
        on_text: OnText,
    ) -> Message:
        params: dict[str, Any] = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "system": list(system),
            "messages": messages,
            "tools": list(tools),
            "cache_control": {"type": "ephemeral"},
        }
        if supports_effort(self.model):
            params["output_config"] = {"effort": self.effort}
        if self.fallbacks:
            stream_ctx = self.client.beta.messages.stream(
                **params, betas=[FALLBACK_BETA], fallbacks="default"
            )
        else:
            stream_ctx = self.client.messages.stream(**params)
        async with stream_ctx as stream:
            async for event in stream:
                if event.type == "text":
                    await on_text(event.text)
            return await stream.get_final_message()


class ScriptedBackend:
    """Replays scripted assistant turns. Each turn is a list of blocks:
    ``{"text": "..."}`` or ``{"tool": "name", "input": {...}}``."""

    name = "scripted"

    def __init__(self, turns: Sequence[Sequence[dict[str, Any]]]) -> None:
        self._turns = [list(turn) for turn in turns]

    async def turn(
        self,
        *,
        system: Sequence[dict[str, Any]],
        messages: list[dict[str, Any]],
        tools: Sequence[dict[str, Any]],
        on_text: OnText,
    ) -> Message:
        blocks = self._turns.pop(0) if self._turns else [{"text": "Done."}]
        content: list[Any] = []
        for block in blocks:
            if "tool" in block:
                content.append(
                    ToolUseBlock.model_construct(
                        type="tool_use", id=new_id("toolu"), name=block["tool"], input=block["input"]
                    )
                )
            else:
                await on_text(block["text"])
                content.append(TextBlock.model_construct(type="text", text=block["text"], citations=None))
        has_tool = any(getattr(b, "type", "") == "tool_use" for b in content)
        return Message.model_construct(
            id=new_id("msg"),
            type="message",
            role="assistant",
            model=self.name,
            content=content,
            stop_reason="tool_use" if has_tool else "end_turn",
            stop_sequence=None,
            usage=Usage.model_construct(input_tokens=0, output_tokens=0),
        )


def gateway_token(settings: Settings, request_headers: dict[str, str] | None = None) -> str | None:
    """Gateway credential: explicit key, else the deployment's OIDC token (header first, then env)."""
    if settings.ai_gateway_api_key:
        return settings.ai_gateway_api_key
    if request_headers and (token := request_headers.get("x-vercel-oidc-token")):
        return token
    return os.environ.get("VERCEL_OIDC_TOKEN")


def llm_configured(settings: Settings, request_headers: dict[str, str] | None = None) -> bool:
    """Whether ``build_backend`` would return a backend, without building one (or any client)."""
    if settings.llm_provider == "anthropic":
        return bool(settings.anthropic_api_key)
    if settings.llm_provider == "gateway":
        return bool(gateway_token(settings, request_headers))
    return False


@lru_cache(maxsize=4)  # a few entries: gateway OIDC tokens rotate
def anthropic_client(api_key: str, base_url: str | None = None) -> AsyncAnthropic:
    """One client (and connection pool) per credential and endpoint, shared across requests."""
    return AsyncAnthropic(api_key=api_key, base_url=base_url, max_retries=2, timeout=60.0)


def build_backend(settings: Settings, request_headers: dict[str, str] | None = None) -> LLMBackend | None:
    """Return the configured backend, or ``None`` when no LLM is configured."""
    provider = settings.llm_provider
    if provider == "anthropic" and settings.anthropic_api_key:
        client = anthropic_client(settings.anthropic_api_key)
        model = settings.agent_model or DEFAULT_MODELS["anthropic"]
        return AnthropicBackend(
            client,
            model,
            effort=settings.agent_effort,
            max_tokens=settings.agent_max_tokens,
            fallbacks="sonnet-5-5" in model,
        )
    if provider == "gateway" and (token := gateway_token(settings, request_headers)):
        client = anthropic_client(token, GATEWAY_BASE_URL)
        return AnthropicBackend(
            client,
            settings.agent_model or DEFAULT_MODELS["gateway"],
            effort=settings.agent_effort,
            max_tokens=settings.agent_max_tokens,
        )
    return None
