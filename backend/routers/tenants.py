import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user
from models import Account, Portfolio, Tenant, User
from schemas.tenancy import TenantCreate, TenantOut, TenantUpdate
from services import soft_delete

router = APIRouter()


def _counts(db: Session, tenant_ids: list[uuid.UUID]) -> tuple[dict, dict]:
    if not tenant_ids:
        return {}, {}
    accounts = dict(
        db.execute(select(Account.tenant_id, func.count(Account.id)).where(Account.tenant_id.in_(tenant_ids)).group_by(Account.tenant_id)).all()
    )
    portfolios = dict(
        db.execute(
            select(Portfolio.tenant_id, func.count(Portfolio.id)).where(Portfolio.tenant_id.in_(tenant_ids)).group_by(Portfolio.tenant_id)
        ).all()
    )
    return accounts, portfolios


def _out(tenant: Tenant, accounts: dict, portfolios: dict) -> TenantOut:
    out = TenantOut.model_validate(tenant)
    out.account_count = accounts.get(tenant.id, 0)
    out.portfolio_count = portfolios.get(tenant.id, 0)
    return out


def _get_owned(db: Session, user: User, tenant_id: uuid.UUID) -> Tenant:
    tenant = db.scalar(select(Tenant).where(Tenant.id == tenant_id, Tenant.user_id == user.id))
    if tenant is None:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return tenant


def _name_conflict() -> HTTPException:
    return HTTPException(status_code=409, detail="You already have a tenant with that name")


@router.get("", response_model=list[TenantOut])
def list_tenants(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[TenantOut]:
    # Default first, then oldest first — the switcher shows them in this order.
    tenants = db.scalars(select(Tenant).where(Tenant.user_id == user.id).order_by(Tenant.is_default.desc(), Tenant.created_at)).all()
    accounts, portfolios = _counts(db, [t.id for t in tenants])
    return [_out(t, accounts, portfolios) for t in tenants]


@router.post("", response_model=TenantOut, status_code=status.HTTP_201_CREATED)
def create_tenant(body: TenantCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> TenantOut:
    tenant = Tenant(user_id=user.id, name=body.name.strip(), description=(body.description or "").strip() or None)
    db.add(tenant)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _name_conflict() from None
    db.refresh(tenant)
    return _out(tenant, {}, {})


@router.patch("/{tenant_id}", response_model=TenantOut)
def update_tenant(tenant_id: uuid.UUID, body: TenantUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> TenantOut:
    tenant = _get_owned(db, user, tenant_id)
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        if tenant.is_default and data["name"].strip() != tenant.name:
            raise HTTPException(status_code=400, detail="The default tenant can't be renamed")
        tenant.name = data["name"].strip()
    if "description" in data:
        tenant.description = (data["description"] or "").strip() or None
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _name_conflict() from None
    db.refresh(tenant)
    accounts, portfolios = _counts(db, [tenant.id])
    return _out(tenant, accounts, portfolios)


@router.delete("/{tenant_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tenant(tenant_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> None:
    tenant = _get_owned(db, user, tenant_id)
    if tenant.is_default:
        raise HTTPException(status_code=400, detail="The default tenant can't be deleted")
    accounts, portfolios = _counts(db, [tenant.id])
    if accounts.get(tenant.id) or portfolios.get(tenant.id):
        raise HTTPException(
            status_code=409,
            detail="Delete this tenant's accounts and portfolios first — only empty tenants can be deleted",
        )
    soft_delete.delete_tenant(db, tenant.id)
    db.commit()
