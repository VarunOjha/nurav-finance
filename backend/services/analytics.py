"""Tenant analytics, computed on read from live (non-deleted) rows only.

No FX conversion: every figure is grouped by currency. A month's value is the
carried-forward month-end value (see services/ledger.py), so backdated
entries and snapshots are reflected automatically. Accounts hold cash
balances, portfolios hold holdings value; the two are added for "total".
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from models import Account, AccountTag, BalanceEntry, Portfolio, PortfolioTag, Snapshot, Tenant
from services.holdings import ZERO, allocation, holding_value, q, snapshot_total
from services.ledger import Point, Timeline, add_months, month_end, month_key, months_between, value_on

RANGES = {"6m": 6, "1y": 12, "3y": 36}
UNTAGGED = "untagged"


@dataclass
class Item:
    kind: str  # "account" | "portfolio"
    name: str
    currency: str
    tags: list[str]
    timeline: Timeline[Decimal]
    closed_on: date | None
    opened_on: date | None
    group: str  # account type, or "portfolio"
    latest_snapshot: Snapshot | None = None


def _load(db: Session, tenant: Tenant) -> list[Item]:
    items: list[Item] = []
    accounts = db.scalars(
        select(Account).where(Account.tenant_id == tenant.id).options(selectinload(Account.tag_links).selectinload(AccountTag.tag))
    ).all()
    entries: dict = defaultdict(list)
    if accounts:
        for e in db.scalars(select(BalanceEntry).where(BalanceEntry.account_id.in_([a.id for a in accounts]))):
            entries[e.account_id].append(Point(e.as_of, e.created_at, e.amount))
    for a in accounts:
        items.append(
            Item(
                "account",
                a.name,
                a.currency,
                sorted(link.tag.name for link in a.tag_links),
                Timeline(entries[a.id]),
                a.closed_on,
                a.opened_on,
                a.account_type,
            )
        )

    portfolios = db.scalars(
        select(Portfolio).where(Portfolio.tenant_id == tenant.id).options(selectinload(Portfolio.tag_links).selectinload(PortfolioTag.tag))
    ).all()
    snaps: dict = defaultdict(list)
    if portfolios:
        for s in db.scalars(select(Snapshot).where(Snapshot.portfolio_id.in_([p.id for p in portfolios])).options(selectinload(Snapshot.holdings))):
            snaps[s.portfolio_id].append(s)
    for p in portfolios:
        timeline = Timeline(Point(s.as_of, s.created_at, snapshot_total(s), s) for s in snaps[p.id])
        latest = timeline.latest()
        items.append(
            Item(
                "portfolio",
                p.name,
                p.currency,
                sorted(link.tag.name for link in p.tag_links),
                timeline,
                p.closed_on,
                p.opened_on,
                "portfolio",
                latest.ref if latest else None,
            )
        )
    return items


def _sum(values: list[Decimal | None]) -> Decimal | None:
    present = [v for v in values if v is not None]
    return q(sum(present, ZERO)) if present else None


def overview(db: Session, tenant: Tenant, range_key: str, today: date | None = None) -> dict:
    today = today or date.today()
    items = _load(db, tenant)

    first_days = [i.timeline.first_day() for i in items if i.timeline]
    if range_key in RANGES:
        start = add_months(today, -(RANGES[range_key] - 1))
    else:
        start = min(first_days) if first_days else today
    months = months_between(start, today)
    # The current month is measured as of today, earlier months at month-end.
    days = [min(month_end(m), today) for m in months]

    def series(subset: list[Item]) -> list[Decimal | None]:
        return [_sum([value_on(i.timeline, d, i.closed_on) for i in subset]) for d in days]

    by_currency: dict[str, list[Item]] = defaultdict(list)
    for i in items:
        by_currency[i.currency].append(i)

    year_ago = month_end(add_months(today, -12))
    last_month = month_end(add_months(today, -1))

    def total_on(subset: list[Item], day: date) -> Decimal | None:
        return _sum([value_on(i.timeline, day, i.closed_on) for i in subset])

    currencies = []
    for currency, subset in by_currency.items():
        accounts = [i for i in subset if i.kind == "account"]
        portfolios = [i for i in subset if i.kind == "portfolio"]
        currencies.append(
            {
                "currency": currency,
                "accounts": series(accounts),
                "portfolios": series(portfolios),
                "total": series(subset),
                "current_total": total_on(subset, today),
                "current_accounts": total_on(accounts, today),
                "current_portfolios": total_on(portfolios, today),
                "last_month_total": total_on(subset, last_month),
                "year_ago_total": total_on(subset, year_ago),
                "account_count": sum(1 for i in accounts if not i.closed_on),
                "portfolio_count": sum(1 for i in portfolios if not i.closed_on),
            }
        )
    currencies.sort(key=lambda c: (c["current_total"] or ZERO), reverse=True)

    # Tag trends: an item with several tags counts towards each of them.
    tag_names = sorted({t for i in items for t in i.tags})
    tags = []
    for tag in tag_names:
        tagged = [i for i in items if tag in i.tags]
        per_currency = defaultdict(list)
        for i in tagged:
            per_currency[i.currency].append(i)
        tags.append(
            {
                "tag": tag,
                "currencies": [{"currency": c, "values": series(sub)} for c, sub in sorted(per_currency.items())],
            }
        )

    # Allocation as of today, per currency.
    by_type: dict[str, list] = defaultdict(list)
    by_class: dict[str, list] = defaultdict(list)
    by_tag: dict[str, list] = defaultdict(list)
    for i in items:
        value = value_on(i.timeline, today, i.closed_on)
        if not value:
            continue
        by_type[i.currency].append((i.group, value))
        for tag in i.tags or [UNTAGGED]:
            by_tag[i.currency].append((tag, value))
        if i.kind == "account":
            by_class[i.currency].append(("cash", value))
        elif i.latest_snapshot is not None:
            for h in i.latest_snapshot.holdings:
                by_class[i.currency].append((h.asset_class, holding_value(h)))

    def slices(grouped: dict[str, list]) -> list[dict]:
        return [{"currency": c, "slices": allocation(pairs)} for c, pairs in sorted(grouped.items())]

    events = []
    for i in items:
        if i.opened_on:
            events.append({"date": i.opened_on, "kind": f"{i.kind}_opened", "name": i.name, "currency": i.currency})
        if i.closed_on:
            events.append({"date": i.closed_on, "kind": f"{i.kind}_closed", "name": i.name, "currency": i.currency})
    events.sort(key=lambda e: e["date"], reverse=True)

    return {
        "months": [month_key(m) for m in months],
        "currencies": currencies,
        "tags": tags,
        "allocation": {
            "by_type": slices(by_type),
            "by_asset_class": slices(by_class),
            "by_tag": slices(by_tag),
        },
        "timeline": events[:50],
    }
