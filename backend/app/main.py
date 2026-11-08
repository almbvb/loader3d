from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings, get_settings
from app.db import create_engine, create_sessionmaker
from app.routers import admin, auth, health, leads, plans, users

API_PREFIX = "/api"


def create_app(settings: Settings | None = None) -> FastAPI:
    """App factory: `uvicorn app.main:create_app --factory`, or `python -m app`."""
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = create_engine(settings.sqlalchemy_url)
        app.state.engine = engine
        app.state.sessionmaker = create_sessionmaker(engine)
        try:
            yield
        finally:
            await engine.dispose()

    app = FastAPI(
        title="Loader3D API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=f"{API_PREFIX}/docs",
        redoc_url=None,
        openapi_url=f"{API_PREFIX}/openapi.json",
    )
    app.state.settings = settings

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    for module in (health, auth, users, plans, leads, admin):
        app.include_router(module.router, prefix=API_PREFIX)
    return app
