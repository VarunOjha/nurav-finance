"""Bucket definitions: one list per user, shared by every workspace."""

import uuid
from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db, utcnow
from dependencies import get_current_user
from models import Account, AccountSplit, AccountSplitLine, Bucket, BucketTarget, Milestone, User, Workspace
from models.bucket import COLOR_SLOTS, DEFAULT_BUCKETS
from schemas.buckets import BucketAccountRef, BucketCreate, BucketOrder, BucketOut, BucketUpdate
from services.splits import load_splits

router = APIRouter()

DUPLICATE = "A bucket with that name already exists"


def _current_accounts(db: Session, user: User) -> dict[uuid.UUID, list[BucketAccountRef]]:
    """bucket id -> accounts (any of the user's workspaces) whose split in force today uses it."""
    rows = db.execute(
        select(Account.id, Account.name, Workspace.id, Workspace.name)
        .join(Workspace, Workspace.id == Account.workspace_id)
        .where(Workspace.user_id == user.id)
        .order_by(Workspace.name, Account.name)
    ).all()
    timelines = load_splits(db, [r[0] for r in rows])
    today = date.today()
    out: dict[uuid.UUID, list[BucketAccountRef]] = defaultdict(list)
    for account_id, name, ws_id, ws_name in rows:
        split = timelines[account_id].at(today)
        for bucket_id, _ in split.lines if split else ():
            out[bucket_id].append(BucketAccountRef(id=account_id, name=name, workspace_id=ws_id, workspace_name=ws_name))
    return out


def _used(db: Session, user: User) -> set[uuid.UUID]:
    """Buckets referenced by any live split line of a live account (past or present)."""
    return set(
        db.scalars(
            select(AccountSplitLine.bucket_id)
            .join(AccountSplit, AccountSplit.id == AccountSplitLine.split_id)
            .join(Account, Account.id == AccountSplit.account_id)
            .join(Bucket, Bucket.id == AccountSplitLine.bucket_id)
            .where(Bucket.user_id == user.id)
            .distinct()
        )
    )


def _milestone_counts(db: Session, user: User) -> dict[uuid.UUID, int]:
    """Per bucket: how many live milestones (any workspace of the user) have a target for it."""
    return dict(
        db.execute(
            select(BucketTarget.bucket_id, func.count(func.distinct(BucketTarget.milestone_id)))
            .join(Milestone, Milestone.id == BucketTarget.milestone_id)
            .join(Workspace, Workspace.id == BucketTarget.workspace_id)
            .where(Workspace.user_id == user.id)
            .group_by(BucketTarget.bucket_id)
        ).all()
    )


def _out(bucket: Bucket, current: dict, used: set, milestones: dict) -> BucketOut:
    out = BucketOut.model_validate(bucket)
    out.archived = bucket.archived_at is not None
    out.current_accounts = current.get(bucket.id, [])
    out.milestone_count = milestones.get(bucket.id, 0)
    out.used = bucket.id in used or out.milestone_count > 0
    return out


def _all(db: Session, user: User) -> list[Bucket]:
    return list(db.scalars(select(Bucket).where(Bucket.user_id == user.id).order_by(Bucket.position, func.lower(Bucket.name))))


def _list(db: Session, user: User) -> list[BucketOut]:
    current, used, milestones = _current_accounts(db, user), _used(db, user), _milestone_counts(db, user)
    return [_out(b, current, used, milestones) for b in _all(db, user)]


def _one(db: Session, user: User, bucket: Bucket) -> BucketOut:
    return _out(bucket, _current_accounts(db, user), _used(db, user), _milestone_counts(db, user))


def _get_owned(db: Session, user: User, bucket_id: uuid.UUID) -> Bucket:
    bucket = db.scalar(select(Bucket).where(Bucket.id == bucket_id, Bucket.user_id == user.id))
    if bucket is None:
        raise HTTPException(status_code=404, detail="Bucket not found")
    return bucket


def _next_color(existing: list[Bucket]) -> int:
    taken = [b.color for b in existing if b.archived_at is None]
    free = [c for c in range(COLOR_SLOTS) if c not in taken]
    return free[0] if free else len(existing) % COLOR_SLOTS


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=DUPLICATE) from None


