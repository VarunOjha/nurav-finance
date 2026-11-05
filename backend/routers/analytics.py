from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_workspace
from models import Workspace
from schemas.analytics import Overview
from services import analytics

router = APIRouter()


@router.get("/overview", response_model=Overview)
def overview(
    range_key: Literal["6m", "1y", "3y", "all"] = Query("1y", alias="range"),
    workspace: Workspace = Depends(get_current_workspace),
    db: Session = Depends(get_db),
) -> dict:
    return analytics.overview(db, workspace, range_key)
