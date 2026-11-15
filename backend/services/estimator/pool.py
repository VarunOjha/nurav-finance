"""The pool an inquiry works with, and the snapshot of it the model is shown.

One row per open account with money today. A brokerage account with an open
portfolio counts through its holdings (as everywhere else). Accounts of type
`asset` (a house, a car) are fixed assets: kept, never part of the pool. The
person can untick any other account.

The pool is split into classes per currency ("USD stocks", "INR deposits"…),
the units the rebalance targets are given in. A single stock that is 10% or
more of its currency's pool gets a class of its own, so the advice can say
"MSFT 31% → 10%" instead of hiding it in "stocks".
"""

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Account, Bucket, BucketTarget, Milestone, User, Workspace
from services.analytics import Item, load_items, user_buckets
from services.holdings import ZERO, holding_value, q

FIXED_TYPES = {"asset"}
SINGLE_STOCK_SHARE = Decimal("0.10")
TOP_POSITIONS = 10

# Where an account balance (without a portfolio) sits.
ACCOUNT_CLASS = {
    "checking": "cash",
    "savings": "cash",
    "brokerage": "cash",  # uninvested cash at a broker
    "fixed_deposit": "deposits",
    "investment": "invested",  # a balance invested in something we don't see
    "retirement": "invested",
    "other": "other",
}
HOLDING_CLASS = {
    "stock": "stocks",
    "etf": "funds",
    "mutual_fund": "funds",
    "bond": "bonds",
    "cash": "cash",
    "crypto": "crypto",
    "other": "other",
}
CLASS_LABEL = {
    "stocks": "stocks",
    "funds": "funds",
    "bonds": "bonds",
    "cash": "cash",
    "deposits": "deposits",
    "invested": "investment accounts",
    "crypto": "crypto",
    "other": "other",
}
# Classes a target may add in any pool currency even when nothing is in them yet.
TARGET_CLASSES = ("stocks", "funds", "bonds", "cash", "deposits")


@dataclass
class PoolAccount:
    id: uuid.UUID
    name: str
    institution: str | None
    account_type: str
    currency: str
    country: str | None
    value: Decimal
    fixed: bool
    buckets: list[tuple[str, Decimal]]
    # (class, symbol or None, name, asset class, value) — what the money is in.
    parts: list[tuple[str, str | None, str | None, str, Decimal]] = field(default_factory=list)


def _open(i: Item, today: date) -> bool:
    return i.closed_on is None or i.closed_on > today


def pool_accounts(db: Session, workspace: Workspace, today: date) -> list[PoolAccount]:
    items = load_items(db, workspace)
    buckets = user_buckets(db, workspace.user_id)
    accounts = {a.id: a for a in db.scalars(select(Account).where(Account.workspace_id == workspace.id))}
    portfolios: dict[uuid.UUID, list[Item]] = defaultdict(list)
    for i in items:
        if i.kind == "portfolio" and _open(i, today) and i.account_id is not None:
            portfolios[i.account_id].append(i)

    out: list[PoolAccount] = []
    for i in items:
        if i.kind != "account" or not _open(i, today):
            continue
        a = accounts[i.id]
        parts: list[tuple[str, str | None, str | None, str, Decimal]] = []
        if i.linked_on(today):
            for p in portfolios.get(i.id, []):
                point = p.timeline.at(today)
                for h in point.ref.holdings if point is not None else []:
                    value = holding_value(h)
                    if value > 0:
                        parts.append((HOLDING_CLASS.get(h.asset_class, "other"), h.symbol.strip().upper(), h.name, h.asset_class, value))
        else:
            value = i.value(today)
            if value is not None and value > 0:
                parts.append((ACCOUNT_CLASS.get(a.account_type, "other"), None, None, a.account_type, value))
        total = sum((p[4] for p in parts), ZERO)
        if total <= 0:
            continue
        split = i.splits.at(today)
        lines = [(buckets[b].name if b in buckets else "Unassigned", pct) for b, pct in split.lines] if split else []
        out.append(
            PoolAccount(
                id=a.id,
                name=a.name,
                institution=a.institution,
                account_type=a.account_type,
                currency=a.currency,
                country=a.country,
                value=q(total),
                fixed=a.account_type in FIXED_TYPES,
                buckets=lines,
                parts=parts,
            )
        )
    out.sort(key=lambda r: (r.currency, r.fixed, -r.value, r.name.lower()))
    return out


def included(rows: list[PoolAccount], excluded_ids: set[uuid.UUID]) -> list[PoolAccount]:
    return [r for r in rows if not r.fixed and r.id not in excluded_ids]


def class_key(currency: str, cls: str, symbol: str | None = None) -> str:
    return f"{currency}:stock:{symbol}" if symbol else f"{currency}:{cls}"


def class_label(key: str) -> str:
    parts = key.split(":")
    if parts[1] == "stock":
        return parts[2]
    return f"{parts[0]} {CLASS_LABEL.get(parts[1], parts[1])}"


