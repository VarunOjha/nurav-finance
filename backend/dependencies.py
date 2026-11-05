"""Request-scoped auth and workspace resolution.

Every workspace-scoped endpoint depends on `get_current_workspace`, which reads the
`X-Workspace-Id` header and verifies the workspace belongs to the signed-in user.
Data access below that point always filters by the resolved workspace's id, so
one workspace's rows can never leak into another's responses.
"""

import uuid

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from models import User, Workspace
from services.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    payload = decode_access_token(token)
    if not payload or not payload.get("sub"):
        raise unauthorized
    try:
        user_id = uuid.UUID(payload["sub"])
    except ValueError:
        raise unauthorized from None
    user = db.get(User, user_id)
    if user is None or user.is_deleted:
        raise unauthorized
    return user


def get_current_workspace(
    x_workspace_id: uuid.UUID = Header(..., description="Selected workspace (from the header switcher)"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Workspace:
    workspace = db.scalar(select(Workspace).where(Workspace.id == x_workspace_id, Workspace.user_id == user.id))
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return workspace
