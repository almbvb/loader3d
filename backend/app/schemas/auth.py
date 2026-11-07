import uuid
from datetime import datetime
from typing import Annotated, Any, Literal, Self

from pydantic import AfterValidator, EmailStr, Field, StringConstraints

from app.models import User, utcnow
from app.schemas.base import ApiModel
from app.tiers import TIER_NAMES, Tier, effective_tier, is_expired, tier_limits

# email-validator already caps the length at 254 characters.
Email = Annotated[EmailStr, AfterValidator(str.lower)]
# Login accepts anything e-mail-like: a malformed address simply does not match an account.
LoginEmail = Annotated[
    str, StringConstraints(strip_whitespace=True, to_lower=True, min_length=1, max_length=320)
]
NewPassword = Annotated[str, StringConstraints(min_length=8, max_length=128)]
Password = Annotated[str, StringConstraints(min_length=1, max_length=128)]
DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class RegisterIn(ApiModel):
    email: Email
    password: NewPassword
    display_name: DisplayName | None = None
    # "pro" starts its free trial; "custom" is by contract (a request on the landing page).
    tier: Literal["free", "pro"] = "free"


class LoginIn(ApiModel):
    email: LoginEmail
    password: Password


class LimitsOut(ApiModel):
    # None — unlimited.
    plans: int | None
    vehicles: int
    items: int
    autoload: bool
    pdf_steps: bool


class SubscriptionOut(ApiModel):
    # The tier that applies now (an expired paid tier is "free").
    tier: Tier
    name: str
    # End of the current paid period or trial; null — no end date (or "free").
    expires_at: datetime | None
    trial: bool
    # The free trial of "pro" has not been used yet.
    trial_available: bool
    # A paid tier that has ended and works as "free" until it is renewed.
    expired_tier: Tier | None
    limits: LimitsOut

    @classmethod
    def of(cls, user: User) -> Self:
        now = utcnow()
        tier = effective_tier(user, now)
        limits = tier_limits(user, now)
        return cls(
            tier=tier,  # type: ignore[arg-type]
            name=TIER_NAMES[tier],
            expires_at=user.tier_expires_at if tier != "free" else None,
            trial=tier == "pro" and user.tier_trial,
            trial_available=user.trial_used_at is None,
            expired_tier=user.tier if is_expired(user, now) else None,  # type: ignore[arg-type]
            limits=LimitsOut(
                plans=limits.plans,
                vehicles=limits.vehicles,
                items=limits.items,
                autoload=limits.autoload,
                pdf_steps=limits.pdf_steps,
            ),
        )


class UserOut(ApiModel):
    id: uuid.UUID
    email: str
    display_name: str
    created_at: datetime
    is_admin: bool
    # Editor display settings as last saved (camelCase keys); null — never changed.
    settings: dict[str, Any] | None
    # null when tiers are off (TIERS_ENABLED): nothing is limited.
    subscription: SubscriptionOut | None

    @classmethod
    def of(cls, user: User, tiers_enabled: bool) -> Self:
        return cls(
            id=user.id,
            email=user.email,
            display_name=user.display_name,
            created_at=user.created_at,
            is_admin=user.is_admin,
            settings=user.settings,
            subscription=SubscriptionOut.of(user) if tiers_enabled else None,
        )


class AuthOut(ApiModel):
    """Access token for the `Authorization: Bearer` header; the refresh token is an httpOnly cookie."""

    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: UserOut


class SessionOut(ApiModel):
    id: uuid.UUID
    created_at: datetime
    last_used_at: datetime
    expires_at: datetime
    user_agent: str | None
    ip_address: str | None
    current: bool


class UserUpdateIn(ApiModel):
    display_name: DisplayName | None = None


class PasswordChangeIn(ApiModel):
    current_password: Password
    new_password: NewPassword


class AccountDeleteIn(ApiModel):
    password: Password


class DisplaySettingsIn(ApiModel):
    """Editor display settings: `Settings` in src/store/useStore.ts, keep the two in sync.

    A PATCH: omitted fields keep their saved values.
    """

    highlight_overflow: bool | None = None
    show_dimensions: bool | None = None
    show_labels: bool | None = None
    show_body_walls: bool | None = None
    lock_cargo: bool | None = None
    snapping: bool | None = None
    resize_handles: bool | None = None
    camera_locked: bool | None = None
    units: Literal["mm", "cm", "m"] | None = None
    allow_tilt: bool | None = None
    xray: Literal["off", "selection", "auto", "all"] | None = None
    # src/store/useStore.ts XRAY_OPACITY_RANGE.
    xray_opacity: Annotated[float, Field(ge=0.08, le=0.8)] | None = None
