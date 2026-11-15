import uuid
from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db, utcnow
from dependencies import get_current_workspace
from models import Account, AccountLink, BalanceEntry, Portfolio, Workspace
from models.account import PORTFOLIO_ACCOUNT_TYPES
from schemas.account import (
    AccountCreate,
    AccountDetail,
    AccountSummary,
    AccountUpdate,
    BalanceCreate,
    BalanceEntryOut,
    BalanceHistory,
    LinkIn,
    MonthPoint,
)
from schemas.buckets import BucketShare
from schemas.common import latest_allowed_date
from services import soft_delete
from services.access import get_account
from services.ledger import Point, Timeline, effective_ids, month_end, month_key, months_between
from services.splits import SplitTimeline, load_splits

router = APIRouter()


# ── helpers ───────────────────────────────────────────────────────────────────


def _timeline(entries: list[BalanceEntry]) -> Timeline[Decimal]:
    return Timeline(Point(e.as_of, e.created_at, e.amount, e) for e in entries)


def _entries_by_account(db: Session, account_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[BalanceEntry]]:
    grouped: dict[uuid.UUID, list[BalanceEntry]] = defaultdict(list)
    if account_ids:
        for e in db.scalars(select(BalanceEntry).where(BalanceEntry.account_id.in_(account_ids))):
            grouped[e.account_id].append(e)
    return grouped


def _shares(splits: SplitTimeline) -> list[BucketShare]:
    """The split in force today; [] = Unassigned."""
    current = splits.at(date.today())
    if current is None:
        return []
    return [
        BucketShare(bucket_id=line.bucket_id, name=line.bucket.name, color=line.bucket.color, percent=line.percent)
        for line in sorted(current.ref.lines, key=lambda x: x.position)
    ]


def _summary(account: Account, entries: list[BalanceEntry], splits: SplitTimeline) -> dict:
    timeline = _timeline(entries)
    latest = timeline.latest()
    previous = timeline.before(latest) if latest else None
    return dict(
        id=account.id,
        name=account.name,
        institution=account.institution,
        account_type=account.account_type,
        country=account.country,
        currency=account.currency,
        closed_on=account.closed_on,
        status="closed" if account.closed_on else "active",
        buckets=_shares(splits),
        balance=latest.value if latest else None,
        balance_as_of=latest.as_of if latest else None,
        previous_balance=previous.value if previous else None,
        delta=(latest.value - previous.value) if latest and previous else None,
        updated_at=account.updated_at,
    )


def _detail(db: Session, account: Account) -> AccountDetail:
    entries = _entries_by_account(db, [account.id])[account.id]
    portfolios = db.scalars(select(Portfolio).where(Portfolio.account_id == account.id).order_by(Portfolio.name)).all()
    return AccountDetail(
        **_summary(account, entries, load_splits(db, [account.id])[account.id]),
        links=account.links,
        portfolios=portfolios,
        created_at=account.created_at,
    )


def _check_entry_date(account: Account, as_of: date) -> None:
    if account.closed_on and as_of > account.closed_on:
        raise HTTPException(status_code=422, detail="Date is after the account was closed")


def _replace_links(db: Session, account: Account, items: list[LinkIn]) -> None:
    now = utcnow()
    for old in account.links:
        old.deleted_at = now
    for i, item in enumerate(items):
        db.add(AccountLink(account_id=account.id, label=item.label.strip(), url=str(item.url), position=i))


def _load(db: Session, workspace: Workspace, account_id: uuid.UUID) -> Account:
    db.expire_all()  # drop collections cached before a write in this request
    return get_account(db, workspace, account_id)


# ── accounts ──────────────────────────────────────────────────────────────────


@router.get("", response_model=list[AccountSummary])
def list_accounts(
    status_filter: Literal["active", "closed", "all"] = Query("all", alias="status"),
    workspace: Workspace = Depends(get_current_workspace),
    db: Session = Depends(get_db),
) -> list[AccountSummary]:
    stmt = select(Account).where(Account.workspace_id == workspace.id).order_by(Account.closed_on.is_not(None), Account.currency, Account.name)
    if status_filter == "active":
        stmt = stmt.where(Account.closed_on.is_(None))
    elif status_filter == "closed":
        stmt = stmt.where(Account.closed_on.is_not(None))
    accounts = db.scalars(stmt).all()
    entries = _entries_by_account(db, [a.id for a in accounts])
    splits = load_splits(db, [a.id for a in accounts])
    return [AccountSummary(**_summary(a, entries.get(a.id, []), splits[a.id])) for a in accounts]


@router.post("", response_model=AccountDetail, status_code=status.HTTP_201_CREATED)
def create_account(body: AccountCreate, workspace: Workspace = Depends(get_current_workspace), db: Session = Depends(get_db)) -> AccountDetail:
    account = Account(workspace_id=workspace.id, **body.model_dump(include=set(AccountCreate.model_fields) - {"links", "opening_balance"}))
    db.add(account)
    db.flush()
    _replace_links(db, account, body.links)
    if body.opening_balance:
        _check_entry_date(account, body.opening_balance.as_of)
        db.add(BalanceEntry(account_id=account.id, **body.opening_balance.model_dump()))
    db.commit()
    return _detail(db, _load(db, workspace, account.id))


