"""Login sessions: issuing, rotating and revoking token pairs, and the `CurrentAuth` dependency.

Access token: short-lived JWT in `Authorization: Bearer`. Every request also checks that its session
is still active, so logout and "end session" take effect immediately, not when the token expires.
Refresh token: long-lived JWT in an httpOnly cookie scoped to /api/auth, rotated on every use.
"""

import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import Depends, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db import Db
from app.deps import SettingsDep
from app.errors import unauthorized
from app.models import AuthSession, User, utcnow
from app.security import InvalidTokenError, decode_token, encode_token, new_jti

REFRESH_COOKIE = "loader3d_refresh"
# The browser sends the refresh cookie only to /api/auth/* (refresh, logout), not to the rest of the API.
REFRESH_COOKIE_PATH = "/api/auth"
# A refresh token replaced this recently is still honoured: parallel tabs refresh at the same moment.
REFRESH_REUSE_GRACE = timedelta(seconds=30)

SESSION_ENDED = "Сессия завершена, войдите снова"


@dataclass(frozen=True, slots=True)
class IssuedTokens:
    access_token: str
    expires_in: int
    refresh_token: str
    refresh_expires_at: datetime


@dataclass(frozen=True, slots=True)
class AuthContext:
    user: User
    session: AuthSession


def _client_info(request: Request) -> dict[str, str | None]:
    user_agent = request.headers.get("user-agent")
    return {
        "user_agent": user_agent[:500] if user_agent else None,
        "ip_address": request.client.host[:45] if request.client else None,
    }


def _issue(settings: Settings, session: AuthSession) -> IssuedTokens:
    ttl = timedelta(minutes=settings.access_token_ttl_minutes)
    access = encode_token(
        settings,
        "access",
        user_id=session.user_id,
        session_id=session.id,
        jti=secrets.token_urlsafe(16),
        expires_at=utcnow() + ttl,
    )
    refresh = encode_token(
        settings,
        "refresh",
        user_id=session.user_id,
        session_id=session.id,
        jti=session.refresh_jti,
        expires_at=session.expires_at,
    )
    return IssuedTokens(access, int(ttl.total_seconds()), refresh, session.expires_at)


async def start_session(db: AsyncSession, settings: Settings, user: User, request: Request) -> IssuedTokens:
    """Creates a session for a fresh login. The caller commits."""
    now = utcnow()
    # Housekeeping: forget this user's finished sessions.
    await db.execute(
        delete(AuthSession)
        .where(
            AuthSession.user_id == user.id,
            or_(AuthSession.expires_at <= now, AuthSession.revoked_at.is_not(None)),
        )
        .execution_options(synchronize_session=False)
    )
    session = AuthSession(
        user_id=user.id,
        refresh_jti=new_jti(),
        created_at=now,
        last_used_at=now,
        expires_at=now + timedelta(days=settings.refresh_token_ttl_days),
        **_client_info(request),
    )
    db.add(session)
    await db.flush()
    return _issue(settings, session)


async def refresh_session(
    db: AsyncSession, settings: Settings, refresh_token: str | None, request: Request
) -> tuple[User, IssuedTokens]:
    """Exchanges a refresh token for a new pair (rotation). Commits."""
    if not refresh_token:
        raise unauthorized("no_refresh_token", "Требуется вход")
    try:
        claims = decode_token(settings, refresh_token, "refresh")
    except InvalidTokenError:
        raise unauthorized("invalid_refresh_token", SESSION_ENDED) from None

    row = (
        await db.execute(
            select(AuthSession, User)
            .join(AuthSession.user)
            .where(AuthSession.id == claims.session_id, AuthSession.user_id == claims.user_id)
        )
    ).first()
    now = utcnow()

    def ensure_active(session: AuthSession, user: User) -> None:
        if session.revoked_at is not None or session.expires_at <= now or not user.is_active:
            raise unauthorized("session_expired", SESSION_ENDED)

    if row is None:
        raise unauthorized("session_expired", SESSION_ENDED)
    session, user = row
    ensure_active(session, user)

    if claims.jti == session.refresh_jti:
        if session.rotated_at is not None and now - session.rotated_at <= REFRESH_REUSE_GRACE:
            # Rotated a moment ago (another tab, a reloaded page): hand out the current token again
            # instead of rotating once more, so the token it replaced stays valid for the whole grace
            # period. Otherwise a tab still holding that one would look like a thief.
            return user, _issue(settings, session)
        rotated = await db.execute(
            update(AuthSession)
            .where(AuthSession.id == session.id, AuthSession.refresh_jti == claims.jti)
            .values(
                refresh_jti=new_jti(),
                previous_jti=claims.jti,
                rotated_at=now,
                last_used_at=now,
                expires_at=now + timedelta(days=settings.refresh_token_ttl_days),
                **_client_info(request),
            )
            .execution_options(synchronize_session=False)
        )
        # Commit even when nothing was updated: on SQLite the UPDATE holds the database write lock.
        await db.commit()
        await db.refresh(session)
        if rotated.rowcount == 1:  # type: ignore[attr-defined]
            return user, _issue(settings, session)
        # A parallel request rotated this token first: it is now the previous one, handled below.
        ensure_active(session, user)

    if (
        claims.jti == session.previous_jti
        and session.rotated_at is not None
        and now - session.rotated_at <= REFRESH_REUSE_GRACE
    ):
        return user, _issue(settings, session)

    # A refresh token that was replaced long ago has been copied: end the session for everyone holding it.
    session.revoked_at = now
    await db.commit()
    raise unauthorized("refresh_token_reused", "Сессия завершена из соображений безопасности, войдите снова")


