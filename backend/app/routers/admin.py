"""Admin panel API: every route needs `is_admin` (grant it with `python -m app make-admin EMAIL`)."""

import uuid
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy import Select, delete, func, or_, select
from sqlalchemy.exc import IntegrityError

from app.auth import AdminAuth, revoke_sessions
from app.db import Db
from app.deps import SettingsDep
from app.errors import ApiError, not_found
from app.models import AuthSession, Lead, Plan, User, utcnow
from app.schemas.admin import (
    AdminStatsOut,
    AdminSubscriptionOut,
    AdminUserCreate,
    AdminUserOut,
    AdminUserPage,
    AdminUserSort,
    AdminUserStatus,
    AdminUserUpdate,
    LeadOut,
    LeadPage,
    LeadStatus,
    LeadUpdate,
    PasswordResetIn,
    SubscriptionIn,
)
from app.security import hash_password
from app.tiers import TIERS, Tier, effective_tier

router = APIRouter(prefix="/admin", tags=["admin"])


def _not_self(auth: AdminAuth, user: User) -> None:
    """An admin cannot lock themselves out: block, demote or delete their own account here."""
    if user.id == auth.user.id:
        raise ApiError(
            status.HTTP_400_BAD_REQUEST,
            "cannot_change_self",
            "Это действие нельзя применить к своему аккаунту",
        )


async def _get_user(db: Db, user_id: uuid.UUID) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise not_found("user_not_found", "Пользователь не найден")
    return user


def _users_query() -> Select[tuple[User, int, int, object]]:
    now = utcnow()
    plan_count = select(func.count(Plan.id)).where(Plan.owner_id == User.id).scalar_subquery()
    session_count = (
        select(func.count(AuthSession.id))
        .where(AuthSession.user_id == User.id, AuthSession.revoked_at.is_(None), AuthSession.expires_at > now)
        .scalar_subquery()
    )
    last_active = (
        select(func.max(AuthSession.last_used_at)).where(AuthSession.user_id == User.id).scalar_subquery()
    )
    return select(
        User,
        plan_count.label("plan_count"),
        session_count.label("session_count"),
        last_active.label("last_active_at"),
    )


def _tiers_disabled() -> ApiError:
    return not_found("tiers_disabled", "Тарифы отключены")


def _user_out(
    tiers_enabled: bool, user: User, plan_count: int, session_count: int, last_active_at: object
) -> AdminUserOut:
    return AdminUserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        is_admin=user.is_admin,
        is_active=user.is_active,
        created_at=user.created_at,
        last_active_at=last_active_at,  # type: ignore[arg-type]
        plan_count=plan_count,
        session_count=session_count,
        subscription=AdminSubscriptionOut.of(user) if tiers_enabled else None,
    )


async def _user_row(db: Db, settings: SettingsDep, user_id: uuid.UUID) -> AdminUserOut:
    row = (await db.execute(_users_query().where(User.id == user_id))).first()
    if row is None:
        raise not_found("user_not_found", "Пользователь не найден")
    return _user_out(settings.tiers_enabled, *row)


@router.get("/stats")
async def stats(auth: AdminAuth, db: Db, settings: SettingsDep) -> AdminStatsOut:
    now = utcnow()
    week_ago = now - timedelta(days=7)
    users = list(await db.scalars(select(User)))
    active = await db.scalar(
        select(func.count(func.distinct(AuthSession.user_id))).where(AuthSession.last_used_at >= week_ago)
    )
    by_tier = dict.fromkeys(TIERS, 0)
    for user in users:
        by_tier[effective_tier(user, now)] += 1
    return AdminStatsOut(
        users=len(users),
        new_last_7_days=sum(u.created_at >= week_ago for u in users),
        active_last_7_days=active or 0,
        blocked=sum(not u.is_active for u in users),
        admins=sum(u.is_admin for u in users),
        by_tier=by_tier if settings.tiers_enabled else None,
        plans=await db.scalar(select(func.count()).select_from(Plan)) or 0,
        new_leads=await db.scalar(select(func.count()).select_from(Lead).where(Lead.status == "new")) or 0,
    )


