"""Cascading soft deletes.

Deleting a parent marks every live child deleted with the same timestamp, so
the global filter in database.py hides the whole subtree. Nothing is ever
physically removed.
"""

import uuid
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from database import utcnow
from models import (
    Account,
    AccountIdentifier,
    AccountLink,
    AccountTag,
    BalanceEntry,
    Holding,
    Portfolio,
    PortfolioTag,
    Snapshot,
    Tag,
    Tenant,
    WealthPlan,
)


def _mark(db: Session, model, *where, now: datetime) -> None:
    db.execute(update(model).where(*where, model.deleted_at.is_(None)).values(deleted_at=now).execution_options(synchronize_session=False))


def delete_snapshot(db: Session, snapshot_id: uuid.UUID, now: datetime | None = None) -> None:
    now = now or utcnow()
    _mark(db, Holding, Holding.snapshot_id == snapshot_id, now=now)
    _mark(db, Snapshot, Snapshot.id == snapshot_id, now=now)


def delete_portfolio(db: Session, portfolio_id: uuid.UUID, now: datetime | None = None) -> None:
    now = now or utcnow()
    snapshot_ids = select(Snapshot.id).where(Snapshot.portfolio_id == portfolio_id)
    _mark(db, Holding, Holding.snapshot_id.in_(snapshot_ids), now=now)
    _mark(db, Snapshot, Snapshot.portfolio_id == portfolio_id, now=now)
    _mark(db, PortfolioTag, PortfolioTag.portfolio_id == portfolio_id, now=now)
    _mark(db, Portfolio, Portfolio.id == portfolio_id, now=now)


def delete_account(db: Session, account_id: uuid.UUID, now: datetime | None = None) -> None:
    now = now or utcnow()
    for model in (AccountIdentifier, AccountLink, AccountTag, BalanceEntry):
        _mark(db, model, model.account_id == account_id, now=now)
    # Portfolios survive; they just stop pointing at a deleted account.
    db.execute(update(Portfolio).where(Portfolio.account_id == account_id).values(account_id=None).execution_options(synchronize_session=False))
    _mark(db, Account, Account.id == account_id, now=now)


def delete_tag(db: Session, tag_id: uuid.UUID, now: datetime | None = None) -> None:
    now = now or utcnow()
    _mark(db, AccountTag, AccountTag.tag_id == tag_id, now=now)
    _mark(db, PortfolioTag, PortfolioTag.tag_id == tag_id, now=now)
    _mark(db, Tag, Tag.id == tag_id, now=now)


def delete_tenant(db: Session, tenant_id: uuid.UUID, now: datetime | None = None) -> None:
    now = now or utcnow()
    for (pid,) in db.execute(select(Portfolio.id).where(Portfolio.tenant_id == tenant_id)):
        delete_portfolio(db, pid, now)
    for (aid,) in db.execute(select(Account.id).where(Account.tenant_id == tenant_id)):
        delete_account(db, aid, now)
    _mark(db, WealthPlan, WealthPlan.tenant_id == tenant_id, now=now)
    _mark(db, Tenant, Tenant.id == tenant_id, now=now)
