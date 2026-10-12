import uuid
from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from database import get_db, utcnow
from dependencies import get_current_tenant
from models import Account, AccountIdentifier, AccountLink, AccountTag, BalanceEntry, Portfolio, Tenant
from schemas.account import (
    AccountCreate,
    AccountDetail,
    AccountSummary,
    AccountUpdate,
    BalanceCreate,
    BalanceEntryOut,
    BalanceHistory,
    IdentifierIn,
    LinkIn,
    MonthPoint,
    RevealedNumber,
)
from schemas.common import latest_allowed_date
from schemas.tenancy import TagRef
from services import soft_delete
from services.access import get_account, owned_tags
from services.crypto import decrypt_account_number, encrypt_account_number
from services.ledger import Point, Timeline, effective_ids, month_end, month_key, months_between

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


def _mask(account: Account) -> str | None:
    return f"••••{account.account_number_last4}" if account.account_number_last4 else None


def _summary(account: Account, entries: list[BalanceEntry]) -> dict:
    timeline = _timeline(entries)
    latest = timeline.latest()
    previous = timeline.before(latest) if latest else None
    return dict(
        id=account.id,
        name=account.name,
        institution=account.institution,
        account_type=account.account_type,
        account_number_masked=_mask(account),
        country=account.country,
        city=account.city,
        currency=account.currency,
        opened_on=account.opened_on,
        closed_on=account.closed_on,
        status="closed" if account.closed_on else "active",
        tags=[TagRef.model_validate(link.tag) for link in account.tag_links],
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
        **_summary(account, entries),
        holder_name=account.holder_name,
        notes=account.notes,
        has_account_number=account.account_number_enc is not None,
        identifiers=account.identifiers,
        links=account.links,
        portfolios=portfolios,
        created_at=account.created_at,
    )


def _check_dates(opened_on: date | None, closed_on: date | None) -> None:
    if opened_on and closed_on and closed_on < opened_on:
        raise HTTPException(status_code=422, detail="Closed date can't be before the opened date")


def _check_entry_date(account: Account, as_of: date) -> None:
    if account.opened_on and as_of < account.opened_on:
        raise HTTPException(
            status_code=422,
            detail=f"Date is before the account was opened ({account.opened_on.isoformat()}) — " "change the opened date first if this is right",
        )
    if account.closed_on and as_of > account.closed_on:
        raise HTTPException(status_code=422, detail="Date is after the account was closed")


def _replace_identifiers(db: Session, account: Account, items: list[IdentifierIn]) -> None:
    now = utcnow()
    for old in account.identifiers:
        old.deleted_at = now
    for i, item in enumerate(items):
        db.add(AccountIdentifier(account_id=account.id, label=item.label.strip(), value=item.value.strip(), position=i))


def _replace_links(db: Session, account: Account, items: list[LinkIn]) -> None:
    now = utcnow()
    for old in account.links:
        old.deleted_at = now
    for i, item in enumerate(items):
        db.add(AccountLink(account_id=account.id, label=item.label.strip(), url=str(item.url), position=i))


def _replace_tags(db: Session, tenant: Tenant, account: Account, tag_ids: list[uuid.UUID]) -> None:
    wanted = {t.id for t in owned_tags(db, tenant, tag_ids)}
    now = utcnow()
    current = {link.tag_id: link for link in account.tag_links}
    for tag_id, link in current.items():
        if tag_id not in wanted:
            link.deleted_at = now
    for tag_id in wanted - current.keys():
        db.add(AccountTag(account_id=account.id, tag_id=tag_id))


def _load(db: Session, tenant: Tenant, account_id: uuid.UUID) -> Account:
    db.expire_all()  # drop collections cached before a write in this request
    return get_account(db, tenant, account_id)


# ── accounts ──────────────────────────────────────────────────────────────────