@router.get("/users")
async def list_users(
    auth: AdminAuth,
    db: Db,
    settings: SettingsDep,
    q: Annotated[str | None, Query(max_length=320, description="Поиск по email и имени")] = None,
    tier: Tier | None = None,
    status_: Annotated[AdminUserStatus | None, Query(alias="status")] = None,
    sort: AdminUserSort = "-createdAt",
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AdminUserPage:
    where = []
    if q and q.strip():
        needle = q.strip()
        where.append(
            or_(
                User.email.contains(needle.lower(), autoescape=True),
                User.display_name.contains(needle, autoescape=True),
                func.lower(User.display_name).contains(needle.lower(), autoescape=True),
            )
        )
    if tier is not None and settings.tiers_enabled:
        where.append(User.tier == tier)
    if status_ == "active":
        where.append(User.is_active.is_(True))
    elif status_ == "blocked":
        where.append(User.is_active.is_(False))
    elif status_ == "admins":
        where.append(User.is_admin.is_(True))

    query = _users_query().where(*where)
    order = {
        "createdAt": User.created_at.asc(),
        "-createdAt": User.created_at.desc(),
        "email": User.email.asc(),
        "-lastActiveAt": query.selected_columns.last_active_at.desc().nulls_last(),
    }[sort]
    total = await db.scalar(select(func.count()).select_from(User).where(*where)) or 0
    rows = await db.execute(query.order_by(order, User.id.desc()).limit(limit).offset(offset))
    items = [_user_out(settings.tiers_enabled, *row) for row in rows]
    return AdminUserPage(items=items, total=total, limit=limit, offset=offset)


@router.post("/users", status_code=status.HTTP_201_CREATED)
async def create_user(body: AdminUserCreate, auth: AdminAuth, db: Db, settings: SettingsDep) -> AdminUserOut:
    email_taken = ApiError(status.HTTP_409_CONFLICT, "email_taken", "Этот email уже зарегистрирован")
    if await db.scalar(select(User.id).where(User.email == body.email)):
        raise email_taken
    user = User(
        email=body.email,
        password_hash=await hash_password(body.password),
        display_name=body.display_name or body.email.split("@", 1)[0][:100],
        is_admin=body.is_admin,
    )
    if settings.tiers_enabled:
        user.tier = body.tier
        user.tier_expires_at = body.expires_at if body.tier != "free" else None
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        raise email_taken from None
    return await _user_row(db, settings, user.id)


@router.get("/users/{user_id}")
async def get_user(user_id: uuid.UUID, auth: AdminAuth, db: Db, settings: SettingsDep) -> AdminUserOut:
    return await _user_row(db, settings, user_id)


@router.patch("/users/{user_id}")
async def update_user(
    user_id: uuid.UUID, body: AdminUserUpdate, auth: AdminAuth, db: Db, settings: SettingsDep
) -> AdminUserOut:
    user = await _get_user(db, user_id)
    if body.display_name is not None:
        user.display_name = body.display_name
    if body.is_admin is not None and body.is_admin != user.is_admin:
        _not_self(auth, user)
        user.is_admin = body.is_admin
    if body.is_active is not None and body.is_active != user.is_active:
        _not_self(auth, user)
        user.is_active = body.is_active
        if not body.is_active:
            await revoke_sessions(db, user.id)
    await db.commit()
    return await _user_row(db, settings, user.id)


@router.put("/users/{user_id}/subscription")
async def set_subscription(
    user_id: uuid.UUID, body: SubscriptionIn, auth: AdminAuth, db: Db, settings: SettingsDep
) -> AdminUserOut:
    """Assigns a tier: activates or renews «Профи», sets up «Индивидуальный» with its own limits."""
    if not settings.tiers_enabled:
        raise _tiers_disabled()
    user = await _get_user(db, user_id)
    user.tier = body.tier
    user.tier_expires_at = body.expires_at if body.tier != "free" else None
    user.tier_trial = body.trial
    if body.trial and user.trial_used_at is None:
        user.trial_used_at = utcnow()
    limits = body.limits.model_dump(exclude_none=True) if body.limits and body.tier == "custom" else None
    user.tier_limits = limits or None
    user.tier_note = body.note or None
    await db.commit()
    return await _user_row(db, settings, user.id)


@router.post("/users/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(user_id: uuid.UUID, body: PasswordResetIn, auth: AdminAuth, db: Db) -> None:
    """Sets a new password and logs the user out everywhere."""
    user = await _get_user(db, user_id)
    user.password_hash = await hash_password(body.new_password)
    await revoke_sessions(db, user.id, keep=auth.session.id if user.id == auth.user.id else None)
    await db.commit()


@router.delete("/users/{user_id}/sessions", status_code=status.HTTP_204_NO_CONTENT)
async def end_sessions(user_id: uuid.UUID, auth: AdminAuth, db: Db) -> None:
    user = await _get_user(db, user_id)
    await revoke_sessions(db, user.id, keep=auth.session.id if user.id == auth.user.id else None)
    await db.commit()


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: uuid.UUID, auth: AdminAuth, db: Db) -> None:
    """Deletes the account with all its plans and sessions."""
    user = await _get_user(db, user_id)
    _not_self(auth, user)
    await db.delete(user)
    await db.commit()


@router.get("/leads")
async def list_leads(
    auth: AdminAuth,
    db: Db,
    status_: Annotated[LeadStatus | None, Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> LeadPage:
    where = [Lead.status == status_] if status_ else []
    total = await db.scalar(select(func.count()).select_from(Lead).where(*where)) or 0
    leads = await db.scalars(
        select(Lead)
        .where(*where)
        .order_by(Lead.created_at.desc(), Lead.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return LeadPage(items=[LeadOut.model_validate(x) for x in leads], total=total, limit=limit, offset=offset)


@router.patch("/leads/{lead_id}")
async def update_lead(lead_id: uuid.UUID, body: LeadUpdate, auth: AdminAuth, db: Db) -> LeadOut:
    lead = await db.get(Lead, lead_id)
    if lead is None:
        raise not_found("lead_not_found", "Заявка не найдена")
    lead.status = body.status
    await db.commit()
    return LeadOut.model_validate(lead)


@router.delete("/leads/{lead_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lead(lead_id: uuid.UUID, auth: AdminAuth, db: Db) -> None:
    result = await db.execute(delete(Lead).where(Lead.id == lead_id))
    if not result.rowcount:  # type: ignore[attr-defined]
        raise not_found("lead_not_found", "Заявка не найдена")
    await db.commit()
