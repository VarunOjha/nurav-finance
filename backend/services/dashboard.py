"""The dashboard: where the money is today, how it grew year by year, and what needs a look.

Everything is per currency (no FX) and built on the same items as analytics
(services/analytics.load_items): an account linked to an open portfolio counts
through its holdings. Bucket maths uses the split in force today.

The milestone tiles and the life map come from /api/metrics; the attention
rules here only need the next milestone's targets and today's bucket values:
- rebalance:      in one currency, the bucket furthest over its target next to
                  the one furthest behind (lowest share of its target)
- intent:         a bucket expecting >= 6% a year whose money is mostly (>= 50%)
                  in deposits and cash
- concentration:  one holding is >= 25% of a bucket
"""

import uuid
from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Bucket, BucketTarget, Milestone, Workspace
from services.analytics import Item, _sum, load_items, user_buckets
from services.holdings import ZERO, holding_cost, holding_value, q, share
from services.splits import HUNDRED

TOP_N = 5
GROWTH_RETURN = Decimal("6")  # an expected return at or above this means "growth"
LOW_YIELD_SHARE = Decimal("0.5")
CONCENTRATION_SHARE = Decimal("0.25")
CASH_GROUPS = {"checking", "savings", "brokerage"}  # a brokerage balance without a portfolio is uninvested cash


def _open(i: Item, today: date) -> bool:
    return i.closed_on is None or i.closed_on > today


def _bucket_ref(b: Bucket | None) -> dict | None:
    return {"id": b.id, "name": b.name, "color": b.color} if b else None


def _holdings(i: Item, today: date) -> list:
    point = i.timeline.at(today)
    return list(point.ref.holdings) if point is not None else []


def _currencies(items: list[Item], today: date) -> list[str]:
    """USD before INR for a mostly-US workspace: the currency with the most accounts first."""
    counts: dict[str, int] = defaultdict(int)
    for i in items:
        counts[i.currency] += 1 if i.kind == "account" else 0
    return sorted(counts, key=lambda c: (-counts[c], c))


def _yearly(subset: list[Item], today: date) -> list[dict]:
    days = [i.timeline.first_day() for i in subset if i.timeline.first_day()]
    if not days:
        return []
    out = []
    for year in range(min(days).year, today.year + 1):
        day = min(date(year, 12, 31), today)
        value = _sum([i.value(day) for i in subset])
        if value is not None:
            out.append({"year": year, "value": value, "as_of": day})
    return out


def _split_buckets(i: Item, today: date) -> list[uuid.UUID | None]:
    split = i.splits.at(today)
    return [b for b, _ in split.lines] if split else [None]


def _top_entries(subset: list[Item], total: Decimal, today: date) -> list[dict]:
    """Accounts as they are; an account with a portfolio is replaced by its holdings (merged by symbol)."""
    entries: dict[tuple, dict] = {}
    for i in subset:
        if not _open(i, today):
            continue
        if i.kind == "account":
            value = i.value(today)
            if value is not None and value > 0:
                entries[("a", i.id)] = {
                    "kind": "account",
                    "name": i.name,
                    "symbol": None,
                    "held_in": [],
                    "value": value,
                    "bucket_ids": _split_buckets(i, today),
                }
            continue
        for h in _holdings(i, today):
            value = holding_value(h)
            if value <= 0:
                continue
            symbol = h.symbol.strip().upper()
            e = entries.setdefault(
                ("h", symbol), {"kind": "holding", "name": symbol, "symbol": symbol, "held_in": [], "value": ZERO, "bucket_ids": []}
            )
            e["value"] += value
            if i.name not in e["held_in"]:
                e["held_in"].append(i.name)
            for b in _split_buckets(i, today):
                if b not in e["bucket_ids"]:
                    e["bucket_ids"].append(b)
    ranked = sorted(entries.values(), key=lambda e: (-e["value"], e["name"]))[:TOP_N]
    return [{**e, "value": q(e["value"]), "share": share(e["value"], total), "held_in": sorted(e["held_in"])} for e in ranked]