def add_defaults(db: Session, user_id: uuid.UUID, existing: list[Bucket]) -> None:
    """Add any starter bucket whose name isn't taken yet (case-insensitive)."""
    names = {b.name.lower() for b in existing}
    position = max((b.position for b in existing), default=-1) + 1
    pool = list(existing)
    for name, description in DEFAULT_BUCKETS:
        if name.lower() in names:
            continue
        bucket = Bucket(user_id=user_id, name=name, description=description, color=_next_color(pool), position=position)
        db.add(bucket)
        pool.append(bucket)
        position += 1


@router.get("", response_model=list[BucketOut])
def list_buckets(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[BucketOut]:
    return _list(db, user)


@router.post("", response_model=BucketOut, status_code=status.HTTP_201_CREATED)
def create_bucket(body: BucketCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> BucketOut:
    existing = _all(db, user)
    name = body.name.strip()
    if any(b.name.lower() == name.lower() for b in existing):
        raise HTTPException(status_code=409, detail=DUPLICATE)
    bucket = Bucket(
        user_id=user.id,
        name=name,
        description=(body.description or "").strip() or None,
        color=body.color if body.color is not None else _next_color(existing),
        position=max((b.position for b in existing), default=-1) + 1,
    )
    db.add(bucket)
    _commit(db)
    db.refresh(bucket)
    return _one(db, user, bucket)


@router.post("/seed", response_model=list[BucketOut])
def seed_defaults(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[BucketOut]:
    add_defaults(db, user.id, _all(db, user))
    _commit(db)
    return _list(db, user)


@router.put("/order", response_model=list[BucketOut])
def reorder(body: BucketOrder, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[BucketOut]:
    buckets = {b.id: b for b in _all(db, user)}
    if set(body.ids) != set(buckets) or len(body.ids) != len(buckets):
        raise HTTPException(status_code=422, detail="Send every bucket id exactly once")
    for i, bucket_id in enumerate(body.ids):
        buckets[bucket_id].position = i
    db.commit()
    return _list(db, user)


@router.patch("/{bucket_id}", response_model=BucketOut)
def update_bucket(bucket_id: uuid.UUID, body: BucketUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> BucketOut:
    bucket = _get_owned(db, user, bucket_id)
    data = body.model_dump(exclude_unset=True)
    if data.get("name"):
        name = data["name"].strip()
        if any(b.id != bucket.id and b.name.lower() == name.lower() for b in _all(db, user)):
            raise HTTPException(status_code=409, detail=DUPLICATE)
        bucket.name = name
    if "description" in data:
        bucket.description = (data["description"] or "").strip() or None
    if data.get("color") is not None:
        bucket.color = data["color"]
    _commit(db)
    db.refresh(bucket)
    return _one(db, user, bucket)


@router.post("/{bucket_id}/archive", response_model=BucketOut)
def archive_bucket(bucket_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> BucketOut:
    bucket = _get_owned(db, user, bucket_id)
    accounts = _current_accounts(db, user).get(bucket.id, [])
    if accounts:
        names = ", ".join(a.name for a in accounts)
        raise HTTPException(status_code=409, detail=f"Move these accounts out of {bucket.name} first: {names}")
    if bucket.archived_at is None:
        bucket.archived_at = utcnow()
        db.commit()
    return _one(db, user, bucket)


@router.post("/{bucket_id}/unarchive", response_model=BucketOut)
def unarchive_bucket(bucket_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> BucketOut:
    bucket = _get_owned(db, user, bucket_id)
    bucket.archived_at = None
    db.commit()
    return _one(db, user, bucket)


@router.delete("/{bucket_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bucket(bucket_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> None:
    """Only a bucket nothing ever used can go; anything with history is archived instead."""
    bucket = _get_owned(db, user, bucket_id)
    if bucket.id in _used(db, user) or _milestone_counts(db, user).get(bucket.id):
        raise HTTPException(status_code=409, detail="This bucket has history (splits or milestones) — archive it instead")
    bucket.deleted_at = utcnow()
    db.commit()
