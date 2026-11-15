"""wealth estimator inquiries

Adds one table; nothing existing changes.

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "wealth_inquiries",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("monthly_expenses", sa.Numeric(20, 4), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("excluded_account_ids", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("snapshot", JSONB(), nullable=False),
        sa.Column("answer", JSONB(), nullable=False),
        sa.Column("result", JSONB(), nullable=False),
        sa.Column("model", sa.String(120), nullable=False),
        sa.Column("cost", sa.Numeric(12, 6), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_wealth_inquiries_workspace_id", "wealth_inquiries", ["workspace_id"])
    op.create_index("ix_wealth_inquiries_deleted_at", "wealth_inquiries", ["deleted_at"])


def downgrade() -> None:
    op.drop_index("ix_wealth_inquiries_deleted_at", table_name="wealth_inquiries")
    op.drop_index("ix_wealth_inquiries_workspace_id", table_name="wealth_inquiries")
    op.drop_table("wealth_inquiries")
