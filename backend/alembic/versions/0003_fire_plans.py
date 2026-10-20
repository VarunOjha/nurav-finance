"""fire_plans: saved FIRE projections

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-16 11:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0003'
down_revision: Union[str, None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('fire_plans',
    sa.Column('tenant_id', sa.Uuid(), nullable=False),
    sa.Column('created_by', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=80), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('as_of', sa.Date(), nullable=False),
    sa.Column('horizon_years', sa.Integer(), nullable=False),
    sa.Column('headline', sa.String(length=16), nullable=False),
    sa.Column('inputs', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('results', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_fire_plans_deleted_at'), 'fire_plans', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_fire_plans_tenant_id'), 'fire_plans', ['tenant_id'], unique=False)
    op.create_index('uq_fire_plans_tenant_name_live', 'fire_plans', ['tenant_id', sa.text('lower(name)')], unique=True, postgresql_where=sa.text('deleted_at IS NULL'))


def downgrade() -> None:
    op.drop_index('uq_fire_plans_tenant_name_live', table_name='fire_plans', postgresql_where=sa.text('deleted_at IS NULL'))
    op.drop_index(op.f('ix_fire_plans_tenant_id'), table_name='fire_plans')
    op.drop_index(op.f('ix_fire_plans_deleted_at'), table_name='fire_plans')
    op.drop_table('fire_plans')
