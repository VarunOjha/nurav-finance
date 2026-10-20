import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from schemas.common import AsOfDate, CurrencyCode, ORMModel
from schemas.tenancy import TagRef

AssetClass = Literal["stock", "etf", "mutual_fund", "bond", "cash", "crypto", "other"]


class PortfolioCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    provider: str | None = Field(default=None, max_length=120)
    currency: CurrencyCode
    account_id: uuid.UUID | None = None
    opened_on: date | None = None
    closed_on: date | None = None
    notes: str | None = Field(default=None, max_length=2000)
    tag_ids: list[uuid.UUID] = []


class PortfolioUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    provider: str | None = Field(default=None, max_length=120)
    currency: CurrencyCode | None = None
    account_id: uuid.UUID | None = None
    opened_on: date | None = None
    closed_on: date | None = None
    notes: str | None = Field(default=None, max_length=2000)
    tag_ids: list[uuid.UUID] | None = None


class AccountRef(ORMModel):
    id: uuid.UUID
    name: str


class PortfolioSummary(BaseModel):
    id: uuid.UUID
    name: str
    provider: str | None
    currency: str
    account: AccountRef | None
    opened_on: date | None
    closed_on: date | None
    status: Literal["active", "closed"]
    notes: str | None
    tags: list[TagRef]
    value: Decimal | None
    value_as_of: date | None
    previous_value: Decimal | None
    delta: Decimal | None
    holdings_count: int
    snapshot_count: int


class HoldingIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=24)
    name: str | None = Field(default=None, max_length=160)
    asset_class: AssetClass = "stock"
    quantity: Decimal = Field(gt=0, max_digits=24, decimal_places=8)
    buy_price: Decimal | None = Field(default=None, ge=0, max_digits=20, decimal_places=6)
    current_price: Decimal = Field(ge=0, max_digits=20, decimal_places=6)


class SnapshotCreate(BaseModel):
    as_of: AsOfDate
    note: str | None = Field(default=None, max_length=500)
    holdings: list[HoldingIn] = Field(min_length=1)


class HoldingOut(BaseModel):
    symbol: str
    name: str | None
    asset_class: str
    quantity: Decimal
    buy_price: Decimal | None
    current_price: Decimal
    value: Decimal
    cost: Decimal | None  # quantity × buy_price; None without a buy price
    gain: Decimal | None  # value − cost


class SnapshotSummary(BaseModel):
    id: uuid.UUID
    as_of: date
    note: str | None
    recorded_at: datetime
    total: Decimal
    holdings_count: int
    cost: Decimal | None  # Σ quantity × buy_price over holdings with a buy price; None if none have one
    cost_holdings: int  # how many holdings have a buy price


class HoldingDiff(BaseModel):
    symbol: str
    name: str | None
    asset_class: str
    status: Literal["new", "sold", "changed", "unchanged"]
    quantity: Decimal | None
    previous_quantity: Decimal | None
    quantity_change: Decimal | None
    buy_price: Decimal | None
    current_price: Decimal | None
    value: Decimal
    cost: Decimal | None
    gain: Decimal | None  # unrealised, current holdings with a buy price only
    previous_value: Decimal
    value_change: Decimal
    weight: Decimal  # share of the newer snapshot's total, 0..1


class AllocationSlice(BaseModel):
    label: str
    value: Decimal
    share: Decimal


class SnapshotComparison(BaseModel):
    current: SnapshotSummary
    previous: SnapshotSummary | None
    change: Decimal | None
    change_pct: Decimal | None
    holdings: list[HoldingDiff]
    allocation: list[AllocationSlice]  # by asset class, newer snapshot


class SnapshotPrefill(BaseModel):
    based_on: SnapshotSummary | None
    holdings: list[HoldingOut]


class ConsolidatedHolding(BaseModel):
    symbol: str
    name: str | None
    asset_class: str
    quantity: Decimal
    value: Decimal
    share: Decimal
    portfolios: list[str]


class PortfolioSeries(BaseModel):
    portfolio: str
    values: list[Decimal | None]  # one per CurrencyConsolidation.months; None before the first snapshot


class CurrencyConsolidation(BaseModel):
    currency: str
    total: Decimal
    previous_total: Decimal | None
    by_portfolio: list[AllocationSlice]
    by_asset_class: list[AllocationSlice]
    holdings: list[ConsolidatedHolding]
    months: list[str]  # "YYYY-MM", last 12 months; the current month is as of today
    history: list[PortfolioSeries]  # month-end value per portfolio, sorted by name


class Consolidated(BaseModel):
    currencies: list[CurrencyConsolidation]
