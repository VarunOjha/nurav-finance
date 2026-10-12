import uuid

from sqlalchemy import ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base, SoftDeleteMixin
from models.mixins import IdMixin, TimestampMixin

# Seeded at registration and by "Seed defaults" (only missing ones are added).
DEFAULT_TAGS: tuple[tuple[str, str], ...] = (
    ("emergency-fund", "Cash I can reach within a week"),
    ("trading", "Brokerage cash and equity portfolios"),
    ("fixed-income", "FDs, bonds, bond funds"),
    ("savings", "Everyday savings accounts"),
    ("retirement", "401k, IRA, PPF"),
    ("salary", "Where pay lands"),
)


class Tag(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    """User-level label, shared by all of the user's tenants."""

    __tablename__ = "tags"
    __table_args__ = (Index("uq_tags_user_name_live", "user_id", "name", unique=True, postgresql_where=text("deleted_at IS NULL")),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(40))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
