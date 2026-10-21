"""plans.vehicle_count

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-19 12:00:00.000000

Plans can hold several vehicles; the home page shows how many. Existing plans have one.
Must work on SQLite (development) and Postgres (production).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("plans", schema=None) as batch_op:
        batch_op.add_column(sa.Column("vehicle_count", sa.Integer(), server_default="1", nullable=False))


def downgrade() -> None:
    with op.batch_alter_table("plans", schema=None) as batch_op:
        batch_op.drop_column("vehicle_count")
