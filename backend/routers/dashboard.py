"""The dashboard (per workspace)."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_workspace
from models import Workspace
from schemas.dashboard import Dashboard
from services import dashboard as dashboard_service

router = APIRouter()


@router.get("", response_model=Dashboard)
def get_dashboard(workspace: Workspace = Depends(get_current_workspace), db: Session = Depends(get_db)) -> dict:
    return dashboard_service.dashboard(db, workspace)
