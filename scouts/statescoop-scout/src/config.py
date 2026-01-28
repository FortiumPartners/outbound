"""
Configuration management using Pydantic Settings.

Loads configuration from environment variables with sensible defaults.
"""

from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Outbound API
    outbound_api_url: str = Field(
        default="http://localhost:8004",
        description="Base URL for the Outbound API",
    )
    outbound_api_key: str | None = Field(
        default=None,
        description="Optional API key for Outbound authentication",
    )

    # Anthropic API
    anthropic_api_key: str = Field(
        description="Anthropic API key for Claude entity extraction",
    )

    # Scout Configuration
    dry_run: bool = Field(
        default=False,
        description="When true, skip actual signal creation",
    )
    log_level: str = Field(
        default="INFO",
        description="Logging level (DEBUG, INFO, WARNING, ERROR)",
    )
    lookback_days: int = Field(
        default=7,
        description="How far back to check articles (in days)",
    )
    fetch_full_article: bool = Field(
        default=True,
        description="Whether to fetch full article text for better extraction",
    )
    rate_limit_ms: int = Field(
        default=1000,
        description="Delay between HTTP requests in milliseconds",
    )

    # RSS Feed
    rss_feed_url: str = Field(
        default="https://statescoop.com/feed/",
        description="StateScoop RSS feed URL",
    )

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": False,
    }


# Singleton instance
_settings: Settings | None = None


def get_settings() -> Settings:
    """Get the singleton settings instance."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
