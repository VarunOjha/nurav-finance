import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from schemas.common import CurrencyCode


class PoolAccount(BaseModel):
    id: uuid.UUID
    name: str
    institution: str | None
    account_type: str
    currency: str
    value: Decimal
    fixed: bool  # a fixed asset (account type "asset"): kept, never in the pool


class Pool(BaseModel):
    accounts: list[PoolAccount]
    currencies: list[str]  # most money first


class InquiryCreate(BaseModel):
    monthly_expenses: Decimal = Field(gt=0, max_digits=20, decimal_places=4)
    currency: CurrencyCode
    withdrawal_rate_pct: Decimal = Field(default=Decimal("3.5"), ge=1, le=10, max_digits=5, decimal_places=2)
    excluded_account_ids: list[uuid.UUID] = []


class FiYears(BaseModel):
    conservative: int | None
    balanced: int | None
    aggressive: int | None


class InquirySummary(BaseModel):
    id: uuid.UUID
    created_at: datetime
    monthly_expenses: Decimal
    currency: str
    withdrawal_rate_pct: float
    pool: float
    fi_years: FiYears
    fi_today: float  # balanced
    progress: float  # balanced
    fi_age: int | None  # balanced
    structure: int
    model: str
    changes: list[str]  # titles, for "advice over time"
    targets: dict[str, float]  # balanced rebalance target per class key
    labels: dict[str, str]  # class key → label


class InquiryDetail(BaseModel):
    id: uuid.UUID
    created_at: datetime
    monthly_expenses: Decimal
    currency: str
    model: str
    cost: Decimal
    result: dict
    previous: InquirySummary | None
