import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, Numeric, String, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from database import Base, SoftDeleteMixin, utcnow
from models.mixins import IdMixin, TimestampMixin


class WealthPlan(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    """A Wealth Agent version the user approved and saved: frozen for good.

    `params` is the signed draft the user approved (parameters plus the
    starting values resolved at the time); `report` is what the engine
    produced from it and the agent's narrative, rendered with real names.
    Only the name can change afterwards.
    """

    __tablename__ = "wealth_plans"
    __table_args__ = (
        Index(
            "uq_wealth_plans_tenant_name_live",
            "tenant_id",
            func.lower(text("name")),
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id"), index=True)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(80))
    mode: Mapped[str] = mapped_column(String(20))
    currency: Mapped[str] = mapped_column(String(3))
    as_of: Mapped[date] = mapped_column(Date)
    horizon_years: Mapped[int] = mapped_column(Integer)
    params: Mapped[dict] = mapped_column(JSONB)
    report: Mapped[dict] = mapped_column(JSONB)
    model: Mapped[str] = mapped_column(String(80))


class AgentUsage(IdMixin, Base):
    """One billed OpenRouter call (chat or transcription), for the cost meter and the daily cap.

    Never soft-deleted or edited: it is a ledger of spend.
    """

    __tablename__ = "agent_usage"

    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    kind: Mapped[str] = mapped_column(String(16))  # "chat" | "transcribe"
    model: Mapped[str] = mapped_column(String(80))
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), default=Decimal("0"))
    generation_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