@router.get("/{account_id}", response_model=AccountDetail)
def get_account_detail(account_id: uuid.UUID, workspace: Workspace = Depends(get_current_workspace), db: Session = Depends(get_db)) -> AccountDetail:
    return _detail(db, get_account(db, workspace, account_id))


@router.patch("/{account_id}", response_model=AccountDetail)
def update_account(
    account_id: uuid.UUID, body: AccountUpdate, workspace: Workspace = Depends(get_current_workspace), db: Session = Depends(get_db)
) -> AccountDetail:
    account = get_account(db, workspace, account_id)
    data = body.model_dump(exclude_unset=True)

    closed_on = data.get("closed_on", account.closed_on)
    if closed_on and closed_on > latest_allowed_date():
        raise HTTPException(status_code=422, detail="Closing date cannot be in the future")
    entries = _entries_by_account(db, [account.id])[account.id]
    if entries:
        days = [e.as_of for e in entries]
        if closed_on and max(days) > closed_on:
            raise HTTPException(status_code=422, detail="There are balance entries after that closed date")
        if data.get("currency") and data["currency"] != account.currency:
            raise HTTPException(status_code=409, detail="Currency can't change once balances are recorded")

    for field in ("name", "account_type", "currency"):
        if field in data and data[field] is None:
            del data[field]  # required columns can't be cleared
    new_type = data.get("account_type", account.account_type)
    if new_type not in PORTFOLIO_ACCOUNT_TYPES and db.scalar(select(Portfolio.id).where(Portfolio.account_id == account.id).limit(1)):
        raise HTTPException(status_code=409, detail="This account has a portfolio, so it stays a brokerage account — delete its portfolio first")
    for field in ("name", "institution", "account_type", "closed_on", "country", "currency"):
        if field in data:
            setattr(account, field, data[field])
    if body.links is not None:
        _replace_links(db, account, body.links)
    account.updated_at = utcnow()
    db.commit()
    return _detail(db, _load(db, workspace, account.id))


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(account_id: uuid.UUID, workspace: Workspace = Depends(get_current_workspace), db: Session = Depends(get_db)) -> None:
    account = get_account(db, workspace, account_id)
    soft_delete.delete_account(db, account.id)
    db.commit()


# ── balances (append-only) ────────────────────────────────────────────────────


@router.get("/{account_id}/balances", response_model=BalanceHistory)
def balance_history(account_id: uuid.UUID, workspace: Workspace = Depends(get_current_workspace), db: Session = Depends(get_db)) -> BalanceHistory:
    account = get_account(db, workspace, account_id)
    entries = _entries_by_account(db, [account.id])[account.id]
    timeline = _timeline(entries)
    winners = effective_ids(timeline.points, key=lambda p: p.ref.id)

    out: list[BalanceEntryOut] = []
    for point in timeline.points:
        entry = point.ref
        prior = timeline.before(point)
        out.append(
            BalanceEntryOut(
                id=entry.id,
                as_of=entry.as_of,
                amount=entry.amount,
                note=entry.note,
                recorded_at=entry.created_at,
                effective=entry.id in winners,
                change=(entry.amount - prior.value) if prior else None,
            )
        )
    out.sort(key=lambda e: (e.as_of, e.recorded_at), reverse=True)

    monthly: list[MonthPoint] = []
    if timeline:
        last_day = min(account.closed_on or date.today(), date.today())
        for m in months_between(timeline.first_day(), max(last_day, timeline.first_day())):
            point = timeline.at(month_end(m))
            monthly.append(MonthPoint(month=month_key(m), balance=point.value if point else None))
    return BalanceHistory(entries=out, monthly=monthly)


@router.post("/{account_id}/balances", response_model=BalanceEntryOut, status_code=status.HTTP_201_CREATED)
def record_balance(
    account_id: uuid.UUID, body: BalanceCreate, workspace: Workspace = Depends(get_current_workspace), db: Session = Depends(get_db)
) -> BalanceEntryOut:
    account = get_account(db, workspace, account_id)
    if body.as_of > latest_allowed_date():
        raise HTTPException(status_code=422, detail="Date cannot be in the future")
    _check_entry_date(account, body.as_of)
    entry = BalanceEntry(account_id=account.id, **body.model_dump())
    db.add(entry)
    account.updated_at = utcnow()
    db.commit()
    db.refresh(entry)
    timeline = _timeline(_entries_by_account(db, [account.id])[account.id])
    prior = timeline.before(Point(entry.as_of, entry.created_at, entry.amount))
    return BalanceEntryOut(
        id=entry.id,
        as_of=entry.as_of,
        amount=entry.amount,
        note=entry.note,
        recorded_at=entry.created_at,
        effective=True,
        change=(entry.amount - prior.value) if prior else None,
    )


@router.delete("/{account_id}/balances/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_balance(
    account_id: uuid.UUID, entry_id: uuid.UUID, workspace: Workspace = Depends(get_current_workspace), db: Session = Depends(get_db)
) -> None:
    account = get_account(db, workspace, account_id)
    entry = db.scalar(select(BalanceEntry).where(BalanceEntry.id == entry_id, BalanceEntry.account_id == account.id))
    if entry is None:
        raise HTTPException(status_code=404, detail="Balance entry not found")
    entry.deleted_at = utcnow()
    account.updated_at = utcnow()
    db.commit()