def _top_stocks(subset: list[Item], today: date) -> list[dict]:
    stocks: dict[str, dict] = {}
    for i in subset:
        if i.kind != "portfolio" or not _open(i, today):
            continue
        for h in _holdings(i, today):
            if h.asset_class != "stock":
                continue
            symbol = h.symbol.strip().upper()
            s = stocks.setdefault(symbol, {"symbol": symbol, "name": h.name, "held_in": [], "value": ZERO, "cost": ZERO, "costed": True})
            s["value"] += holding_value(h)
            cost = holding_cost(h)
            if cost is None:
                s["costed"] = False  # one lot without a buy price: no honest gain
            else:
                s["cost"] += cost
            s["name"] = s["name"] or h.name
            if i.name not in s["held_in"]:
                s["held_in"].append(i.name)
    total = sum((s["value"] for s in stocks.values()), ZERO)
    ranked = sorted(stocks.values(), key=lambda s: (-s["value"], s["symbol"]))[:TOP_N]
    out = []
    for s in ranked:
        cost = s["cost"] if s["costed"] and s["cost"] > 0 else None
        out.append(
            {
                "symbol": s["symbol"],
                "name": s["name"],
                "held_in": sorted(s["held_in"]),
                "value": q(s["value"]),
                "cost": q(cost) if cost is not None else None,
                "gain_pct": q((s["value"] - cost) / cost * 100) if cost is not None else None,
                "share": share(s["value"], total),
            }
        )
    return out


def _grid(subset: list[Item], buckets: dict[uuid.UUID, Bucket], today: date) -> dict:
    """One row per account (a portfolio's money sits on its brokerage account's row), one column per bucket."""
    accounts = {i.id: i for i in subset if i.kind == "account"}
    rows: dict[uuid.UUID, dict] = {}
    for i in subset:
        if not _open(i, today):
            continue
        owner = accounts.get(i.account_id) if i.kind == "portfolio" else i
        if owner is None:
            continue
        for b, _, value in i.portions(today):
            row = rows.setdefault(owner.id, {"account_id": owner.id, "name": owner.name, "cells": defaultdict(lambda: ZERO)})
            row["cells"][b] += value
    used = {b for r in rows.values() for b in r["cells"]}

    def col_key(b):
        bucket = buckets.get(b)
        return (b is None, bucket.position if bucket else 999, bucket.name.lower() if bucket else "")

    cols = sorted(used, key=col_key)
    totals = {b: q(sum((r["cells"].get(b, ZERO) for r in rows.values()), ZERO)) for b in cols}

    def row_key(r):
        main = max(r["cells"], key=lambda b: r["cells"][b])
        return (cols.index(main), -sum(r["cells"].values(), ZERO))

    return {
        "buckets": [_bucket_ref(buckets.get(b)) for b in cols],
        "rows": [
            {
                "account_id": r["account_id"],
                "name": r["name"],
                "cells": [q(r["cells"][b]) if b in r["cells"] else None for b in cols],
                "total": q(sum(r["cells"].values(), ZERO)),
            }
            for r in sorted(rows.values(), key=row_key)
        ],
        "totals": [totals[b] for b in cols],
    }


def _checkin(items: list[Item], today: date) -> dict:
    """What a monthly check-in updates: a balance per account, holdings per portfolio."""
    due = []
    for i in items:
        if not _open(i, today) or (i.kind == "account" and i.linked_on(today)):
            continue
        last = i.timeline.latest()
        due.append(
            {
                "kind": "balance" if i.kind == "account" else "holdings",
                "id": i.id,
                "account_id": i.account_id if i.kind == "portfolio" else i.id,
                "name": i.name,
                "currency": i.currency,
                "last": last.as_of if last else None,
            }
        )
    due.sort(key=lambda d: (d["last"] or date.min, d["name"].lower()))
    days = [d["last"] for d in due if d["last"]]
    return {"last": max(days) if days else None, "items": due}


def _bucket_mix(subset: list[Item], bucket_id: uuid.UUID, today: date) -> tuple[Decimal, Decimal, Decimal, dict[str, Decimal]]:
    """(total, fixed deposits, cash, {symbol: value}) of one bucket today."""
    total = fd = cash = ZERO
    symbols: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for i in subset:
        for b, pct, value in i.portions(today):
            if b != bucket_id:
                continue
            total += value
            if i.kind == "account":
                if i.group == "fixed_deposit":
                    fd += value
                elif i.group in CASH_GROUPS:
                    cash += value
                continue
            for h in _holdings(i, today):
                part = holding_value(h) * pct / HUNDRED
                if h.asset_class == "cash":
                    cash += part
                else:
                    symbols[h.symbol.strip().upper()] += part
    return total, fd, cash, symbols


