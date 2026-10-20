import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from config import settings
from database import get_db, utcnow
from dependencies import get_current_tenant, get_current_user
from models import Tenant, User, WealthPlan
from routers.agent import snapshot
from schemas.wealth import Narrative, Plan, PlanRename, PlanSave, PlanSummary
from services.agent import narrative as narr
from services.agent.loop import fallback_narrative
from services.agent.signing import BadSignature, verify
from services.wealth.run import run_version

router = APIRouter()

NAME_TAKEN = "A plan with that name already exists"


def _plan(db: Session, tenant: Tenant, plan_id: uuid.UUID) -> WealthPlan:
    plan = db.scalar(select(WealthPlan).where(WealthPlan.id == plan_id, WealthPlan.tenant_id == tenant.id))
    if plan is None:
        raise HTTPException(status_code=404, detail="Plan not found")
    return plan


def _taken(db: Session, tenant: Tenant, name: str, exclude: uuid.UUID | None = None) -> bool:
    stmt = select(WealthPlan.id).where(WealthPlan.tenant_id == tenant.id, func.lower(WealthPlan.name) == name.lower())
    if exclude is not None:
        stmt = stmt.where(WealthPlan.id != exclude)
    return db.scalar(stmt) is not None


def _summary(p: WealthPlan) -> dict:
    f = p.report["figures"]
    pots = []
    for r in p.report["pots"]:
        c, a = r["currency"], r["answer"]
        answer = {
            "time": f.get(f"fi_date:{c}", "not within 60 years"),
            "amount": f.get(f"final:{c}", ""),
            "rate": f.get(f"required_rate:{c}", "out of reach" if a.get("status") == "unreachable" else "—"),
            "contribution": f"{f[f'required_contribution:{c}']}/{a.get('per', 'month')}" if f"required_contribution:{c}" in f else "—",
        }[r["solve_for"]]
        pots.append({"currency": c, "solve_for": r["solve_for"], "start": r["start"], "answer": answer})
    return {"id": p.id, "name": p.name, "as_of": p.as_of, "created_at": p.created_at, "pots": pots}


@router.get("/plans", response_model=list[PlanSummary])
def list_plans(tenant: Tenant = Depends(get_current_tenant), db: Session = Depends(get_db)) -> list[dict]:
    plans = db.scalars(select(WealthPlan).where(WealthPlan.tenant_id == tenant.id).order_by(WealthPlan.created_at.desc())).all()
    return [_summary(p) for p in plans]


@router.post("/plans", response_model=Plan, status_code=status.HTTP_201_CREATED)
def save_plan(
    body: PlanSave, tenant: Tenant = Depends(get_current_tenant), user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> WealthPlan:
    """Freeze an approved version. The engine re-runs the signed draft, so stored numbers are the server's own."""
    try:
        draft = verify(body.draft, str(tenant.id))
    except BadSignature as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    if _taken(db, tenant, body.name):
        raise HTTPException(status_code=409, detail=NAME_TAKEN)
    snap = snapshot(db, tenant, user)
    version = run_version(draft, snap, n=1)
    figures = version["figures"]
    template = None
    if body.narrative is not None:
        try:
            template = Narrative.model_validate(body.narrative).model_dump()
        except ValidationError:
            raise HTTPException(status_code=422, detail="The report text is malformed") from None
        template = narr.scrub(template, figures, fallback_narrative(version)["headline"])
    template = template or fallback_narrative(version)
    names = snap.display_map()
    version["narrative"] = narr.render_all(template, figures, names)
    # The title and warnings name items by alias.
    version["draft"] = {
        **draft,
        "warnings": [narr.swap_aliases(w, names) for w in draft["warnings"]],
        "params": {**draft["params"], "title": narr.swap_aliases(draft["params"]["title"], names)},
    }
    version.pop("n", None)
    pots = version["pots"]
    solves = {r["solve_for"] for r in pots}
    plan = WealthPlan(
        tenant_id=tenant.id,
        created_by=user.id,
        name=body.name,
        mode=solves.pop() if len(solves) == 1 else "mixed",
        currency=pots[0]["currency"],  # the first pot's; every pot is in the report
        as_of=draft["as_of"],
        horizon_years=pots[0]["horizon_years"],
        params=body.draft,
        report=version,
        model="fake/agent" if settings.agent_fake else settings.agent_model,
    )
    db.add(plan)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=NAME_TAKEN) from None
    db.refresh(plan)
    return plan


@router.get("/plans/{plan_id}", response_model=Plan)
def get_plan(plan_id: uuid.UUID, tenant: Tenant = Depends(get_current_tenant), db: Session = Depends(get_db)) -> WealthPlan:
    return _plan(db, tenant, plan_id)


@router.patch("/plans/{plan_id}", response_model=Plan)
def rename_plan(plan_id: uuid.UUID, body: PlanRename, tenant: Tenant = Depends(get_current_tenant), db: Session = Depends(get_db)) -> WealthPlan:
    """Only the name can change: a saved plan is frozen."""
    plan = _plan(db, tenant, plan_id)
    if _taken(db, tenant, body.name, exclude=plan.id):
        raise HTTPException(status_code=409, detail=NAME_TAKEN)
    plan.name = body.name
    db.commit()
    db.refresh(plan)
    return plan


@router.delete("/plans/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plan(plan_id: uuid.UUID, tenant: Tenant = Depends(get_current_tenant), db: Session = Depends(get_db)) -> None:
    plan = _plan(db, tenant, plan_id)
    plan.deleted_at = utcnow()
    db.commit()
