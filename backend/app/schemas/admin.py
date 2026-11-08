"""Admin panel: users, their subscriptions, and requests from the landing page."""

import uuid
from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import AwareDatetime, Field, StringConstraints, model_validator

from app.models import User, utcnow
from app.schemas.auth import DisplayName, Email, NewPassword
from app.schemas.base import ApiModel
from app.schemas.plan_data import MAX_ITEMS, MAX_VEHICLES
from app.tiers import Tier, effective_tier

AdminUserSort = Literal["createdAt", "-createdAt", "email", "-lastActiveAt"]
AdminUserStatus = Literal["active", "blocked", "admins"]
LeadStatus = Literal["new", "done"]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


class CustomLimits(ApiModel):
    """Limits of a «Индивидуальный» subscription; null — no limit (vehicles and items: the plan maximum)."""

    plans: Annotated[int, Field(ge=1, le=100_000)] | None = None
    vehicles: Annotated[int, Field(ge=1, le=MAX_VEHICLES)] | None = None
    items: Annotated[int, Field(ge=1, le=MAX_ITEMS)] | None = None


class AdminSubscriptionOut(ApiModel):
    # As assigned; `effective_tier` is what applies now (an expired paid tier works as "free").
    tier: Tier
    effective_tier: Tier
    expires_at: datetime | None
    trial: bool
    trial_used: bool
    limits: CustomLimits | None
    note: str | None

    @classmethod
    def of(cls, user: User) -> Self:
        return cls(
            tier=user.tier,  # type: ignore[arg-type]
            effective_tier=effective_tier(user, utcnow()),  # type: ignore[arg-type]
            expires_at=user.tier_expires_at,
            trial=user.tier_trial,
            trial_used=user.trial_used_at is not None,
            limits=CustomLimits.model_validate(user.tier_limits) if user.tier_limits else None,
            note=user.tier_note,
        )


class AdminUserOut(ApiModel):
    id: uuid.UUID
    email: str
    display_name: str
    is_admin: bool
    is_active: bool
    created_at: datetime
    # Most recent use of any session (login, refresh); null — never logged in.
    last_active_at: datetime | None
    plan_count: int
    # Devices logged in right now.
    session_count: int
    # null when tiers are off (TIERS_ENABLED).
    subscription: AdminSubscriptionOut | None


class AdminUserPage(ApiModel):
    items: list[AdminUserOut]
    total: int
    limit: int
    offset: int


class AdminStatsOut(ApiModel):
    users: int
    new_last_7_days: int
    active_last_7_days: int
    blocked: int
    admins: int
    # Effective tiers: an expired "pro" counts as "free". null when tiers are off.
    by_tier: dict[str, int] | None
    plans: int
    new_leads: int


class AdminUserCreate(ApiModel):
    """An account made by an admin (works with registration closed). No session is started."""

    email: Email
    password: NewPassword
    display_name: DisplayName | None = None
    is_admin: bool = False
    tier: Tier = "free"
    expires_at: AwareDatetime | None = None


class AdminUserUpdate(ApiModel):
    display_name: DisplayName | None = None
    # false blocks the account: its sessions end at once, login is refused.
    is_active: bool | None = None
    is_admin: bool | None = None


class SubscriptionIn(ApiModel):
    tier: Tier
    # End of the paid period; null — no end date. Ignored for "free".
    expires_at: AwareDatetime | None = None
    # Mark the period as the free trial of "pro".
    trial: bool = False
    # «Индивидуальный» only.
    limits: CustomLimits | None = None
    note: Note | None = None

    @model_validator(mode="after")
    def _trial_is_pro(self) -> Self:
        if self.trial and self.tier != "pro":
            raise ValueError("Пробный период бывает только у тарифа «Профи»")
        return self


class PasswordResetIn(ApiModel):
    new_password: NewPassword


class LeadOut(ApiModel):
    id: uuid.UUID
    name: str
    email: str | None
    phone: str | None
    company: str | None
    message: str | None
    tier: str | None
    status: LeadStatus
    user_id: uuid.UUID | None
    created_at: datetime


class LeadPage(ApiModel):
    items: list[LeadOut]
    total: int
    limit: int
    offset: int


class LeadUpdate(ApiModel):
    status: LeadStatus
