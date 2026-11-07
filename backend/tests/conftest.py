"""Test fixtures. Tests run on a temporary SQLite file; set TEST_DATABASE_URL to run them on Postgres
(e.g. postgresql+asyncpg://loader3d:loader3d@localhost:5432/loader3d_test — the database is wiped)."""

import os
from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import update

from app.config import Settings
from app.main import create_app
from app.models import Base, User
from app.routers import leads

TEST_JWT_SECRET = "test-secret-0123456789abcdef0123456789abcdef"
PASSWORD = "correct horse battery"


def make_settings(tmp_path: Path, **overrides: Any) -> Settings:
    url = os.environ.get("TEST_DATABASE_URL") or f"sqlite+aiosqlite:///{(tmp_path / 'test.db').as_posix()}"
    values: dict[str, Any] = {
        "database_url": url,
        "jwt_secret": TEST_JWT_SECRET,
        "environment": "development",
    }
    return Settings(_env_file=None, **(values | overrides))  # type: ignore[call-arg]


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return make_settings(tmp_path)


@pytest.fixture
async def app(settings: Settings) -> AsyncIterator[FastAPI]:
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with app.state.engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        yield app


ClientFactory = Callable[..., Awaitable[httpx.AsyncClient]]


@pytest.fixture
async def make_client(app: FastAPI) -> AsyncIterator[ClientFactory]:
    """Independent clients (own cookie jar) = different browsers/devices."""
    clients: list[httpx.AsyncClient] = []

    async def factory(user_agent: str = "pytest") -> httpx.AsyncClient:
        client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
            headers={"user-agent": user_agent},
        )
        clients.append(client)
        return client

    yield factory
    for client in clients:
        await client.aclose()


@pytest.fixture
async def client(make_client: ClientFactory) -> httpx.AsyncClient:
    return await make_client()


async def register(
    client: httpx.AsyncClient, email: str = "anna@example.com", password: str = PASSWORD, **extra: Any
) -> str:
    """Registers (and so logs in) the client; returns the access token and sets it as the default header."""
    response = await client.post("/api/auth/register", json={"email": email, "password": password, **extra})
    assert response.status_code == 201, response.text
    token = response.json()["accessToken"]
    client.headers["authorization"] = f"Bearer {token}"
    return token


async def login(client: httpx.AsyncClient, email: str = "anna@example.com", password: str = PASSWORD) -> str:
    response = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    token = response.json()["accessToken"]
    client.headers["authorization"] = f"Bearer {token}"
    return token


def error_code(response: httpx.Response) -> str:
    return response.json()["detail"]["code"]


@pytest.fixture(autouse=True)
def _reset_lead_rate_limit():
    leads._recent.clear()


async def make_admin(app: FastAPI, email: str = "anna@example.com") -> None:
    """What `python -m app make-admin` does."""
    async with app.state.sessionmaker() as db:
        await db.execute(update(User).where(User.email == email).values(is_admin=True))
        await db.commit()
