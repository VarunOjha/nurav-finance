import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Index, Numeric, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base, SoftDeleteMixin
from models.mixins import IdMixin, TimestampMixin

ASSET_CLASSES = ("stock", "etf", "mutual_fund", "bond", "cash", "crypto", "other")


class Portfolio(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    """What a brokerage account holds, as dated snapshots. One live portfolio per account."""

    __tablename__ = "portfolios"
    __table_args__ = (Index("uq_portfolios_account_live", "account_id", unique=True, postgresql_where=text("deleted_at IS NULL")),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    provider: Mapped[str | None] = mapped_column(String(120), nullable=True)
    currency: Mapped[str] = mapped_column(String(3))
    # The brokerage account it belongs to (same workspace); at most one live portfolio each.
    account_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    closed_on: Mapped[date | None] = mapped_column(Date, nullable=True)

    account = relationship("Account")


class Snapshot(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    """Immutable holdings snapshot. At most one live snapshot per portfolio per date.

    `as_of` may be backdated; comparisons always use the previous snapshot by
    `as_of`, never by recording order.
    """

    __tablename__ = "snapshots"
    __table_args__ = (Index("uq_snapshots_portfolio_asof_live", "portfolio_id", "as_of", unique=True, postgresql_where=text("deleted_at IS NULL")),)

    portfolio_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("portfolios.id"), index=True)
    as_of: Mapped[date] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    holdings = relationship("Holding", order_by="Holding.symbol", back_populates="snapshot")


class Holding(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "holdings"

    snapshot_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("snapshots.id"), index=True)
    symbol: Mapped[str] = mapped_column(String(24))
    name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    asset_class: Mapped[str] = mapped_column(String(20))
    quantity: Mapped[Decimal] = mapped_column(Numeric(24, 8))
    # Per unit, in the portfolio's currency. buy_price (average cost) is optional:
    # snapshots recorded before it existed, or where the cost isn't known.
    buy_price: Mapped[Decimal | None] = mapped_column(Numeric(20, 6), nullable=True)
    current_price: Mapped[Decimal] = mapped_column(Numeric(20, 6))

    snapshot = relationship("Snapshot", back_populates="holdings")

    @property
    def value(self) -> Decimal:
        return self.quantity * self.current_price
