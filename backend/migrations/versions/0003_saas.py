"""users: admin role, display settings, subscription; leads

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-27 12:00:00.000000

Accounts made before subscriptions existed get the «Индивидуальный» tier without an end date, so
nothing they used stops working; admins change it in the admin panel.
Must work on SQLite (development) and Postgres (production).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("is_admin", sa.Boolean(), server_default=sa.false(), nullable=False))
        batch_op.add_column(sa.Column("settings", JSON, nullable=True))
        batch_op.add_column(sa.Column("tier", sa.String(length=20), server_default="free", nullable=False))
        batch_op.add_column(sa.Column("tier_expires_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("tier_trial", sa.Boolean(), server_default=sa.false(), nullable=False))
        batch_op.add_column(sa.Column("trial_used_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("tier_limits", JSON, nullable=True))
        batch_op.add_column(sa.Column("tier_note", sa.String(length=500), nullable=True))
    op.execute("UPDATE users SET tier = 'custom', tier_note = 'Аккаунт создан до появления тарифов'")

    op.create_table(
        "leads",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("phone", sa.String(length=40), nullable=True),
        sa.Column("company", sa.String(length=200), nullable=True),
        sa.Column("message", sa.String(length=2000), nullable=True),
        sa.Column("tier", sa.String(length=20), nullable=True),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="new", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_leads_user_id_users"), ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_leads")),
    )
    with op.batch_alter_table("leads", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_leads_created_at"), ["created_at"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("leads", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_leads_created_at"))
    op.drop_table("leads")

    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("tier_note")
        batch_op.drop_column("tier_limits")
        batch_op.drop_column("trial_used_at")
        batch_op.drop_column("tier_trial")
        batch_op.drop_column("tier_expires_at")
        batch_op.drop_column("tier")
        batch_op.drop_column("settings")
        batch_op.drop_column("is_admin")
