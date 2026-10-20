"""holdings: buy_price, and price renamed to current_price

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-14 17:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0002'
down_revision: Union[str, None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('holdings', 'price', new_column_name='current_price')
    op.add_column('holdings', sa.Column('buy_price', sa.Numeric(precision=20, scale=6), nullable=True))


def downgrade() -> None:
    op.drop_column('holdings', 'buy_price')
    op.alter_column('holdings', 'current_price', new_column_name='price')