def mix(rows: list[PoolAccount]) -> dict[str, Decimal]:
    """{class key: value in its own currency}, single stocks carved out of "stocks"."""
    totals: dict[str, Decimal] = defaultdict(lambda: ZERO)
    stocks: dict[tuple[str, str], Decimal] = defaultdict(lambda: ZERO)
    by_currency: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for r in rows:
        by_currency[r.currency] += r.value
        for cls, symbol, _, _, value in r.parts:
            if cls == "stocks" and symbol:
                stocks[(r.currency, symbol)] += value
            else:
                totals[class_key(r.currency, cls)] += value
    for (currency, symbol), value in stocks.items():
        if by_currency[currency] > 0 and value / by_currency[currency] >= SINGLE_STOCK_SHARE:
            totals[class_key(currency, "stock", symbol)] += value
        else:
            totals[class_key(currency, "stocks")] += value
    return {k: q(v) for k, v in sorted(totals.items(), key=lambda kv: (kv[0].split(":")[0], -kv[1]))}


def target_keys(rows: list[PoolAccount], current: dict[str, Decimal]) -> list[str]:
    """Every class a rebalance target may name: what exists now plus the standard classes per currency."""
    keys = list(current)
    for currency in sorted({r.currency for r in rows}):
        for cls in TARGET_CLASSES:
            k = class_key(currency, cls)
            if k not in keys:
                keys.append(k)
    return keys


def _age(dob: date | None, today: date) -> int | None:
    if dob is None:
        return None
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def _milestones(db: Session, workspace: Workspace, buckets: dict[uuid.UUID, Bucket], today: date) -> list[dict]:
    out = []
    for m in db.scalars(
        select(Milestone).where(Milestone.workspace_id == workspace.id, Milestone.target_date >= today).order_by(Milestone.target_date)
    ):
        targets = db.scalars(select(BucketTarget).where(BucketTarget.milestone_id == m.id).order_by(BucketTarget.position))
        out.append(
            {
                "name": m.name,
                "date": m.target_date.isoformat(),
                "targets": [
                    {
                        "bucket": buckets[t.bucket_id].name if t.bucket_id in buckets else "?",
                        "currency": t.currency,
                        "amount": str(q(t.amount)),
                        "expected_return_pct": str(t.expected_return) if t.expected_return is not None else None,
                    }
                    for t in targets
                ],
            }
        )
    return out


def snapshot(
    db: Session,
    workspace: Workspace,
    user: User,
    rows: list[PoolAccount],
    excluded_ids: set[uuid.UUID],
    monthly_expenses: Decimal,
    currency: str,
    withdrawal_rate_pct: Decimal,
    today: date,
    previous_advice: list[str],
) -> dict:
    """Everything the model is shown (stored with the inquiry). Values are strings, in each account's own currency."""
    pool = included(rows, excluded_ids)
    current = mix(pool)
    by_currency: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for r in pool:
        by_currency[r.currency] += r.value

    positions: dict[tuple[str, str], dict] = {}
    for r in pool:
        for _, symbol, name, asset_class, value in r.parts:
            if not symbol:
                continue
            p = positions.setdefault(
                (r.currency, symbol), {"symbol": symbol, "name": name, "asset_class": asset_class, "currency": r.currency, "value": ZERO}
            )
            p["value"] += value
    top = sorted(positions.values(), key=lambda p: -p["value"])[:TOP_POSITIONS]

    def account(r: PoolAccount) -> dict:
        reason = "fixed asset (kept, not in the pool)" if r.fixed else "left out by the person" if r.id in excluded_ids else None
        return {
            "name": r.name,
            "institution": r.institution,
            "type": r.account_type,
            "currency": r.currency,
            "country": r.country,
            "value": str(r.value),
            "buckets": [{"bucket": b, "percent": str(pct.normalize())} for b, pct in r.buckets],
            "in_pool": reason is None,
            "excluded_because": reason,
        }

    buckets = user_buckets(db, workspace.user_id)
    return {
        "today": today.isoformat(),
        "age": _age(user.date_of_birth, today),
        "expenses": {"monthly": str(q(monthly_expenses)), "currency": currency},
        "withdrawal_rate_pct": str(withdrawal_rate_pct.normalize()),
        "pool_by_currency": [{"currency": c, "value": str(q(v))} for c, v in sorted(by_currency.items())],
        "classes": [{"key": k, "label": class_label(k), "currency": k.split(":")[0], "value": str(v)} for k, v in current.items()],
        "target_keys": target_keys(pool, current),
        "accounts": [account(r) for r in rows],
        "top_positions": [
            {**p, "value": str(q(p["value"])), "share_of_currency_pool": str(round(p["value"] / by_currency[p["currency"]] * 100, 1))} for p in top
        ],
        "milestones": _milestones(db, workspace, buckets, today),
        "previous_advice": previous_advice,
    }