@router.get("", response_model=list[AccountSummary])
def list_accounts(
    status_filter: Literal["active", "closed", "all"] = Query("all", alias="status"),
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> list[AccountSummary]:
    stmt = (
        select(Account)
        .where(Account.tenant_id == tenant.id)
        .options(selectinload(Account.tag_links).selectinload(AccountTag.tag))
        .order_by(Account.closed_on.is_not(None), Account.currency, Account.name)
    )
    if status_filter == "active":
        stmt = stmt.where(Account.closed_on.is_(None))
    elif status_filter == "closed":
        stmt = stmt.where(Account.closed_on.is_not(None))
    accounts = db.scalars(stmt).all()
    entries = _entries_by_account(db, [a.id for a in accounts])
    return [AccountSummary(**_summary(a, entries.get(a.id, []))) for a in accounts]


@router.post("", response_model=AccountDetail, status_code=status.HTTP_201_CREATED)
def create_account(body: AccountCreate, tenant: Tenant = Depends(get_current_tenant), db: Session = Depends(get_db)) -> AccountDetail:
    _check_dates(body.opened_on, body.closed_on)
    account = Account(
        tenant_id=tenant.id,
        **body.model_dump(include=set(AccountCreate.model_fields) - {"account_number", "identifiers", "links", "tag_ids", "opening_balance"}),
    )
    if body.account_number and body.account_number.strip():
        account.account_number_enc, account.account_number_last4 = encrypt_account_number(body.account_number)
    db.add(account)
    db.flush()
    _replace_identifiers(db, account, body.identifiers)
    _replace_links(db, account, body.links)
    _replace_tags(db, tenant, account, body.tag_ids)
    if body.opening_balance:
        _check_entry_date(account, body.opening_balance.as_of)
        db.add(BalanceEntry(account_id=account.id, **body.opening_balance.model_dump()))
    db.commit()
    return _detail(db, _load(db, tenant, account.id))


@router.get("/{account_id}", response_model=AccountDetail)
def get_account_detail(account_id: uuid.UUID, tenant: Tenant = Depends(get_current_tenant), db: Session = Depends(get_db)) -> AccountDetail:
    return _detail(db, get_account(db, tenant, account_id))


@router.patch("/{account_id}", response_model=AccountDetail)
def update_account(
    account_id: uuid.UUID, body: AccountUpdate, tenant: Tenant = Depends(get_current_tenant), db: Session = Depends(get_db)
) -> AccountDetail:
    account = get_account(db, tenant, account_id)
    data = body.model_dump(exclude_unset=True)

    opened_on = data.get("opened_on", account.opened_on)
    closed_on = data.get("closed_on", account.closed_on)
    _check_dates(opened_on, closed_on)
    entries = _entries_by_account(db, [account.id])[account.id]
    if entries:
        days = [e.as_of for e in entries]
        if opened_on and min(days) < opened_on:
            raise HTTPException(status_code=422, detail="There are balance entries before that opened date")
        if closed_on and max(days) > closed_on:
            raise HTTPException(status_code=422, detail="There are balance entries after that closed date")
        if data.get("currency") and data["currency"] != account.currency:
            raise HTTPException(status_code=409, detail="Currency can't change once balances are recorded")

    for field in ("name", "account_type", "currency"):
        if field in data and data[field] is None:
            del data[field]  # required columns can't be cleared
    for field in ("name", "institution", "account_type", "holder_name", "opened_on", "closed_on", "country", "city", "currency", "notes"):
        if field in data:
            setattr(account, field, data[field])
    if "account_number" in data:
        number = (data["account_number"] or "").strip()
        if number:
            account.account_number_enc, account.account_number_last4 = encrypt_account_number(number)
        else:
            account.account_number_enc = account.account_number_last4 = None
    if body.identifiers is not None:
        _replace_identifiers(db, account, body.identifiers)
    if body.links is not None:
        _replace_links(db, account, body.links)
    if body.tag_ids is not None:
        _replace_tags(db, tenant, account, body.tag_ids)
    account.updated_at = utcnow()
    db.commit()
    return _detail(db, _load(db, tenant, account.id))


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(account_id: uuid.UUID, tenant: Tenant = Depends(get_current_tenant), db: Session = Depends(get_db)) -> None:
    account = get_account(db, tenant, account_id)
    soft_delete.delete_account(db, account.id)
    db.commit()


@router.post("/{account_id}/reveal", response_model=RevealedNumber)
def reveal_number(account_id: uuid.UUID, tenant: Tenant = Depends(get_current_tenant), db: Session = Depends(get_db)) -> RevealedNumber:
    account = get_account(db, tenant, account_id)
    if not account.account_number_enc:
        raise HTTPException(status_code=404, detail="No account number stored")
    return RevealedNumber(account_number=decrypt_account_number(account.account_number_enc))


# ── balances (append-only) ────────────────────────────────────────────────────


@router.get("/{account_id}/balances", response_model=BalanceHistory)
def balance_history(account_id: uuid.UUID, tenant: Tenant = Depends(get_current_tenant), db: Session = Depends(get_db)) -> BalanceHistory:
    account = get_account(db, tenant, account_id)
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
    account_id: uuid.UUID, body: BalanceCreate, tenant: Tenant = Depends(get_current_tenant), db: Session = Depends(get_db)
) -> BalanceEntryOut:
    account = get_account(db, tenant, account_id)
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
def delete_balance(account_id: uuid.UUID, entry_id: uuid.UUID, tenant: Tenant = Depends(get_current_tenant), db: Session = Depends(get_db)) -> None:
    account = get_account(db, tenant, account_id)
    entry = db.scalar(select(BalanceEntry).where(BalanceEntry.id == entry_id, BalanceEntry.account_id == account.id))
    if entry is None:
        raise HTTPException(status_code=404, detail="Balance entry not found")
    entry.deleted_at = utcnow()
    account.updated_at = utcnow()
    db.commit()
