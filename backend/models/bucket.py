"""Buckets: where the money is meant for (Growth, Emergency fund, a car…).

Bucket definitions belong to the USER and are shared by every workspace.
Everything that says how much money sits in a bucket is per workspace:
an account (workspace-scoped) carries a percentage split across buckets, and
milestones (each with bucket targets) are set per workspace.

Splits are effective-dated and append-only (a change adds a new version):
- the split in force on day D is the one with the latest `effective_from` <= D;
- an account's FIRST split (`effective_from` NULL) covers all of its history.
  If that one is deleted, the earliest remaining split extends backwards.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base, SoftDeleteMixin
from models.account import MONEY
from models.mixins import IdMixin, TimestampMixin

# Created for every new user and by "Seed defaults" (missing names only).
DEFAULT_BUCKETS: tuple[tuple[str, str], ...] = (
    ("Growth", "Long-term money left to compound"),
    ("Emergency fund", "Months of expenses I can reach within a week"),
    ("Extra cash", "Spare cash for near-term spending"),
)

# Colours are chart palette slots (0-7), so they follow light/dark themes.
COLOR_SLOTS = 8

PERCENT = Numeric(7, 4)


class Bucket(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "buckets"
    __table_args__ = (Index("uq_buckets_user_name_live", "user_id", text("lower(name)"), unique=True, postgresql_where=text("deleted_at IS NULL")),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    color: Mapped[int] = mapped_column(Integer, default=0)
    position: Mapped[int] = mapped_column(Integer, default=0)
    # Archived: hidden from new splits and targets; past timelines still show it.
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AccountSplit(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    """One version of an account's bucket split. Never edited; replaced by a newer one."""

    __tablename__ = "account_splits"
    __table_args__ = (
        Index("uq_account_splits_date_live", "account_id", "effective_from", unique=True, postgresql_where=text("deleted_at IS NULL")),
        Index("uq_account_splits_first_live", "account_id", unique=True, postgresql_where=text("deleted_at IS NULL AND effective_from IS NULL")),
    )

    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"), index=True)
    effective_from: Mapped[date | None] = mapped_column(Date, nullable=True)  # NULL = the first split, covers all history
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    lines = relationship("AccountSplitLine", back_populates="split", order_by="AccountSplitLine.position")


class AccountSplitLine(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "account_split_lines"

    split_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("account_splits.id"), index=True)
    bucket_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("buckets.id"), index=True)
    percent: Mapped[Decimal] = mapped_column(PERCENT)
    position: Mapped[int] = mapped_column(Integer, default=0)

    split = relationship("AccountSplit", back_populates="lines")
    bucket = relationship("Bucket")


class Milestone(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    """A named checkpoint ("2030") in one workspace: one date, several bucket targets."""

    __tablename__ = "milestones"
    __table_args__ = (
        Index("uq_milestones_workspace_name_live", "workspace_id", text("lower(name)"), unique=True, postgresql_where=text("deleted_at IS NULL")),
        Index("uq_milestones_workspace_date_live", "workspace_id", "target_date", unique=True, postgresql_where=text("deleted_at IS NULL")),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    target_date: Mapped[date] = mapped_column(Date)
    # Where every bucket's "needed path" starts: its value on this day.
    start_date: Mapped[date] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    targets = relationship("BucketTarget", back_populates="milestone", order_by="BucketTarget.position")


class BucketTarget(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    """One line of a milestone: the balance one bucket should hold, in one currency.

    `legacy_target_date` / `legacy_start_date` are the pre-milestone columns
    (migration 0003). They are kept in step with the milestone's dates so a
    downgrade restores standalone targets; nothing reads them.
    """

    __tablename__ = "bucket_targets"
    __table_args__ = (
        Index("uq_bucket_targets_line_live", "milestone_id", "bucket_id", "currency", unique=True, postgresql_where=text("deleted_at IS NULL")),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), index=True)
    # Always set by the app; nullable only so migration 0003 could move old targets in (and back out).
    milestone_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("milestones.id"), index=True, nullable=True)
    bucket_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("buckets.id"), index=True)
    currency: Mapped[str] = mapped_column(String(3))
    amount: Mapped[Decimal] = mapped_column(MONEY)  # the balance to reach
    # Optional expected annual return, in percent (7 = 7%/yr).
    expected_return: Mapped[Decimal | None] = mapped_column(Numeric(6, 3), nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)  # unused since 0003 (the milestone has the note)
    legacy_target_date: Mapped[date | None] = mapped_column("target_date", Date, nullable=True)
    legacy_start_date: Mapped[date | None] = mapped_column("start_date", Date, nullable=True)

    bucket = relationship("Bucket")
    milestone = relationship("Milestone", back_populates="targets")
