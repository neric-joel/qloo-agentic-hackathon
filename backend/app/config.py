from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

from .qloo.client import HACKATHON_BASE_URL


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    qloo_api_key: str | None = None
    qloo_base_url: str = HACKATHON_BASE_URL
    qloo_record_fixtures: bool = False
    fixtures_dir: Path = Path(__file__).parent / "qloo" / "fixtures"
    # Prebuilt demo presets (Qloo-derived): shipped with the deployment, never committed
    presets_dir: Path | None = Path(__file__).resolve().parent.parent / "presets"
    # Recorded agent runs per preset (Qloo-derived, same rule): replayed by the web app without a model call
    recordings_dir: Path | None = Path(__file__).resolve().parent.parent / "presets" / "recordings"

    # LLM access: "gateway" (Vercel AI Gateway) or "anthropic" (direct API key). "none" disables runs.
    llm_provider: Literal["none", "gateway", "anthropic"] = "none"
    anthropic_api_key: str | None = None
    ai_gateway_api_key: str | None = None
    agent_model: str | None = None
    agent_effort: Literal["low", "medium", "high"] = "low"
    agent_max_tokens: int = 2500  # per-turn output ceiling (thinking included); bounds runaway cost
    # Per-run caps: a run stops after this many model turns, skips tool calls past the per-turn cap,
    # and refuses further Qloo-backed tools once it has made this many Qloo requests
    agent_max_turns: int = 6
    agent_max_tool_calls_per_turn: int = 6
    agent_max_qloo_calls_per_run: int = 12
    # Live agent run caps (per server instance; the provider's spend limit is the hard stop)
    runs_per_visitor_hour: int = 8
    runs_per_visitor_day: int = 20
    runs_per_day: int = 150

    # Public surface: the generic "explore" scenario and the API docs are off unless switched on
    allow_explore: bool = False
    docs_enabled: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
