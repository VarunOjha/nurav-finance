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


class TagCurrencySeries(BaseModel):
    currency: str
    values: Series


class TagTrend(BaseModel):
    tag: str
    currencies: list[TagCurrencySeries]


class CurrencyAllocation(BaseModel):
    currency: str
    slices: list[AllocationSlice]


class Allocation(BaseModel):
    by_type: list[CurrencyAllocation]
    by_asset_class: list[CurrencyAllocation]
    by_tag: list[CurrencyAllocation]


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
    tags: list[TagTrend]
    allocation: Allocation
    top_assets: list[CurrencyTopAssets]
    timeline: list[TimelineEvent]
