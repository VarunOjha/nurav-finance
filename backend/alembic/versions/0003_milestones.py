"""milestones group bucket targets

A milestone ("2030") has a name, one date and a measure-from date, and holds
bucket targets (one balance per bucket + currency). Existing targets move into
milestones: one per workspace + target date + start date, named after the year
("2029"; "2029 (Jun 30)" etc. when a name is already taken).

Nothing is dropped: bucket_targets keeps its target_date / start_date columns
and values (now nullable, kept in step by the app), so a downgrade gives back
standalone targets exactly.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-08
"""

import uuid
from collections import defaultdict
from datetime import UTC, datetime
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _name(year_date, taken: set[str]) -> str:
    """'2029', else '2029 (Jun 30)', else '2029 (Jun 30) 2', … — unique (case-insensitive) in `taken`."""
    options = [str(year_date.year), f"{year_date.year} ({year_date.strftime('%b')} {year_date.day})"]
    n = 2
    while True:
        for option in options:
            if option.lower() not in taken:
                taken.add(option.lower())
                return option
        options = [f"{year_date.year} ({year_date.strftime('%b')} {year_date.day}) {n}"]
        n += 1


def upgrade() -> None:
    op.create_table(
        "milestones",
        sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("target_date", sa.Date(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_milestones_workspace_id"), "milestones", ["workspace_id"])
    op.create_index(op.f("ix_milestones_deleted_at"), "milestones", ["deleted_at"])
    op.create_index(
        "uq_milestones_workspace_name_live", "milestones", ["workspace_id", sa.text("lower(name)")], unique=True, postgresql_where=sa.text("deleted_at IS NULL")
    )

    op.add_column("bucket_targets", sa.Column("milestone_id", sa.Uuid(), sa.ForeignKey("milestones.id"), nullable=True))
    op.add_column("bucket_targets", sa.Column("position", sa.Integer(), nullable=False, server_default="0"))
    op.alter_column("bucket_targets", "position", server_default=None)
    op.alter_column("bucket_targets", "target_date", nullable=True)
    op.alter_column("bucket_targets", "start_date", nullable=True)
    op.create_index(op.f("ix_bucket_targets_milestone_id"), "bucket_targets", ["milestone_id"])

    # Move every live target into a milestone.
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            "SELECT t.id, t.workspace_id, t.bucket_id, t.currency, t.target_date, t.start_date, t.created_at"
            " FROM bucket_targets t JOIN buckets b ON b.id = t.bucket_id"
            " WHERE t.deleted_at IS NULL ORDER BY t.workspace_id, t.target_date, t.start_date, b.position, t.created_at"
        )
    ).all()
    groups: dict[tuple, list] = defaultdict(list)
    for r in rows:
        groups[(r.workspace_id, r.target_date, r.start_date)].append(r)
    taken: dict = defaultdict(set)
    now = datetime.now(UTC)
    milestones = sa.table(
        "milestones",
        sa.column("id", sa.Uuid()),
        sa.column("workspace_id", sa.Uuid()),
        sa.column("name", sa.String()),
        sa.column("target_date", sa.Date()),
        sa.column("start_date", sa.Date()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    for (workspace_id, target_date, start_date), members in groups.items():
        # A bucket + currency may appear once per milestone; repeats open another milestone.
        batches: list[tuple[uuid.UUID, set]] = []
        for position, r in enumerate(members):
            key = (r.bucket_id, r.currency)
            batch = next((b for b in batches if key not in b[1]), None)
            if batch is None:
                batch = (uuid.uuid4(), set())
                batches.append(batch)
                conn.execute(
                    milestones.insert().values(
                        id=batch[0],
                        workspace_id=workspace_id,
                        name=_name(target_date, taken[workspace_id]),
                        target_date=target_date,
                        start_date=start_date,
                        created_at=now,
                        updated_at=now,
                    )
                )
            batch[1].add(key)
            conn.execute(sa.text("UPDATE bucket_targets SET milestone_id = :m, position = :p WHERE id = :t"), {"m": batch[0], "p": position, "t": r.id})

    op.create_index(
        "uq_bucket_targets_line_live",
        "bucket_targets",
        ["milestone_id", "bucket_id", "currency"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    conn = op.get_bind()
    # Standalone targets carry their own dates again: take them from the milestone.
    conn.execute(
        sa.text(
            "UPDATE bucket_targets t SET target_date = m.target_date, start_date = m.start_date"
            " FROM milestones m WHERE m.id = t.milestone_id"
        )
    )
    # A line of a deleted milestone is gone too.
    conn.execute(
        sa.text(
            "UPDATE bucket_targets t SET deleted_at = m.deleted_at FROM milestones m"
            " WHERE m.id = t.milestone_id AND t.deleted_at IS NULL AND m.deleted_at IS NOT NULL"
        )
    )
    op.drop_index("uq_bucket_targets_line_live", table_name="bucket_targets")
    op.drop_index(op.f("ix_bucket_targets_milestone_id"), table_name="bucket_targets")
    op.alter_column("bucket_targets", "start_date", nullable=False)
    op.alter_column("bucket_targets", "target_date", nullable=False)
    op.drop_column("bucket_targets", "position")
    op.drop_column("bucket_targets", "milestone_id")
    op.drop_index("uq_milestones_workspace_name_live", table_name="milestones")
    op.drop_index(op.f("ix_milestones_deleted_at"), table_name="milestones")
    op.drop_index(op.f("ix_milestones_workspace_id"), table_name="milestones")
    op.drop_table("milestones")
