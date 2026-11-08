"""Subscription tiers and their limits.

Prices and marketing texts live in the frontend (src/lib/tiers.ts); the limits here are what the API
enforces, and src/lib/tiers.ts repeats them for the pricing table: keep the two in sync.

- "free" (Старт): a few plans with one vehicle, for trying the planner out.
- "pro" (Профи): the full planner; new accounts may take a free trial of it once.
- "custom" (Индивидуальный): by contract, assigned by an admin, with limits and an end date of its own.

There is no online payment yet: an admin activates and renews paid tiers in the admin panel.
"""

from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Any, Literal

from app.models import User
from app.schemas.plan_data import MAX_ITEMS, MAX_VEHICLES

Tier = Literal["free", "pro", "custom"]
TIERS: tuple[Tier, ...] = ("free", "pro", "custom")
TIER_NAMES: dict[str, str] = {"free": "Старт", "pro": "Профи", "custom": "Индивидуальный"}
TRIAL_DAYS = 14


@dataclass(frozen=True, slots=True)
class TierLimits:
    # Saved plans; None — unlimited.
    plans: int | None
    # Vehicles and cargo items in one plan.
    vehicles: int
    items: int
    # Automatic loading and the step-by-step PDF (computed by the client, which hides them).
    autoload: bool
    pdf_steps: bool


LIMITS: dict[str, TierLimits] = {
    "free": TierLimits(plans=3, vehicles=1, items=100, autoload=False, pdf_steps=False),
    "pro": TierLimits(plans=None, vehicles=MAX_VEHICLES, items=MAX_ITEMS, autoload=True, pdf_steps=True),
    "custom": TierLimits(plans=None, vehicles=MAX_VEHICLES, items=MAX_ITEMS, autoload=True, pdf_steps=True),
}


def is_expired(user: User, now: datetime) -> bool:
    return user.tier != "free" and user.tier_expires_at is not None and user.tier_expires_at <= now


def effective_tier(user: User, now: datetime) -> str:
    """The tier that applies right now: an expired paid tier works as "free"."""
    if user.tier not in LIMITS or is_expired(user, now):
        return "free"
    return user.tier


def tier_limits(user: User, now: datetime) -> TierLimits:
    tier = effective_tier(user, now)
    limits = LIMITS[tier]
    if tier == "custom" and user.tier_limits:
        overrides: dict[str, Any] = user.tier_limits
        limits = replace(
            limits,
            plans=overrides.get("plans"),
            vehicles=min(overrides.get("vehicles") or MAX_VEHICLES, MAX_VEHICLES),
            items=min(overrides.get("items") or MAX_ITEMS, MAX_ITEMS),
        )
    return limits


def start_trial(user: User, now: datetime) -> None:
    """The free trial of "pro", once per account. The caller checks `trial_used_at` and commits."""
    user.tier = "pro"
    user.tier_trial = True
    user.tier_expires_at = now + timedelta(days=TRIAL_DAYS)
    user.trial_used_at = now
