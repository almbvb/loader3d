from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict
from sqlalchemy.engine import make_url

BACKEND_DIR = Path(__file__).resolve().parent.parent

# Used only when ENVIRONMENT=development and JWT_SECRET is not set; production refuses to start with it.
DEV_JWT_SECRET = "loader3d-development-secret-do-not-use-in-production"


class Settings(BaseSettings):
    """Runtime configuration from environment variables (and backend/.env in development)."""

    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    environment: Literal["development", "production"] = "development"

    # sqlite+aiosqlite:///path.db in development, postgresql+asyncpg://user@host:5432/db in production.
    database_url: str = f"sqlite+aiosqlite:///{(BACKEND_DIR / 'loader3d.db').as_posix()}"
    # Kept out of the URL so any characters work; overrides the password in DATABASE_URL.
    database_password: SecretStr | None = None

    jwt_secret: SecretStr = SecretStr(DEV_JWT_SECRET)
    access_token_ttl_minutes: int = Field(15, ge=1, le=24 * 60)
    refresh_token_ttl_days: int = Field(30, ge=1, le=365)

    registration_open: bool = True
    # Comma-separated origins allowed to call the API cross-origin.
    # Empty: same-origin only, which is how Caddy (production) and the Vite proxy (development) serve it.
    cors_origins: Annotated[list[str], NoDecode] = []

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @model_validator(mode="after")
    def _check_production(self) -> Settings:
        if self.environment == "production":
            secret = self.jwt_secret.get_secret_value()
            if secret == DEV_JWT_SECRET or len(secret) < 32:
                raise ValueError("JWT_SECRET must be set to a random string of at least 32 characters")
        return self

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def sqlalchemy_url(self) -> str:
        url = make_url(self.database_url)
        if self.database_password is not None:
            url = url.set(password=self.database_password.get_secret_value())
        return url.render_as_string(hide_password=False)


@lru_cache
def get_settings() -> Settings:
    return Settings()
