import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user
from models import Account, Portfolio, User, Workspace
from schemas.workspaces import WorkspaceCreate, WorkspaceOut, WorkspaceUpdate
from services import soft_delete

router = APIRouter()


def _counts(db: Session, workspace_ids: list[uuid.UUID]) -> tuple[dict, dict]:
    if not workspace_ids:
        return {}, {}
    accounts = dict(
        db.execute(
            select(Account.workspace_id, func.count(Account.id)).where(Account.workspace_id.in_(workspace_ids)).group_by(Account.workspace_id)
        ).all()
    )
    portfolios = dict(
        db.execute(
            select(Portfolio.workspace_id, func.count(Portfolio.id)).where(Portfolio.workspace_id.in_(workspace_ids)).group_by(Portfolio.workspace_id)
        ).all()
    )
    return accounts, portfolios


def _out(workspace: Workspace, accounts: dict, portfolios: dict) -> WorkspaceOut:
    out = WorkspaceOut.model_validate(workspace)
    out.account_count = accounts.get(workspace.id, 0)
    out.portfolio_count = portfolios.get(workspace.id, 0)
    return out


def _get_owned(db: Session, user: User, workspace_id: uuid.UUID) -> Workspace:
    workspace = db.scalar(select(Workspace).where(Workspace.id == workspace_id, Workspace.user_id == user.id))
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return workspace


def _name_conflict() -> HTTPException:
    return HTTPException(status_code=409, detail="You already have a workspace with that name")


@router.get("", response_model=list[WorkspaceOut])
def list_workspaces(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[WorkspaceOut]:
    # Default first, then oldest first — the switcher shows them in this order.
    workspaces = db.scalars(select(Workspace).where(Workspace.user_id == user.id).order_by(Workspace.is_default.desc(), Workspace.created_at)).all()
    accounts, portfolios = _counts(db, [t.id for t in workspaces])
    return [_out(t, accounts, portfolios) for t in workspaces]


@router.post("", response_model=WorkspaceOut, status_code=status.HTTP_201_CREATED)
def create_workspace(body: WorkspaceCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> WorkspaceOut:
    workspace = Workspace(user_id=user.id, name=body.name.strip(), description=(body.description or "").strip() or None)
    db.add(workspace)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _name_conflict() from None
    db.refresh(workspace)
    return _out(workspace, {}, {})


@router.patch("/{workspace_id}", response_model=WorkspaceOut)
def update_workspace(
    workspace_id: uuid.UUID, body: WorkspaceUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> WorkspaceOut:
    workspace = _get_owned(db, user, workspace_id)
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        workspace.name = data["name"].strip()
    if "description" in data:
        workspace.description = (data["description"] or "").strip() or None
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _name_conflict() from None
    db.refresh(workspace)
    accounts, portfolios = _counts(db, [workspace.id])
    return _out(workspace, accounts, portfolios)


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workspace(workspace_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> None:
    workspace = _get_owned(db, user, workspace_id)
    if workspace.is_default:
        raise HTTPException(status_code=400, detail="The default workspace can't be deleted")
    accounts, portfolios = _counts(db, [workspace.id])
    if accounts.get(workspace.id) or portfolios.get(workspace.id):
        raise HTTPException(
            status_code=409,
            detail="Delete this workspace's accounts and portfolios first — only empty workspaces can be deleted",
        )
    soft_delete.delete_workspace(db, workspace.id)
    db.commit()
