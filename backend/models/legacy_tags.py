"""Retired tag tables, replaced by buckets on 2026-11-07 (migration 0002).

Nothing in the app reads or writes these any more. The tables and their rows
are kept untouched in the database (no data is deleted); the models stay only
so the ORM metadata matches the schema. Drop them in a later migration once
it's certain nothing is needed from them.
"""

import uuid

from sqlalchemy import ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base, SoftDeleteMixin
from models.mixins import IdMixin, TimestampMixin


class Tag(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "tags"
    __table_args__ = (Index("uq_tags_user_name_live", "user_id", "name", unique=True, postgresql_where=text("deleted_at IS NULL")),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(40))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)


class AccountTag(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "account_tags"
    __table_args__ = (Index("uq_account_tags_live", "account_id", "tag_id", unique=True, postgresql_where=text("deleted_at IS NULL")),)

    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"), index=True)
    tag_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tags.id"), index=True)


class PortfolioTag(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "portfolio_tags"
    __table_args__ = (Index("uq_portfolio_tags_live", "portfolio_id", "tag_id", unique=True, postgresql_where=text("deleted_at IS NULL")),)

    portfolio_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("portfolios.id"), index=True)
    tag_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tags.id"), index=True)
