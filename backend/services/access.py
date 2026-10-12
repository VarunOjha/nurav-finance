"""Tenant-scoped lookups shared by routers. All return 404 for foreign rows."""

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Account, Portfolio, Snapshot, Tag, Tenant


def get_account(db: Session, tenant: Tenant, account_id: uuid.UUID) -> Account:
    account = db.scalar(select(Account).where(Account.id == account_id, Account.tenant_id == tenant.id))
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


def get_portfolio(db: Session, tenant: Tenant, portfolio_id: uuid.UUID) -> Portfolio:
    portfolio = db.scalar(select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.tenant_id == tenant.id))
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return portfolio


def get_snapshot(db: Session, portfolio: Portfolio, snapshot_id: uuid.UUID) -> Snapshot:
    snapshot = db.scalar(select(Snapshot).where(Snapshot.id == snapshot_id, Snapshot.portfolio_id == portfolio.id))
    if snapshot is None:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return snapshot


def owned_tags(db: Session, tenant: Tenant, tag_ids: list[uuid.UUID]) -> list[Tag]:
    """Resolve tag ids to the user's live tags; unknown ids are a 422."""
    unique = list(dict.fromkeys(tag_ids))
    if not unique:
        return []
    tags = db.scalars(select(Tag).where(Tag.id.in_(unique), Tag.user_id == tenant.user_id)).all()
    if len(tags) != len(unique):
        raise HTTPException(status_code=422, detail="Unknown tag")
    return list(tags)
