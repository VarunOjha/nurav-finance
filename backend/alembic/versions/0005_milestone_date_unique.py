"""one milestone per date

Each milestone in a workspace has its own date, so "the next milestone" is
never ambiguous. Stops if live data already has two milestones on one day.

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    clash = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT workspace_id, target_date, string_agg(name, ', ') AS names FROM milestones"
                " WHERE deleted_at IS NULL GROUP BY workspace_id, target_date HAVING count(*) > 1"
            )
        )
        .first()
    )
    if clash is not None:
        raise RuntimeError(f"Milestones {clash.names} share {clash.target_date}; give them different dates, then rerun.")
    op.create_index(
        "uq_milestones_workspace_date_live",
        "milestones",
        ["workspace_id", "target_date"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_milestones_workspace_date_live", table_name="milestones")
