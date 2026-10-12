import uuid

from sqlalchemy import Boolean, ForeignKey, Index, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base, SoftDeleteMixin
from models.mixins import IdMixin, TimestampMixin

DEFAULT_TENANT_NAME = "DEFAULT_SELF"


class Tenant(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    """A financial entity whose journey is tracked (you, parents, a household).

    Every account and portfolio belongs to exactly one tenant. DEFAULT_SELF is
    created at registration and can never be deleted.
    """

    __tablename__ = "tenants"
    __table_args__ = (
        Index(
            "uq_tenants_user_name_live",
            "user_id",
            func.lower(text("name")),
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "uq_tenants_user_default_live",
            "user_id",
            unique=True,
            postgresql_where=text("is_default AND deleted_at IS NULL"),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    user = relationship("User", back_populates="tenants")
