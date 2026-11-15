"""Workspaces."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from schemas.common import ORMModel


class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    description: str | None = Field(default=None, max_length=500)


class WorkspaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    description: str | None = Field(default=None, max_length=500)


class WorkspaceOut(ORMModel):
    id: uuid.UUID
    name: str
    description: str | None
    is_default: bool
    created_at: datetime
    account_count: int = 0
    portfolio_count: int = 0
