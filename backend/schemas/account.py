import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl

from schemas.buckets import BucketShare
from schemas.common import AsOfDate, CountryCode, CurrencyCode, Money, ORMModel

# "asset": something you own outright, valued by hand (a house, a car, gold…).
AccountType = Literal["checking", "savings", "fixed_deposit", "brokerage", "investment", "retirement", "asset", "other"]


class LinkIn(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    url: HttpUrl


class OpeningBalance(BaseModel):
    amount: Money
    as_of: AsOfDate
    note: str | None = Field(default=None, max_length=500)


class AccountBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    institution: str | None = Field(default=None, max_length=120)
    account_type: AccountType
    closed_on: date | None = None
    country: CountryCode | None = None
    currency: CurrencyCode


class AccountCreate(AccountBase):
    links: list[LinkIn] = []
    opening_balance: OpeningBalance | None = None


class AccountUpdate(BaseModel):
    """Partial update. `links` replaces when sent; `closed_on` closes (a date) or reopens (null)."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    institution: str | None = Field(default=None, max_length=120)
    account_type: AccountType | None = None
    closed_on: date | None = None
    country: CountryCode | None = None
    currency: CurrencyCode | None = None
    links: list[LinkIn] | None = None


class LinkOut(ORMModel):
    id: uuid.UUID
    label: str
    url: str


class PortfolioRef(ORMModel):
    id: uuid.UUID
    name: str


class AccountSummary(BaseModel):
    id: uuid.UUID
    name: str
    institution: str | None
    account_type: str
    country: str | None
    currency: str
    closed_on: date | None
    status: Literal["active", "closed"]
    buckets: list[BucketShare]  # split in force today; [] = Unassigned
    balance: Decimal | None
    balance_as_of: date | None
    previous_balance: Decimal | None
    delta: Decimal | None
    updated_at: datetime


class AccountDetail(AccountSummary):
    links: list[LinkOut]
    portfolios: list[PortfolioRef]
    created_at: datetime


class BalanceCreate(BaseModel):
    amount: Money
    as_of: AsOfDate
    note: str | None = Field(default=None, max_length=500)


class BalanceEntryOut(BaseModel):
    id: uuid.UUID
    as_of: date
    amount: Decimal
    note: str | None
    recorded_at: datetime
    # False when a later recording for the same as_of date supersedes it.
    effective: bool
    # Change vs. the effective balance before this entry's date.
    change: Decimal | None


class MonthPoint(BaseModel):
    month: str  # YYYY-MM
    balance: Decimal | None


class BalanceHistory(BaseModel):
    entries: list[BalanceEntryOut]
    monthly: list[MonthPoint]
