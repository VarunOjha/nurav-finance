"""Workspace-scoped lookups shared by routers. All return 404 for foreign rows."""

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Account, Portfolio, Snapshot, Workspace


def get_account(db: Session, workspace: Workspace, account_id: uuid.UUID) -> Account:
    account = db.scalar(select(Account).where(Account.id == account_id, Account.workspace_id == workspace.id))
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


def get_portfolio(db: Session, workspace: Workspace, portfolio_id: uuid.UUID) -> Portfolio:
    portfolio = db.scalar(select(Portfolio).where(Portfolio.id == portfolio_id, Portfolio.workspace_id == workspace.id))
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return portfolio


def get_snapshot(db: Session, portfolio: Portfolio, snapshot_id: uuid.UUID) -> Snapshot:
    snapshot = db.scalar(select(Snapshot).where(Snapshot.id == snapshot_id, Snapshot.portfolio_id == portfolio.id))
    if snapshot is None:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return snapshot
