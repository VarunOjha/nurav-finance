"""Wealth estimator (per workspace): the pool, saved inquiries, and making a new one.

POST /inquiries streams NDJSON like the screenshot import: `stage` events,
then one `result` (the saved inquiry's id) or `error`.
"""

import json
import uuid
from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from config import settings
from database import get_db, utcnow
from dependencies import get_current_user, get_current_workspace
from models import User, WealthInquiry, Workspace
from schemas.estimator import InquiryCreate, InquiryDetail, InquirySummary, Pool
from services.estimator import pipeline
from services.estimator.pool import included, pool_accounts, snapshot
from services.screenshot.openrouter import OpenRouter

router = APIRouter()


def get_estimator_llm() -> OpenRouter:
    """FastAPI dependency (tests override it with a scripted transport)."""
    return OpenRouter(
        model=settings.estimator_model,
        feature="The wealth estimator",
        cutoff="The review came out longer than the model can write in one answer. Try again.",
    )


def _inquiries(db: Session, workspace: Workspace) -> list[WealthInquiry]:
    return list(db.scalars(select(WealthInquiry).where(WealthInquiry.workspace_id == workspace.id).order_by(WealthInquiry.created_at)))


def _summary(i: WealthInquiry) -> dict:
    r = i.result
    b = r["scenarios"]["balanced"]
    return {
        "id": i.id,
        "created_at": i.created_at,
        "monthly_expenses": i.monthly_expenses,
        "currency": i.currency,
        "withdrawal_rate_pct": r["withdrawal_rate_pct"],
        "pool": r["pool"],
        "fi_years": {k: v["fi_year"] for k, v in r["scenarios"].items()},
        "fi_today": b["fi_today"],
        "progress": b["progress"],
        "fi_age": b["fi_age"],
        "structure": r["structure"]["overall"],
        "model": i.model,
        "changes": [c["title"] for c in r["changes"]],
        "targets": {x["key"]: x["target_pct"] for x in b["rebalance"]},
        "labels": {x["key"]: x["label"] for x in b["rebalance"]},
    }


def _get(db: Session, workspace: Workspace, inquiry_id: uuid.UUID) -> WealthInquiry:
    i = db.get(WealthInquiry, inquiry_id)
    if i is None or i.deleted_at is not None or i.workspace_id != workspace.id:
        raise HTTPException(status_code=404, detail="Inquiry not found")
    return i


@router.get("/pool", response_model=Pool)
def get_pool(workspace: Workspace = Depends(get_current_workspace), db: Session = Depends(get_db)) -> dict:
    rows = pool_accounts(db, workspace, date.today())
    # Most accounts first (USD before INR for a mostly-US workspace, like the dashboard); raw totals
    # can't rank currencies (₹71L is a bigger number than $680k).
    counts: dict[str, int] = defaultdict(int)
    for r in rows:
        if not r.fixed:
            counts[r.currency] += 1
    return {
        "accounts": [
            {
                "id": r.id,
                "name": r.name,
                "institution": r.institution,
                "account_type": r.account_type,
                "currency": r.currency,
                "value": r.value,
                "fixed": r.fixed,
            }
            for r in rows
        ],
        "currencies": sorted(counts, key=lambda c: (-counts[c], c)),
    }


@router.get("/inquiries", response_model=list[InquirySummary])
def list_inquiries(workspace: Workspace = Depends(get_current_workspace), db: Session = Depends(get_db)) -> list[dict]:
    """Oldest first."""
    return [_summary(i) for i in _inquiries(db, workspace)]


@router.get("/inquiries/{inquiry_id}", response_model=InquiryDetail)
def get_inquiry(inquiry_id: uuid.UUID, workspace: Workspace = Depends(get_current_workspace), db: Session = Depends(get_db)) -> dict:
    i = _get(db, workspace, inquiry_id)
    earlier = [x for x in _inquiries(db, workspace) if x.created_at < i.created_at]
    return {
        "id": i.id,
        "created_at": i.created_at,
        "monthly_expenses": i.monthly_expenses,
        "currency": i.currency,
        "model": i.model,
        "cost": i.cost,
        "result": i.result,
        "previous": _summary(earlier[-1]) if earlier else None,
    }


@router.delete("/inquiries/{inquiry_id}", status_code=204)
def delete_inquiry(inquiry_id: uuid.UUID, workspace: Workspace = Depends(get_current_workspace), db: Session = Depends(get_db)) -> Response:
    i = _get(db, workspace, inquiry_id)
    i.deleted_at = utcnow()
    db.commit()
    return Response(status_code=204)


@router.post("/inquiries")
async def create_inquiry(
    body: InquiryCreate,
    workspace: Workspace = Depends(get_current_workspace),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    llm: OpenRouter = Depends(get_estimator_llm),
) -> StreamingResponse:
    if not llm.enabled:
        raise HTTPException(status_code=503, detail=llm.missing_key)
    today = date.today()
    rows = pool_accounts(db, workspace, today)
    known = {r.id for r in rows}
    excluded = [x for x in dict.fromkeys(body.excluded_account_ids) if x in known]
    if not included(rows, set(excluded)):
        raise HTTPException(status_code=422, detail="Nothing is in the pool: tick at least one account with money in it")
    latest = _inquiries(db, workspace)[-1:] or [None]
    previous_advice = [c["title"] for c in latest[0].result["changes"]] if latest[0] else []
    snap = snapshot(db, workspace, user, rows, set(excluded), body.monthly_expenses, body.currency, body.withdrawal_rate_pct, today, previous_advice)
    dob = user.date_of_birth
    workspace_id = workspace.id

    async def events():
        async for event in pipeline.run(llm, snap, workspace_id, body.monthly_expenses, excluded, dob):
            yield json.dumps(event, ensure_ascii=False) + "\n"

    return StreamingResponse(events(), media_type="application/x-ndjson", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
