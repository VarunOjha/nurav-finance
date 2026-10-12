"""Request-scoped auth and tenant resolution.

Every tenant-scoped endpoint depends on `get_current_tenant`, which reads the
`X-Tenant-Id` header and verifies the tenant belongs to the signed-in user.
Data access below that point always filters by the resolved tenant's id, so
one tenant's rows can never leak into another's responses.
"""

import uuid

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from models import Tenant, User
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


def get_current_tenant(
    x_tenant_id: uuid.UUID = Header(..., description="Selected tenant (from the header switcher)"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Tenant:
    tenant = db.scalar(select(Tenant).where(Tenant.id == x_tenant_id, Tenant.user_id == user.id))
    if tenant is None:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return tenant
