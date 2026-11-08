import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Index, MetaData, String, Uuid, false
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Dialect
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator


def utcnow() -> datetime:
    return datetime.now(UTC)


class UTCDateTime(TypeDecorator[datetime]):
    """Timezone-aware UTC datetimes on every backend (SQLite stores them without an offset)."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("naive datetime; use app.models.utcnow()")
        return value.astimezone(UTC)

    def process_result_value(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class Base(DeclarativeBase):
    metadata = MetaData(
        naming_convention={
            "ix": "ix_%(column_0_label)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        }
    )
    type_annotation_map = {
        datetime: UTCDateTime(),
        uuid.UUID: Uuid(),
        dict[str, Any]: JSON().with_variant(JSONB(), "postgresql"),
    }


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid7)
    # Stored lower-cased: uniqueness and login are case-insensitive.
    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(default=True)
    is_admin: Mapped[bool] = mapped_column(default=False, server_default=false())
    # Display settings of the editor (src/store/useStore.ts `Settings`), camelCase; null — defaults.
    settings: Mapped[dict[str, Any] | None]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    # Subscription (app/tiers.py): "free", "pro" or "custom" (by contract, set by an admin).
    # A paid tier past `tier_expires_at` works as "free" until it is renewed; null — no end date.
    tier: Mapped[str] = mapped_column(String(20), default="free", server_default="free")
    tier_expires_at: Mapped[datetime | None]
    # The current period is the free trial of "pro".
    tier_trial: Mapped[bool] = mapped_column(default=False, server_default=false())
    trial_used_at: Mapped[datetime | None]
    # "custom" only: {"plans", "vehicles", "items"} overriding the tier's limits (null — no limit).
    tier_limits: Mapped[dict[str, Any] | None]
    # Admin's note: contract, invoice, contact person.
    tier_note: Mapped[str | None] = mapped_column(String(500))

    sessions: Mapped[list[AuthSession]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
    plans: Mapped[list[Plan]] = relationship(
        back_populates="owner", cascade="all, delete-orphan", passive_deletes=True
    )


class Lead(Base):
    """A request from the landing page or the account page: the "custom" tier, help with a plan."""

    __tablename__ = "leads"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid7)
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str | None] = mapped_column(String(320))
    phone: Mapped[str | None] = mapped_column(String(40))
    company: Mapped[str | None] = mapped_column(String(200))
    message: Mapped[str | None] = mapped_column(String(2000))
    # The tier the request is about, if any.
    tier: Mapped[str | None] = mapped_column(String(20))
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    ip_address: Mapped[str | None] = mapped_column(String(45))
    # "new" until an admin handles it, then "done".
    status: Mapped[str] = mapped_column(String(20), default="new", server_default="new")
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)


class AuthSession(Base):
    """A login on one device. The refresh token carries its id (`sid`) and the current `refresh_jti`.

    A refresh rotates the jti (at most once per grace period). Presenting an older jti means the token
    was copied, so the session is revoked, except for `previous_jti` within that grace period (parallel tabs).
    """

    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid7)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    refresh_jti: Mapped[str] = mapped_column(String(64))
    previous_jti: Mapped[str | None] = mapped_column(String(64))
    rotated_at: Mapped[datetime | None]
    user_agent: Mapped[str | None] = mapped_column(String(500))
    ip_address: Mapped[str | None] = mapped_column(String(45))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    last_used_at: Mapped[datetime] = mapped_column(default=utcnow)
    expires_at: Mapped[datetime]
    revoked_at: Mapped[datetime | None]

    user: Mapped[User] = relationship(back_populates="sessions")


class Plan(Base):
    """A saved loading scheme. `data` is the frontend's `Plan` JSON (src/core/types.ts) as is."""

    __tablename__ = "plans"
    __table_args__ = (Index("ix_plans_owner_id_updated_at", "owner_id", "updated_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid7)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(200))
    # casefold()-ed name: case-insensitive search and sort that behave the same on SQLite and Postgres.
    name_key: Mapped[str] = mapped_column(String(200))
    data: Mapped[dict[str, Any]]
    # Denormalized from `data` so the list does not load every plan body.
    vehicle_count: Mapped[int] = mapped_column(server_default="1")
    body_count: Mapped[int]
    item_count: Mapped[int]
    # Optimistic locking: bumped by SQLAlchemy on every UPDATE, clients send the version they edited.
    version: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    owner: Mapped[User] = relationship(back_populates="plans")

    __mapper_args__ = {"version_id_col": version}
