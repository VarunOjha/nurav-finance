"""drop personal and reference details

The app is a planner: it keeps an account's name, type, institution, country,
currency, links, balances and whether it is closed. Everything else goes, and
the data with it (this migration is destructive on purpose):
- accounts: account number (encrypted + last 4), holder name, opened date, city, notes
- account_identifiers (IFSC, SWIFT, routing no.…): the whole table
- portfolios: opened date, notes
- users: phone

Downgrade brings the columns and table back empty; the values are not restored.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ACCOUNT_COLUMNS = ("account_number_enc", "account_number_last4", "holder_name", "opened_on", "city", "notes")


def upgrade() -> None:
    op.drop_table("account_identifiers")
    for column in ACCOUNT_COLUMNS:
        op.drop_column("accounts", column)
    op.drop_column("portfolios", "opened_on")
    op.drop_column("portfolios", "notes")
    op.drop_column("users", "phone")


def downgrade() -> None:
    op.add_column("users", sa.Column("phone", sa.String(32), nullable=True))
    op.add_column("portfolios", sa.Column("notes", sa.Text(), nullable=True))
    op.add_column("portfolios", sa.Column("opened_on", sa.Date(), nullable=True))
    op.add_column("accounts", sa.Column("notes", sa.Text(), nullable=True))
    op.add_column("accounts", sa.Column("city", sa.String(120), nullable=True))
    op.add_column("accounts", sa.Column("opened_on", sa.Date(), nullable=True))
    op.add_column("accounts", sa.Column("holder_name", sa.String(120), nullable=True))
    op.add_column("accounts", sa.Column("account_number_last4", sa.String(4), nullable=True))
    op.add_column("accounts", sa.Column("account_number_enc", sa.Text(), nullable=True))
    op.create_table(
        "account_identifiers",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("account_id", sa.Uuid(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("label", sa.String(60), nullable=False),
        sa.Column("value", sa.String(255), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_account_identifiers_account_id", "account_identifiers", ["account_id"])
    op.create_index("ix_account_identifiers_deleted_at", "account_identifiers", ["deleted_at"])
