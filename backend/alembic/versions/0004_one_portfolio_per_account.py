"""one portfolio per brokerage account

An account's holdings are its portfolio, so an account has at most one live
portfolio. Before the rule is enforced, duplicates are resolved:
- the account's portfolios that have live snapshots are kept;
- duplicates with no snapshots at all (an "Add portfolio" that never got its
  holdings) are soft-deleted (deleted_at set; the row stays and can be restored);
- if more than one of an account's portfolios has snapshots, the migration
  stops: those need merging by hand.

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-08
"""

from collections import defaultdict
from datetime import UTC, datetime
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            "SELECT p.id, p.account_id, p.name, p.created_at,"
            " (SELECT count(*) FROM snapshots s WHERE s.portfolio_id = p.id AND s.deleted_at IS NULL) AS snaps"
            " FROM portfolios p WHERE p.deleted_at IS NULL AND p.account_id IS NOT NULL ORDER BY p.created_at"
        )
    ).all()
    by_account: dict = defaultdict(list)
    for r in rows:
        by_account[r.account_id].append(r)
    now = datetime.now(UTC)
    for account_id, group in by_account.items():
        if len(group) < 2:
            continue
        filled = [r for r in group if r.snaps]
        if len(filled) > 1:
            names = ", ".join(f"{r.name} ({r.id})" for r in filled)
            raise RuntimeError(f"Account {account_id} has several portfolios with snapshots: {names}. Merge them by hand, then rerun.")
        # Keep the one with snapshots; with none at all, keep the oldest.
        keep = filled[0] if filled else group[0]
        for r in group:
            if r.id != keep.id:
                conn.execute(sa.text("UPDATE portfolios SET deleted_at = :now, updated_at = :now WHERE id = :id"), {"now": now, "id": r.id})
    op.create_index("uq_portfolios_account_live", "portfolios", ["account_id"], unique=True, postgresql_where=sa.text("deleted_at IS NULL"))


def downgrade() -> None:
    # The soft-deleted duplicates stay deleted (they were empty); only the rule goes.
    op.drop_index("uq_portfolios_account_live", table_name="portfolios")
