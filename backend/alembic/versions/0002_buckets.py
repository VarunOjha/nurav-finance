"""buckets replace tags

Adds buckets (per user), effective-dated account splits, and per-workspace
bucket targets, then gives every existing user the starter buckets.

Purely additive: the tags / account_tags / portfolio_tags tables and their
rows are left exactly as they are (the app no longer uses them). Downgrade
drops only what this migration created.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-07
"""

import uuid
from datetime import UTC, datetime
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen copy of models.bucket.DEFAULT_BUCKETS as of this migration.
STARTER_BUCKETS = (
    ("Growth", "Long-term money left to compound"),
    ("Emergency fund", "Months of expenses I can reach within a week"),
    ("Extra cash", "Spare cash for near-term spending"),
)


def _common() -> list[sa.Column]:
    return [
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    ]


def upgrade() -> None:
    op.create_table(
        "buckets",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("color", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        *_common(),
    )
    op.create_index(op.f("ix_buckets_user_id"), "buckets", ["user_id"])
    op.create_index(op.f("ix_buckets_deleted_at"), "buckets", ["deleted_at"])
    op.create_index("uq_buckets_user_name_live", "buckets", ["user_id", sa.text("lower(name)")], unique=True, postgresql_where=sa.text("deleted_at IS NULL"))

    op.create_table(
        "account_splits",
        sa.Column("account_id", sa.Uuid(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        *_common(),
    )
    op.create_index(op.f("ix_account_splits_account_id"), "account_splits", ["account_id"])
    op.create_index(op.f("ix_account_splits_deleted_at"), "account_splits", ["deleted_at"])
    op.create_index("uq_account_splits_date_live", "account_splits", ["account_id", "effective_from"], unique=True, postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_index(
        "uq_account_splits_first_live", "account_splits", ["account_id"], unique=True, postgresql_where=sa.text("deleted_at IS NULL AND effective_from IS NULL")
    )

    op.create_table(
        "account_split_lines",
        sa.Column("split_id", sa.Uuid(), sa.ForeignKey("account_splits.id"), nullable=False),
        sa.Column("bucket_id", sa.Uuid(), sa.ForeignKey("buckets.id"), nullable=False),
        sa.Column("percent", sa.Numeric(7, 4), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        *_common(),
    )
    op.create_index(op.f("ix_account_split_lines_split_id"), "account_split_lines", ["split_id"])
    op.create_index(op.f("ix_account_split_lines_bucket_id"), "account_split_lines", ["bucket_id"])
    op.create_index(op.f("ix_account_split_lines_deleted_at"), "account_split_lines", ["deleted_at"])

    op.create_table(
        "bucket_targets",
        sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("bucket_id", sa.Uuid(), sa.ForeignKey("buckets.id"), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("amount", sa.Numeric(20, 4), nullable=False),
        sa.Column("target_date", sa.Date(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("expected_return", sa.Numeric(6, 3), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        *_common(),
    )
    op.create_index(op.f("ix_bucket_targets_workspace_id"), "bucket_targets", ["workspace_id"])
    op.create_index(op.f("ix_bucket_targets_bucket_id"), "bucket_targets", ["bucket_id"])
    op.create_index(op.f("ix_bucket_targets_deleted_at"), "bucket_targets", ["deleted_at"])

    # Starter buckets for every existing user.
    conn = op.get_bind()
    buckets = sa.table(
        "buckets",
        sa.column("id", sa.Uuid()),
        sa.column("user_id", sa.Uuid()),
        sa.column("name", sa.String()),
        sa.column("description", sa.Text()),
        sa.column("color", sa.Integer()),
        sa.column("position", sa.Integer()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    now = datetime.now(UTC)
    user_ids = [row[0] for row in conn.execute(sa.text("SELECT id FROM users WHERE deleted_at IS NULL"))]
    rows = [
        {"id": uuid.uuid4(), "user_id": uid, "name": name, "description": desc, "color": i, "position": i, "created_at": now, "updated_at": now}
        for uid in user_ids
        for i, (name, desc) in enumerate(STARTER_BUCKETS)
    ]
    if rows:
        op.bulk_insert(buckets, rows)


def downgrade() -> None:
    op.drop_table("bucket_targets")
    op.drop_table("account_split_lines")
    op.drop_table("account_splits")
    op.drop_table("buckets")