async def revoke_sessions(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    only: uuid.UUID | None = None,
    keep: uuid.UUID | None = None,
) -> int:
    """Revokes the user's active sessions (one, all, or all but `keep`). The caller commits."""
    stmt = update(AuthSession).where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
    if only is not None:
        stmt = stmt.where(AuthSession.id == only)
    if keep is not None:
        stmt = stmt.where(AuthSession.id != keep)
    result = await db.execute(stmt.values(revoked_at=utcnow()).execution_options(synchronize_session=False))
    return result.rowcount  # type: ignore[attr-defined]


async def end_session_by_refresh_token(
    db: AsyncSession, settings: Settings, refresh_token: str | None
) -> None:
    """Logout: revokes the session the cookie belongs to; an invalid cookie is simply ignored. Commits."""
    if not refresh_token:
        return
    try:
        claims = decode_token(settings, refresh_token, "refresh")
    except InvalidTokenError:
        return
    await revoke_sessions(db, claims.user_id, only=claims.session_id)
    await db.commit()


def set_refresh_cookie(response: Response, settings: Settings, tokens: IssuedTokens) -> None:
    response.set_cookie(
        REFRESH_COOKIE,
        tokens.refresh_token,
        max_age=max(0, int((tokens.refresh_expires_at - utcnow()).total_seconds())),
        path=REFRESH_COOKIE_PATH,
        secure=settings.secure_cookies,
        httponly=True,
        samesite="strict",
    )


def clear_refresh_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        REFRESH_COOKIE,
        path=REFRESH_COOKIE_PATH,
        secure=settings.secure_cookies,
        httponly=True,
        samesite="strict",
    )


def clear_refresh_cookie_headers(settings: Settings) -> dict[str, str]:
    """`Set-Cookie` that removes the refresh cookie, for error responses raised as exceptions."""
    response = Response()
    clear_refresh_cookie(response, settings)
    return {"set-cookie": response.headers["set-cookie"]}


_bearer = HTTPBearer(auto_error=False, description="accessToken из /api/auth/login, /register или /refresh")


async def get_auth(
    db: Db,
    settings: SettingsDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> AuthContext:
    if credentials is None:
        raise unauthorized()
    try:
        claims = decode_token(settings, credentials.credentials, "access")
    except InvalidTokenError as exc:
        # token_expired: the client should call /api/auth/refresh and retry.
        raise unauthorized("token_expired" if exc.expired else "invalid_token", SESSION_ENDED) from None

    row = (
        await db.execute(
            select(AuthSession, User)
            .join(AuthSession.user)
            .where(
                AuthSession.id == claims.session_id,
                AuthSession.user_id == claims.user_id,
                AuthSession.revoked_at.is_(None),
                AuthSession.expires_at > utcnow(),
                User.is_active.is_(True),
            )
        )
    ).first()
    if row is None:
        raise unauthorized("session_expired", SESSION_ENDED)
    session, user = row
    return AuthContext(user=user, session=session)


CurrentAuth = Annotated[AuthContext, Depends(get_auth)]
