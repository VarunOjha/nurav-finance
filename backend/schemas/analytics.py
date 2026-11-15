import uuid
from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

from schemas.portfolio import AllocationSlice

Series = list[Decimal | None]  # one value per entry in Overview.months


class CurrencySeries(BaseModel):
    currency: str
    accounts: Series
    portfolios: Series
    total: Series
    current_total: Decimal | None
    current_accounts: Decimal | None
    current_portfolios: Decimal | None
    last_month_total: Decimal | None
    year_ago_total: Decimal | None
    account_count: int
    portfolio_count: int


class BucketInfo(BaseModel):
    id: uuid.UUID
    name: str
    color: int
    archived: bool


class BucketSource(BaseModel):
    account_id: uuid.UUID
    name: str
    percent: Decimal
    value: Decimal


class BucketRow(BaseModel):
    bucket_id: uuid.UUID | None  # None = Unassigned
    values: Series
    current: Decimal | None
    share: Decimal  # of the currency's total today
    change_1m: Decimal | None
    pace_3m: Decimal | None  # average change per month
    pace_6m: Decimal | None
    pace_12m: Decimal | None
    growth_pct: Decimal | None  # first value in range -> today
    sources: list[BucketSource]


class CurrencyBuckets(BaseModel):
    currency: str
    rows: list[BucketRow]


class BucketOverview(BaseModel):
    buckets: list[BucketInfo]  # every bucket of the user, for names/colours
    currencies: list[CurrencyBuckets]


class CurrencyAllocation(BaseModel):
    currency: str
    slices: list[AllocationSlice]


class Allocation(BaseModel):
    by_type: list[CurrencyAllocation]
    by_asset_class: list[CurrencyAllocation]


class TopAsset(BaseModel):
    kind: Literal["account", "holding"]
    name: str
    symbol: str | None  # holdings only
    group: str  # account type, or the holding's asset class
    held_in: list[str]  # portfolios holding this symbol; empty for accounts
    value: Decimal


class CurrencyTopAssets(BaseModel):
    currency: str
    assets: list[TopAsset]  # every positive asset, largest first


class TimelineEvent(BaseModel):
    date: date
    kind: Literal["account_opened", "account_closed", "portfolio_opened", "portfolio_closed"]
    name: str
    currency: str


class Overview(BaseModel):
    months: list[str]
    currencies: list[CurrencySeries]
    buckets: BucketOverview
    allocation: Allocation
    top_assets: list[CurrencyTopAssets]
    timeline: list[TimelineEvent]
