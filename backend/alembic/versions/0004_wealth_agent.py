"""wealth agent: wealth_plans and agent_usage replace fire_plans

The FIRE wizard and its saved plans are removed (user decision, 2026-10-16),
so fire_plans is dropped with its rows. Downgrade recreates it empty.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-16 15:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0004'
down_revision: Union[str, None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index('uq_fire_plans_tenant_name_live', table_name='fire_plans', postgresql_where=sa.text('deleted_at IS NULL'))
    op.drop_index(op.f('ix_fire_plans_tenant_id'), table_name='fire_plans')
    op.drop_index(op.f('ix_fire_plans_deleted_at'), table_name='fire_plans')
    op.drop_table('fire_plans')

    op.create_table('wealth_plans',
    sa.Column('tenant_id', sa.Uuid(), nullable=False),
    sa.Column('created_by', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=80), nullable=False),
    sa.Column('mode', sa.String(length=20), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('as_of', sa.Date(), nullable=False),
    sa.Column('horizon_years', sa.Integer(), nullable=False),
    sa.Column('params', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('report', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('model', sa.String(length=80), nullable=False),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_wealth_plans_deleted_at'), 'wealth_plans', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_wealth_plans_tenant_id'), 'wealth_plans', ['tenant_id'], unique=False)
    op.create_index('uq_wealth_plans_tenant_name_live', 'wealth_plans', ['tenant_id', sa.text('lower(name)')], unique=True, postgresql_where=sa.text('deleted_at IS NULL'))

    op.create_table('agent_usage',
    sa.Column('tenant_id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('model', sa.String(length=80), nullable=False),
    sa.Column('prompt_tokens', sa.Integer(), nullable=False),
    sa.Column('completion_tokens', sa.Integer(), nullable=False),
    sa.Column('cost_usd', sa.Numeric(precision=12, scale=6), nullable=False),
    sa.Column('generation_id', sa.String(length=80), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_agent_usage_at'), 'agent_usage', ['at'], unique=False)
    op.create_index(op.f('ix_agent_usage_tenant_id'), 'agent_usage', ['tenant_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_agent_usage_tenant_id'), table_name='agent_usage')
    op.drop_index(op.f('ix_agent_usage_at'), table_name='agent_usage')
    op.drop_table('agent_usage')
    op.drop_index('uq_wealth_plans_tenant_name_live', table_name='wealth_plans', postgresql_where=sa.text('deleted_at IS NULL'))
    op.drop_index(op.f('ix_wealth_plans_tenant_id'), table_name='wealth_plans')
    op.drop_index(op.f('ix_wealth_plans_deleted_at'), table_name='wealth_plans')
    op.drop_table('wealth_plans')

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