def _attention(db: Session, workspace: Workspace, items: list[Item], buckets: dict[uuid.UUID, Bucket], today: date) -> tuple[dict | None, list[dict]]:
    milestone = db.scalar(
        select(Milestone).where(Milestone.workspace_id == workspace.id, Milestone.target_date >= today).order_by(Milestone.target_date)
    )
    alerts: list[dict] = []
    by_currency: dict[str, list[Item]] = defaultdict(list)
    for i in items:
        by_currency[i.currency].append(i)

    if milestone is not None:
        targets = [t for t in db.scalars(select(BucketTarget).where(BucketTarget.milestone_id == milestone.id)) if t.bucket_id in buckets]
        targets = [t for t in targets if buckets[t.bucket_id].archived_at is None]
        per_currency: dict[str, list[tuple[BucketTarget, Decimal]]] = defaultdict(list)
        for t in targets:
            current = _sum([i.bucket_value(t.bucket_id, today) for i in by_currency.get(t.currency, [])]) or ZERO
            per_currency[t.currency].append((t, current))
        for currency, pairs in sorted(per_currency.items()):
            over = [(t, c - t.amount) for t, c in pairs if c > t.amount]
            under = [(t, c) for t, c in pairs if c < t.amount and t.amount > 0]
            if over and under:
                o, surplus = max(over, key=lambda p: p[1])
                u, current = min(under, key=lambda p: p[1] / p[0].amount)
                alerts.append(
                    {
                        "kind": "rebalance",
                        "currency": currency,
                        "bucket": _bucket_ref(buckets[o.bucket_id]),
                        "amount": q(surplus),
                        "other_bucket": _bucket_ref(buckets[u.bucket_id]),
                        "other_amount": q(u.amount - current),
                    }
                )
        for t, _ in [p for c in sorted(per_currency) for p in per_currency[c]]:
            if t.expected_return is None or t.expected_return < GROWTH_RETURN:
                continue
            total, fd, cash, _ = _bucket_mix(by_currency.get(t.currency, []), t.bucket_id, today)
            if total <= 0 or (fd + cash) / total < LOW_YIELD_SHARE:
                continue
            label = "fixed_deposits" if cash == 0 else "cash" if fd == 0 else "deposits_and_cash"
            alerts.append(
                {
                    "kind": "intent",
                    "currency": t.currency,
                    "bucket": _bucket_ref(buckets[t.bucket_id]),
                    "expected_return": t.expected_return,
                    "share": share(fd + cash, total),
                    "label": label,
                }
            )

    for currency, subset in sorted(by_currency.items()):
        ids = {b for i in subset for b, _, _ in i.portions(today) if b is not None}
        for bucket_id in sorted(ids, key=lambda b: (buckets[b].position, buckets[b].name.lower()) if b in buckets else (999, "")):
            total, _, _, symbols = _bucket_mix(subset, bucket_id, today)
            if total <= 0 or not symbols:
                continue
            symbol, value = max(symbols.items(), key=lambda kv: kv[1])
            if value / total >= CONCENTRATION_SHARE:
                alerts.append(
                    {
                        "kind": "concentration",
                        "currency": currency,
                        "bucket": _bucket_ref(buckets.get(bucket_id)),
                        "symbol": symbol,
                        "share": share(value, total),
                    }
                )
    next_ref = {"id": milestone.id, "name": milestone.name, "target_date": milestone.target_date} if milestone else None
    return next_ref, alerts


def dashboard(db: Session, workspace: Workspace, today: date | None = None) -> dict:
    today = today or date.today()
    items = load_items(db, workspace)
    buckets = user_buckets(db, workspace.user_id)
    currencies = []
    for currency in _currencies(items, today):
        subset = [i for i in items if i.currency == currency]
        net_worth = _sum([i.value(today) for i in subset]) or ZERO
        currencies.append(
            {
                "currency": currency,
                "net_worth": net_worth,
                "account_count": sum(1 for i in subset if i.kind == "account" and _open(i, today)),
                "yearly": _yearly(subset, today),
                "top_entries": _top_entries(subset, net_worth, today),
                "top_stocks": _top_stocks(subset, today),
                "grid": _grid(subset, buckets, today),
            }
        )
    next_milestone, attention = _attention(db, workspace, items, buckets, today)
    return {
        "today": today,
        "next_milestone": next_milestone,
        "currencies": currencies,
        "attention": attention,
        "checkin": _checkin(items, today),
    }
