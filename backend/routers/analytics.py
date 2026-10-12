from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_tenant
from models import Tenant
from schemas.analytics import Overview
from services import analytics

router = APIRouter()


@router.get("/overview", response_model=Overview)
def overview(
    range_key: Literal["6m", "1y", "3y", "all"] = Query("1y", alias="range"),
    tenant: Tenant = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> dict:
    return analytics.overview(db, tenant, range_key)
