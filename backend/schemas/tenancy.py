"""Tenants and tags."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from schemas.common import ORMModel


class TenantCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    description: str | None = Field(default=None, max_length=500)


class TenantUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    description: str | None = Field(default=None, max_length=500)


class TenantOut(ORMModel):
    id: uuid.UUID
    name: str
    description: str | None
    is_default: bool
    created_at: datetime
    account_count: int = 0
    portfolio_count: int = 0


TAG_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=40, pattern=TAG_PATTERN)
    description: str | None = Field(default=None, max_length=500)


class TagUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=40, pattern=TAG_PATTERN)
    description: str | None = Field(default=None, max_length=500)


class TagOut(ORMModel):
    id: uuid.UUID
    name: str
    description: str | None
    account_count: int = 0
    portfolio_count: int = 0


class TagRef(ORMModel):
    id: uuid.UUID
    name: str
