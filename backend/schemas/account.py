import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl

from schemas.common import AsOfDate, CountryCode, CurrencyCode, Money, ORMModel
from schemas.tenancy import TagRef

AccountType = Literal["checking", "savings", "fixed_deposit", "brokerage", "retirement", "other"]


class IdentifierIn(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    value: str = Field(min_length=1, max_length=255)


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
    holder_name: str | None = Field(default=None, max_length=120)
    opened_on: date | None = None
    closed_on: date | None = None
    country: CountryCode | None = None
    city: str | None = Field(default=None, max_length=120)
    currency: CurrencyCode
    notes: str | None = Field(default=None, max_length=2000)


class AccountCreate(AccountBase):
    account_number: str | None = Field(default=None, max_length=64)
    identifiers: list[IdentifierIn] = []
    links: list[LinkIn] = []
    tag_ids: list[uuid.UUID] = []
    opening_balance: OpeningBalance | None = None


class AccountUpdate(BaseModel):
    """Partial update. Lists (identifiers, links, tag_ids) replace when sent.

    account_number: omit to keep, "" to clear, a value to replace.
    """

    name: str | None = Field(default=None, min_length=1, max_length=120)
    institution: str | None = Field(default=None, max_length=120)
    account_type: AccountType | None = None
    holder_name: str | None = Field(default=None, max_length=120)
    opened_on: date | None = None
    closed_on: date | None = None
    country: CountryCode | None = None
    city: str | None = Field(default=None, max_length=120)
    currency: CurrencyCode | None = None
    notes: str | None = Field(default=None, max_length=2000)
    account_number: str | None = Field(default=None, max_length=64)
    identifiers: list[IdentifierIn] | None = None
    links: list[LinkIn] | None = None
    tag_ids: list[uuid.UUID] | None = None


class IdentifierOut(ORMModel):
    id: uuid.UUID
    label: str
    value: str


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
    account_number_masked: str | None
    country: str | None
    city: str | None
    currency: str
    opened_on: date | None
    closed_on: date | None
    status: Literal["active", "closed"]
    tags: list[TagRef]
    balance: Decimal | None
    balance_as_of: date | None
    previous_balance: Decimal | None
    delta: Decimal | None
    updated_at: datetime


class AccountDetail(AccountSummary):
    holder_name: str | None
    notes: str | None
    has_account_number: bool
    identifiers: list[IdentifierOut]
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


class RevealedNumber(BaseModel):
    account_number: str
