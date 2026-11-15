"""An account's bucket split: effective-dated, append-only versions."""

import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db, utcnow
from dependencies import get_current_workspace
from models import Account, AccountSplit, AccountSplitLine, Bucket, Workspace
from schemas.buckets import AccountSplits, SplitCreate, SplitLineOut, SplitOut
from schemas.common import latest_allowed_date
from services import analytics
from services.access import get_account
from services.holdings import q
from services.splits import HUNDRED, SplitTimeline, SplitVersion, load_splits

router = APIRouter()


def account_value_today(db: Session, workspace: Workspace, account: Account) -> Decimal | None:
    """The money an account's split shares out today: its balance, or its open portfolio's holdings while it has one."""
    today = date.today()
    values = [
        i.value(today)
        for i in analytics.load_items(db, workspace)
        if (i.kind == "account" and i.id == account.id) or (i.kind == "portfolio" and i.account_id == account.id)
    ]
    present = [v for v in values if v is not None]
    return q(sum(present, Decimal(0))) if present else None


def split_out(timeline: SplitTimeline, version: SplitVersion, value: Decimal | None = None) -> SplitOut:
    split = version.ref
    lines = []
    for line in sorted(split.lines, key=lambda x: x.position):
        lines.append(
            SplitLineOut(
                bucket_id=line.bucket_id,
                name=line.bucket.name,
                color=line.bucket.color,
                archived=line.bucket.archived_at is not None,
                percent=line.percent,
                value=q(value * line.percent / HUNDRED) if value is not None else None,
            )
        )
    return SplitOut(
        id=split.id,
        effective_from=split.effective_from,
        covers_history=version is timeline.versions[0],
        until=timeline.until(version),
        note=split.note,
        recorded_at=split.created_at,
        lines=lines,
    )


def _splits(db: Session, workspace: Workspace, account: Account) -> AccountSplits:
    db.expire_all()
    timeline = load_splits(db, [account.id])[account.id]
    value = account_value_today(db, workspace, account)
    current = timeline.at(date.today())
    return AccountSplits(
        account_id=account.id,
        currency=account.currency,
        value=value,
        current=split_out(timeline, current, value) if current else None,
        history=[split_out(timeline, v) for v in reversed(timeline.versions)],
    )


def _delete_split(db: Session, split: AccountSplit) -> None:
    now = utcnow()
    for line in split.lines:
        line.deleted_at = now
    split.deleted_at = now


@router.get("/{account_id}/splits", response_model=AccountSplits)
def get_splits(account_id: uuid.UUID, workspace: Workspace = Depends(get_current_workspace), db: Session = Depends(get_db)) -> AccountSplits:
    return _splits(db, workspace, get_account(db, workspace, account_id))


@router.post("/{account_id}/splits", response_model=AccountSplits, status_code=status.HTTP_201_CREATED)
def create_split(
    account_id: uuid.UUID, body: SplitCreate, workspace: Workspace = Depends(get_current_workspace), db: Session = Depends(get_db)
) -> AccountSplits:
    account = get_account(db, workspace, account_id)

    ids = [line.bucket_id for line in body.lines]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=422, detail="Each bucket can appear only once in a split")
    total = sum((line.percent for line in body.lines), Decimal(0))
    if total != HUNDRED:
        raise HTTPException(status_code=422, detail=f"The split must add up to 100% (it adds up to {total.normalize():f}%)")
    buckets = {b.id: b for b in db.scalars(select(Bucket).where(Bucket.id.in_(ids), Bucket.user_id == workspace.user_id))}
    if len(buckets) != len(ids):
        raise HTTPException(status_code=422, detail="Unknown bucket")
    archived = [b.name for b in buckets.values() if b.archived_at is not None]
    if archived:
        raise HTTPException(status_code=422, detail=f"{', '.join(archived)} is archived — unarchive it in Profile to use it again")

    existing = list(db.scalars(select(AccountSplit).where(AccountSplit.account_id == account.id)))
    effective_from: date | None = None
    if existing:
        effective_from = body.effective_from
        if effective_from is None:
            raise HTTPException(status_code=422, detail="Pick the date this split takes effect from")
        if effective_from > latest_allowed_date():
            raise HTTPException(status_code=422, detail="Date cannot be in the future")
    # Saving on a date that already has a split replaces it (a correction).
    for old in existing:
        if old.effective_from == effective_from:
            _delete_split(db, old)
    db.flush()

    split = AccountSplit(account_id=account.id, effective_from=effective_from, note=(body.note or "").strip() or None)
    db.add(split)
    db.flush()
    for i, line in enumerate(body.lines):
        db.add(AccountSplitLine(split_id=split.id, bucket_id=line.bucket_id, percent=line.percent, position=i))
    account.updated_at = utcnow()
    db.commit()
    return _splits(db, workspace, account)


@router.delete("/{account_id}/splits/{split_id}", response_model=AccountSplits)
def delete_split(
    account_id: uuid.UUID, split_id: uuid.UUID, workspace: Workspace = Depends(get_current_workspace), db: Session = Depends(get_db)
) -> AccountSplits:
    """Undo one version. Deleting the only one makes the account Unassigned again."""
    account = get_account(db, workspace, account_id)
    split = db.scalar(select(AccountSplit).where(AccountSplit.id == split_id, AccountSplit.account_id == account.id))
    if split is None:
        raise HTTPException(status_code=404, detail="Split not found")
    _delete_split(db, split)
    account.updated_at = utcnow()
    db.commit()
    return _splits(db, workspace, account)
