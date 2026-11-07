import copy
import uuid
from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import defer
from sqlalchemy.orm.exc import StaleDataError

from app.auth import CurrentAuth
from app.db import Db
from app.deps import SettingsDep
from app.errors import ApiError, not_found
from app.models import Plan, User, utcnow
from app.schemas.plan_data import PlanData, default_plan_data
from app.schemas.plans import PlanCreate, PlanDuplicate, PlanOut, PlanPage, PlanSort, PlanSummary, PlanUpdate
from app.tiers import TIER_NAMES, effective_tier, tier_limits

router = APIRouter(prefix="/plans", tags=["plans"])

_ORDER = {
    "updatedAt": Plan.updated_at.asc(),
    "-updatedAt": Plan.updated_at.desc(),
    "createdAt": Plan.created_at.asc(),
    "-createdAt": Plan.created_at.desc(),
    "name": Plan.name_key.asc(),
    "-name": Plan.name_key.desc(),
}


def _set_name(plan: Plan, name: str) -> None:
    plan.name = name
    plan.name_key = name.casefold()[:200]


def _set_data(plan: Plan, data: PlanData) -> None:
    plan.data = data.model_dump(mode="json")
    plan.vehicle_count = len(data.vehicles)
    plan.body_count = data.body_count
    plan.item_count = len(data.items)


def _tier_limit(user: User, code: str, what: str, limit: int, nouns: tuple[str, str]) -> ApiError:
    """403 with `limit`: «На тарифе «Старт» в схеме не больше 1 машины…» (genitive after «больше»)."""
    tier = TIER_NAMES[effective_tier(user, utcnow())]
    noun = nouns[0] if limit % 10 == 1 and limit % 100 != 11 else nouns[1]
    return ApiError(
        status.HTTP_403_FORBIDDEN,
        code,
        f"На тарифе «{tier}» {what} не больше {limit} {noun}. Чтобы снять ограничение, смените тариф.",
        limit=limit,
    )


async def _check_plan_count(db: Db, user: User, tiers_enabled: bool) -> None:
    if not tiers_enabled:
        return
    limit = tier_limits(user, utcnow()).plans
    if limit is None:
        return
    count = await db.scalar(select(func.count()).select_from(Plan).where(Plan.owner_id == user.id)) or 0
    if count >= limit:
        raise _tier_limit(user, "plan_limit", "можно сохранить", limit, ("схемы", "схем"))


def _check_contents(user: User, tiers_enabled: bool, data: PlanData, previous: Plan | None = None) -> None:
    """Vehicles and items within the tier. A plan already over the limit (the tier ended) can still be
    edited, it just cannot grow."""
    if not tiers_enabled:
        return
    limits = tier_limits(user, utcnow())
    vehicles, items = len(data.vehicles), len(data.items)
    if vehicles > limits.vehicles and vehicles > (previous.vehicle_count if previous else 0):
        raise _tier_limit(user, "vehicle_limit", "в схеме", limits.vehicles, ("машины", "машин"))
    if items > limits.items and items > (previous.item_count if previous else 0):
        raise _tier_limit(user, "item_limit", "в схеме", limits.items, ("груза", "грузов"))


def _version_conflict(current_version: int) -> ApiError:
    return ApiError(
        status.HTTP_409_CONFLICT,
        "version_conflict",
        "Схему уже изменили в другом окне или на другом устройстве",
        currentVersion=current_version,
    )


async def _get_own_plan(db: Db, auth: CurrentAuth, plan_id: uuid.UUID) -> Plan:
    # Someone else's plan is "not found", so ids of other users' plans cannot be probed.
    plan = await db.scalar(select(Plan).where(Plan.id == plan_id, Plan.owner_id == auth.user.id))
    if plan is None:
        raise not_found("plan_not_found", "Схема не найдена")
    return plan


@router.get("")
async def list_plans(
    auth: CurrentAuth,
    db: Db,
    q: Annotated[
        str | None, Query(max_length=200, description="Поиск по названию, без учёта регистра")
    ] = None,
    sort: PlanSort = "-updatedAt",
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> PlanPage:
    """The home page: the current user's plans without their contents."""
    where = [Plan.owner_id == auth.user.id]
    if q and q.strip():
        where.append(Plan.name_key.contains(q.strip().casefold(), autoescape=True))
    total = await db.scalar(select(func.count()).select_from(Plan).where(*where)) or 0
    plans = await db.scalars(
        select(Plan)
        .options(defer(Plan.data))
        .where(*where)
        .order_by(_ORDER[sort], Plan.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return PlanPage(
        items=[PlanSummary.model_validate(p) for p in plans], total=total, limit=limit, offset=offset
    )


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_plan(body: PlanCreate, auth: CurrentAuth, db: Db, settings: SettingsDep) -> PlanOut:
    await _check_plan_count(db, auth.user, settings.tiers_enabled)
    data = body.data or default_plan_data()
    _check_contents(auth.user, settings.tiers_enabled, data)
    plan = Plan(owner_id=auth.user.id)
    _set_name(plan, body.name)
    _set_data(plan, data)
    db.add(plan)
    await db.commit()
    return PlanOut.model_validate(plan)


@router.get("/{plan_id}")
async def get_plan(plan_id: uuid.UUID, auth: CurrentAuth, db: Db) -> PlanOut:
    return PlanOut.model_validate(await _get_own_plan(db, auth, plan_id))


@router.patch("/{plan_id}")
async def update_plan(
    plan_id: uuid.UUID, body: PlanUpdate, auth: CurrentAuth, db: Db, settings: SettingsDep
) -> PlanOut:
    """Saves a new name and/or contents. 409 `version_conflict` if the plan changed since `version`."""
    plan = await _get_own_plan(db, auth, plan_id)
    if body.version != plan.version:
        raise _version_conflict(plan.version)
    if body.name is not None:
        _set_name(plan, body.name)
    if body.data is not None:
        _check_contents(auth.user, settings.tiers_enabled, body.data, plan)
        _set_data(plan, body.data)
    try:
        await db.commit()
    except StaleDataError:
        # Another save of the same version committed between our read and our UPDATE.
        await db.rollback()
        current = await db.scalar(select(Plan.version).where(Plan.id == plan_id))
        if current is None:
            raise not_found("plan_not_found", "Схема не найдена") from None
        raise _version_conflict(current) from None
    return PlanOut.model_validate(plan)


@router.post("/{plan_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def duplicate_plan(
    plan_id: uuid.UUID, body: PlanDuplicate, auth: CurrentAuth, db: Db, settings: SettingsDep
) -> PlanOut:
    source = await _get_own_plan(db, auth, plan_id)
    await _check_plan_count(db, auth.user, settings.tiers_enabled)
    plan = Plan(
        owner_id=auth.user.id,
        data=copy.deepcopy(source.data),
        vehicle_count=source.vehicle_count,
        body_count=source.body_count,
        item_count=source.item_count,
    )
    _set_name(plan, body.name or f"{source.name[:192]} (копия)")
    db.add(plan)
    await db.commit()
    return PlanOut.model_validate(plan)


@router.delete("/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plan(plan_id: uuid.UUID, auth: CurrentAuth, db: Db) -> None:
    await db.delete(await _get_own_plan(db, auth, plan_id))
    await db.commit()
