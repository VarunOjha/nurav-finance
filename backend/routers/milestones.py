"""Milestones (per workspace) with their bucket targets, and the Metrics view built on them."""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database import get_db, utcnow
from dependencies import get_current_workspace
from models import Bucket, BucketTarget, Milestone, Workspace
from schemas.buckets import Metrics, MilestoneIn, MilestoneOut
from services import metrics as metrics_service
from services import soft_delete

router = APIRouter()


def _get(db: Session, workspace: Workspace, milestone_id: uuid.UUID) -> Milestone:
    milestone = db.scalar(select(Milestone).where(Milestone.id == milestone_id, Milestone.workspace_id == workspace.id))
    if milestone is None:
        raise HTTPException(status_code=404, detail="Milestone not found")
    return milestone


def _live_lines(milestone: Milestone) -> list[BucketTarget]:
    return [t for t in milestone.targets if t.deleted_at is None]


def _out(milestone: Milestone) -> MilestoneOut:
    return MilestoneOut(
        id=milestone.id,
        name=milestone.name,
        target_date=milestone.target_date,
        start_date=milestone.start_date,
        note=milestone.note,
        created_at=milestone.created_at,
        lines=[
            {
                "id": t.id,
                "bucket_id": t.bucket_id,
                "bucket_name": t.bucket.name,
                "color": t.bucket.color,
                "archived": t.bucket.archived_at is not None,
                "currency": t.currency,
                "amount": t.amount,
                "expected_return": t.expected_return,
            }
            for t in _live_lines(milestone)
        ],
    )


def _validate(db: Session, workspace: Workspace, body: MilestoneIn, start: date, milestone: Milestone | None) -> str:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Give the milestone a name")
    clash = select(Milestone.id).where(Milestone.workspace_id == workspace.id, func.lower(Milestone.name) == name.lower())
    if milestone is not None:
        clash = clash.where(Milestone.id != milestone.id)
    if db.scalar(clash) is not None:
        raise HTTPException(status_code=409, detail=f"A milestone named “{name}” already exists")
    same_day = select(Milestone.name).where(Milestone.workspace_id == workspace.id, Milestone.target_date == body.target_date)
    if milestone is not None:
        same_day = same_day.where(Milestone.id != milestone.id)
    other = db.scalar(same_day)
    if other is not None:
        raise HTTPException(status_code=409, detail=f"“{other}” is already on {body.target_date.day} {body.target_date:%b %Y}; pick another date")
    if body.target_date <= start:
        raise HTTPException(status_code=422, detail="The milestone date must be after the measure-from date")

    seen: set[tuple[uuid.UUID, str]] = set()
    kept = {(t.bucket_id, t.currency) for t in _live_lines(milestone)} if milestone else set()
    buckets = {
        b.id: b for b in db.scalars(select(Bucket).where(Bucket.id.in_([line.bucket_id for line in body.lines]), Bucket.user_id == workspace.user_id))
    }
    for line in body.lines:
        bucket = buckets.get(line.bucket_id)
        if bucket is None:
            raise HTTPException(status_code=422, detail="Unknown bucket")
        key = (line.bucket_id, line.currency)
        if key in seen:
            raise HTTPException(status_code=422, detail=f"{bucket.name} · {line.currency} is in this milestone twice")
        seen.add(key)
        # An archived bucket can stay in a milestone it was already in, but can't be added.
        if bucket.archived_at is not None and key not in kept:
            raise HTTPException(status_code=422, detail=f"{bucket.name} is archived")
    return name


def _save_lines(db: Session, workspace: Workspace, milestone: Milestone, body: MilestoneIn) -> None:
    """Replace the milestone's lines: update matches (bucket + currency), add new ones, soft-delete the rest."""
    existing = {(t.bucket_id, t.currency): t for t in _live_lines(milestone)}
    for position, line in enumerate(body.lines):
        target = existing.pop((line.bucket_id, line.currency), None)
        if target is None:
            target = BucketTarget(workspace_id=workspace.id, bucket_id=line.bucket_id, currency=line.currency)
            milestone.targets.append(target)
        target.amount = line.amount
        target.expected_return = line.expected_return
        target.position = position
        target.legacy_target_date = milestone.target_date
        target.legacy_start_date = milestone.start_date
    now = utcnow()
    for target in existing.values():
        target.deleted_at = now


@router.get("/milestones", response_model=list[MilestoneOut])
def list_milestones(workspace: Workspace = Depends(get_current_workspace), db: Session = Depends(get_db)) -> list[MilestoneOut]:
    milestones = db.scalars(select(Milestone).where(Milestone.workspace_id == workspace.id).order_by(Milestone.target_date, Milestone.name))
    return [_out(m) for m in milestones]


@router.post("/milestones", response_model=MilestoneOut, status_code=status.HTTP_201_CREATED)
def create_milestone(body: MilestoneIn, workspace: Workspace = Depends(get_current_workspace), db: Session = Depends(get_db)) -> MilestoneOut:
    start = body.start_date or date.today()
    name = _validate(db, workspace, body, start, None)
    milestone = Milestone(
        workspace_id=workspace.id, name=name, target_date=body.target_date, start_date=start, note=(body.note or "").strip() or None
    )
    db.add(milestone)
    _save_lines(db, workspace, milestone, body)
    db.commit()
    db.refresh(milestone)
    return _out(milestone)


@router.put("/milestones/{milestone_id}", response_model=MilestoneOut)
def update_milestone(
    milestone_id: uuid.UUID, body: MilestoneIn, workspace: Workspace = Depends(get_current_workspace), db: Session = Depends(get_db)
) -> MilestoneOut:
    milestone = _get(db, workspace, milestone_id)
    start = body.start_date or milestone.start_date
    milestone.name = _validate(db, workspace, body, start, milestone)
    milestone.target_date = body.target_date
    milestone.start_date = start
    milestone.note = (body.note or "").strip() or None
    _save_lines(db, workspace, milestone, body)
    db.commit()
    db.refresh(milestone)
    return _out(milestone)


@router.delete("/milestones/{milestone_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_milestone(milestone_id: uuid.UUID, workspace: Workspace = Depends(get_current_workspace), db: Session = Depends(get_db)) -> None:
    soft_delete.delete_milestone(db, _get(db, workspace, milestone_id).id)
    db.commit()


@router.get("/metrics", response_model=Metrics)
def get_metrics(workspace: Workspace = Depends(get_current_workspace), db: Session = Depends(get_db)) -> dict:
    return metrics_service.metrics(db, workspace)
