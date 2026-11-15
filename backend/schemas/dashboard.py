"""GET /api/dashboard — see services/dashboard.py."""

import uuid
from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel


class BucketRef(BaseModel):
    id: uuid.UUID
    name: str
    color: int


class YearValue(BaseModel):
    year: int
    value: Decimal
    as_of: date


class TopEntry(BaseModel):
    kind: Literal["account", "holding"]
    name: str
    symbol: str | None
    held_in: list[str]
    value: Decimal
    share: Decimal
    bucket_ids: list[uuid.UUID | None]  # None = Unassigned


class TopStock(BaseModel):
    symbol: str
    name: str | None
    held_in: list[str]
    value: Decimal
    cost: Decimal | None
    gain_pct: Decimal | None
    share: Decimal  # of this currency's stocks


class GridRow(BaseModel):
    account_id: uuid.UUID
    name: str
    cells: list[Decimal | None]  # one per grid bucket column
    total: Decimal


class Grid(BaseModel):
    buckets: list[BucketRef | None]  # None = Unassigned
    rows: list[GridRow]
    totals: list[Decimal]


class CurrencyDashboard(BaseModel):
    currency: str
    net_worth: Decimal
    account_count: int
    yearly: list[YearValue]
    top_entries: list[TopEntry]
    top_stocks: list[TopStock]
    grid: Grid


class Alert(BaseModel):
    kind: Literal["rebalance", "intent", "concentration"]
    currency: str
    bucket: BucketRef | None
    amount: Decimal | None = None  # rebalance: surplus
    other_bucket: BucketRef | None = None  # rebalance: the bucket furthest behind
    other_amount: Decimal | None = None  # rebalance: its gap
    expected_return: Decimal | None = None  # intent
    label: Literal["fixed_deposits", "cash", "deposits_and_cash"] | None = None  # intent
    symbol: str | None = None  # concentration
    share: Decimal | None = None  # intent: low-yield share; concentration: holding's share


class CheckinItem(BaseModel):
    kind: Literal["balance", "holdings"]
    id: uuid.UUID
    account_id: uuid.UUID | None
    name: str
    currency: str
    last: date | None


class Checkin(BaseModel):
    last: date | None
    items: list[CheckinItem]  # oldest first


class NextMilestone(BaseModel):
    id: uuid.UUID
    name: str
    target_date: date


class Dashboard(BaseModel):
    today: date
    next_milestone: NextMilestone | None
    currencies: list[CurrencyDashboard]
    attention: list[Alert]
    checkin: Checkin
