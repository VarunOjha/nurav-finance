"""Spend ledger and the daily cap (per tenant, UTC day)."""

import uuid
from datetime import UTC, datetime, time
from decimal import Decimal

from sqlalchemy import func, select

from config import settings
from database import SessionLocal
from models import AgentUsage


def _day_start() -> datetime:
    return datetime.combine(datetime.now(UTC).date(), time.min, tzinfo=UTC)


def spent_today(tenant_id: uuid.UUID) -> float:
    with SessionLocal() as db:
        total = db.scalar(
            select(func.coalesce(func.sum(AgentUsage.cost_usd), 0)).where(AgentUsage.tenant_id == tenant_id, AgentUsage.at >= _day_start())
        )
    return float(total or 0)


def over_cap(tenant_id: uuid.UUID) -> bool:
    return spent_today(tenant_id) >= settings.agent_daily_cap_usd


def record(tenant_id: uuid.UUID, user_id: uuid.UUID, kind: str, model: str, usage: dict | None, generation_id: str | None = None) -> float:
    """Store one call; returns its cost in USD (0 when OpenRouter didn't report one)."""
    usage = usage or {}
    cost = Decimal(str(usage.get("cost") or 0))
    # A fresh session: this runs inside streaming responses, after the request's session is gone.
    with SessionLocal() as db:
        db.add(
            AgentUsage(
                tenant_id=tenant_id,
                user_id=user_id,
                kind=kind,
                model=model[:80],
                prompt_tokens=int(usage.get("prompt_tokens") or 0),
                completion_tokens=int(usage.get("completion_tokens") or 0),
                cost_usd=cost,
                generation_id=(generation_id or "")[:80] or None,
            )
        )
        db.commit()
    return float(cost)


CAP_MESSAGE = "Today’s Wealth Agent limit (${cap:.2f}) is reached for this tenant. It resets at midnight UTC."


def cap_message() -> str:
    return CAP_MESSAGE.format(cap=settings.agent_daily_cap_usd)
