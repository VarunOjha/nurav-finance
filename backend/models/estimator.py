"""Wealth estimator inquiries: one saved AI review of a workspace's money.

An inquiry is immutable once made: the inputs, the figures sent to the model,
the model's answer and the numbers code computed from it are all kept as
they were, so later inquiries can be compared with earlier ones. Deleting
one is a soft delete like everything else.
"""

import uuid
from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from database import Base, SoftDeleteMixin
from models.account import MONEY
from models.mixins import IdMixin, TimestampMixin


class WealthInquiry(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "wealth_inquiries"

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), index=True)
    monthly_expenses: Mapped[Decimal] = mapped_column(MONEY)
    currency: Mapped[str] = mapped_column(String(3))  # the expenses' currency; every combined figure is in it
    excluded_account_ids: Mapped[list] = mapped_column(JSONB, default=list)  # unticked by the person (fixed assets aren't listed)
    snapshot: Mapped[dict] = mapped_column(JSONB)  # what the model was shown
    answer: Mapped[dict] = mapped_column(JSONB)  # what the model returned (after the checks passed)
    result: Mapped[dict] = mapped_column(JSONB)  # what code computed from it
    model: Mapped[str] = mapped_column(String(120))
    cost: Mapped[Decimal] = mapped_column(Numeric(12, 6), default=Decimal("0"))
