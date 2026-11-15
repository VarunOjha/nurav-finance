import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base, SoftDeleteMixin
from models.mixins import IdMixin, TimestampMixin

ACCOUNT_TYPES = ("checking", "savings", "fixed_deposit", "brokerage", "investment", "retirement", "asset", "other")
# Every portfolio belongs to one account of these types.
PORTFOLIO_ACCOUNT_TYPES = ("brokerage",)

# Money: NUMERIC(20,4) everywhere a balance is stored — never floats.
MONEY = Numeric(20, 4)


class Account(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "accounts"

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    institution: Mapped[str | None] = mapped_column(String(120), nullable=True)
    account_type: Mapped[str] = mapped_column(String(20))
    # Set by Close account (today unless chosen); the account counts up to that day. None = open.
    closed_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    country: Mapped[str | None] = mapped_column(String(2), nullable=True)  # ISO 3166-1 alpha-2
    currency: Mapped[str] = mapped_column(String(3))  # ISO 4217

    links = relationship("AccountLink", order_by="AccountLink.position", back_populates="account")


class AccountLink(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "account_links"

    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"), index=True)
    label: Mapped[str] = mapped_column(String(60))
    url: Mapped[str] = mapped_column(String(2048))
    position: Mapped[int] = mapped_column(Integer, default=0)

    account = relationship("Account", back_populates="links")


class BalanceEntry(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    """Append-only ledger row. Never updated; a mistake is soft-deleted and re-entered.

    `as_of` is the date the balance applies to (may be backdated);
    `created_at` is when it was recorded. All maths uses `as_of`, ties broken
    by `created_at` (the later recording wins).
    """

    __tablename__ = "balance_entries"
    __table_args__ = (Index("ix_balance_entries_account_asof", "account_id", "as_of"),)

    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"), index=True)
    as_of: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(MONEY)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
