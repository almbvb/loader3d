import uuid
from typing import Annotated

from fastapi import APIRouter, Cookie, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.auth import (
    REFRESH_COOKIE,
    CurrentAuth,
    IssuedTokens,
    clear_refresh_cookie,
    clear_refresh_cookie_headers,
    end_session_by_refresh_token,
    refresh_session,
    revoke_sessions,
    set_refresh_cookie,
    start_session,
)
from app.db import Db
from app.deps import SettingsDep
from app.errors import ApiError, not_found, unauthorized
from app.models import AuthSession, User, utcnow
from app.schemas.auth import AuthOut, LoginIn, RegisterIn, SessionOut, UserOut
from app.security import hash_password, password_needs_rehash, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

RefreshCookie = Annotated[str | None, Cookie(alias=REFRESH_COOKIE, include_in_schema=False)]


def _auth_response(response: Response, request: Request, user: User, tokens: IssuedTokens) -> AuthOut:
    set_refresh_cookie(response, request, tokens)
    return AuthOut(
        access_token=tokens.access_token, expires_in=tokens.expires_in, user=UserOut.model_validate(user)
    )


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterIn, request: Request, response: Response, db: Db, settings: SettingsDep
) -> AuthOut:
    """Creates an account and logs in (sets the refresh cookie)."""
    if not settings.registration_open:
        raise ApiError(status.HTTP_403_FORBIDDEN, "registration_closed", "Регистрация закрыта")
    email_taken = ApiError(status.HTTP_409_CONFLICT, "email_taken", "Этот email уже зарегистрирован")
    if await db.scalar(select(User.id).where(User.email == body.email)):
        raise email_taken

    user = User(
        email=body.email,
        password_hash=await hash_password(body.password),
        display_name=body.display_name or body.email.split("@", 1)[0][:100],
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        raise email_taken from None
    tokens = await start_session(db, settings, user, request)
    await db.commit()
    return _auth_response(response, request, user, tokens)


@router.post("/login")
async def login(
    body: LoginIn, request: Request, response: Response, db: Db, settings: SettingsDep
) -> AuthOut:
    user = await db.scalar(select(User).where(User.email == body.email))
    if (
        not await verify_password(user.password_hash if user else None, body.password)
        or not user
        or not user.is_active
    ):
        raise unauthorized("invalid_credentials", "Неверный email или пароль")
    if password_needs_rehash(user.password_hash):
        user.password_hash = await hash_password(body.password)
    tokens = await start_session(db, settings, user, request)
    await db.commit()
    return _auth_response(response, request, user, tokens)


@router.post("/refresh")
async def refresh(
    request: Request, response: Response, db: Db, settings: SettingsDep, refresh_token: RefreshCookie = None
) -> AuthOut:
    """New access token (and rotated refresh cookie). Call on app start and on `token_expired`."""
    try:
        user, tokens = await refresh_session(db, settings, refresh_token, request)
    except ApiError as exc:
        exc.headers = {**(exc.headers or {}), **clear_refresh_cookie_headers(request)}
        raise
    return _auth_response(response, request, user, tokens)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request, response: Response, db: Db, settings: SettingsDep, refresh_token: RefreshCookie = None
) -> None:
    """Ends the current session. Works with an expired access token: only the cookie is needed."""
    await end_session_by_refresh_token(db, settings, refresh_token)
    clear_refresh_cookie(response, request)


@router.get("/sessions")
async def list_sessions(auth: CurrentAuth, db: Db) -> list[SessionOut]:
    """Active sessions (devices) of the current user, most recently used first."""
    sessions = await db.scalars(
        select(AuthSession)
        .where(
            AuthSession.user_id == auth.user.id,
            AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > utcnow(),
        )
        .order_by(AuthSession.last_used_at.desc(), AuthSession.id.desc())
    )
    return [
        SessionOut(
            id=s.id,
            created_at=s.created_at,
            last_used_at=s.last_used_at,
            expires_at=s.expires_at,
            user_agent=s.user_agent,
            ip_address=s.ip_address,
            current=s.id == auth.session.id,
        )
        for s in sessions
    ]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_session(
    session_id: uuid.UUID, auth: CurrentAuth, request: Request, response: Response, db: Db
) -> None:
    if not await revoke_sessions(db, auth.user.id, only=session_id):
        raise not_found("session_not_found", "Сессия не найдена")
    await db.commit()
    if session_id == auth.session.id:
        clear_refresh_cookie(response, request)


@router.delete("/sessions", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_other_sessions(auth: CurrentAuth, db: Db) -> None:
    """Log out on all other devices."""
    await revoke_sessions(db, auth.user.id, keep=auth.session.id)
    await db.commit()
