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

    # LLM access: "gateway" (Vercel AI Gateway) or "anthropic" (direct API key). "none" disables runs.
    llm_provider: Literal["none", "gateway", "anthropic"] = "none"
    anthropic_api_key: str | None = None
    ai_gateway_api_key: str | None = None
    agent_model: str | None = None
    agent_effort: Literal["low", "medium", "high"] = "medium"


@lru_cache
def get_settings() -> Settings:
    return Settings()
