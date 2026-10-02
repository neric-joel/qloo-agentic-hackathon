"""LLM backends for the agent loop.

``AnthropicBackend`` talks to Claude either directly or through the Vercel AI Gateway (same
Messages API, different base URL and credentials). ``ScriptedBackend`` replays a fixed sequence
of assistant turns; it exists for tests and offline UI work and is never used in production.
"""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable, Sequence
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


class AnthropicBackend:
    """One streamed Messages API call per agent turn."""

    def __init__(self, client: AsyncAnthropic, model: str, *, effort: str = "medium") -> None:
        self.client = client
        self.model = model
        self.effort = effort
        self.name = model

    async def turn(
        self,
        *,
        system: Sequence[dict[str, Any]],
        messages: list[dict[str, Any]],
        tools: Sequence[dict[str, Any]],
        on_text: OnText,
    ) -> Message:
        async with self.client.messages.stream(
            model=self.model,
            max_tokens=16000,
            system=list(system),
            messages=messages,
            tools=list(tools),
            output_config={"effort": self.effort},
            cache_control={"type": "ephemeral"},
        ) as stream:
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
    """AI Gateway credential: explicit key, else the deployment's OIDC token (header first, then env)."""
    if settings.ai_gateway_api_key:
        return settings.ai_gateway_api_key
    if request_headers and (token := request_headers.get("x-vercel-oidc-token")):
        return token
    return os.environ.get("VERCEL_OIDC_TOKEN")


def build_backend(settings: Settings, request_headers: dict[str, str] | None = None) -> LLMBackend | None:
    """Return the configured backend, or ``None`` when no LLM is configured."""
    provider = settings.llm_provider
    if provider == "anthropic" and settings.anthropic_api_key:
        client = AsyncAnthropic(api_key=settings.anthropic_api_key, max_retries=2, timeout=60.0)
        return AnthropicBackend(
            client, settings.agent_model or DEFAULT_MODELS["anthropic"], effort=settings.agent_effort
        )
    if provider == "gateway" and (token := gateway_token(settings, request_headers)):
        client = AsyncAnthropic(api_key=token, base_url=GATEWAY_BASE_URL, max_retries=2, timeout=60.0)
        return AnthropicBackend(
            client, settings.agent_model or DEFAULT_MODELS["gateway"], effort=settings.agent_effort
        )
    return None
