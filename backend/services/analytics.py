"""Tenant analytics, computed on read from live (non-deleted) rows only.

No FX conversion: every figure is grouped by currency. A month's value is the
carried-forward month-end value (see services/ledger.py), so backdated
entries and snapshots are reflected automatically. Accounts hold cash
balances, portfolios hold holdings value; the two are added for "total".
An account linked to a portfolio is that portfolio's money, so it counts for
nothing while the portfolio is open (see Item.linked_until).
"""

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
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
    id: uuid.UUID | None = None
    account_id: uuid.UUID | None = None  # portfolios: the linked brokerage account
    # Accounts: closing dates (None = open) of the live portfolios linked to it.
    # While one of them is open the account's money is the portfolio's, counted
    # through its holdings, so the account counts as nothing on those days.
    linked_until: list[date | None] = field(default_factory=list)
    created_at: datetime | None = None

    def linked_on(self, day: date) -> bool:
        return any(until is None or day <= until for until in self.linked_until)

    def value(self, day: date) -> Decimal | None:
        return None if self.linked_on(day) else value_on(self.timeline, day, self.closed_on)


def load_items(db: Session, tenant: Tenant) -> list[Item]:
    """Every live account and portfolio of the tenant, with its value timeline (also used by the Wealth Agent)."""
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
                id=a.id,
                created_at=a.created_at,
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
                id=p.id,
                account_id=p.account_id,
                created_at=p.created_at,
            )
        )
    accounts_by_id = {i.id: i for i in items if i.kind == "account"}
    for i in items:
        if i.kind == "portfolio" and i.account_id in accounts_by_id:
            accounts_by_id[i.account_id].linked_until.append(i.closed_on)
    return items


def _sum(values: list[Decimal | None]) -> Decimal | None:
    present = [v for v in values if v is not None]
    return q(sum(present, ZERO)) if present else None


def overview(db: Session, tenant: Tenant, range_key: str, today: date | None = None) -> dict:
    today = today or date.today()
    items = load_items(db, tenant)

    first_days = [i.timeline.first_day() for i in items if i.timeline]
    if range_key in RANGES:
        start = add_months(today, -(RANGES[range_key] - 1))
    else:
        start = min(first_days) if first_days else today
    months = months_between(start, today)
    # The current month is measured as of today, earlier months at month-end.
    days = [min(month_end(m), today) for m in months]

    def series(subset: list[Item]) -> list[Decimal | None]:
        return [_sum([i.value(d) for i in subset]) for d in days]

    by_currency: dict[str, list[Item]] = defaultdict(list)
    for i in items:
        by_currency[i.currency].append(i)

    year_ago = month_end(add_months(today, -12))
    last_month = month_end(add_months(today, -1))

    def total_on(subset: list[Item], day: date) -> Decimal | None:
        return _sum([i.value(day) for i in subset])

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
                "account_count": sum(1 for i in accounts if not i.closed_on and not i.linked_on(today)),
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
        value = i.value(today)
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

    return {
        "months": [month_key(m) for m in months],
        "currencies": currencies,
        "tags": tags,
        "allocation": {
            "by_type": slices(by_type),
            "by_asset_class": slices(by_class),
            "by_tag": slices(by_tag),
        },
        "top_assets": top_assets(items, today),
        "timeline": _events(items),
    }


def top_assets(items: list[Item], today: date) -> list[dict]:
    """Every positive asset held today, per currency, largest first.

    An account is one asset; a portfolio contributes each holding of its
    snapshot in force today, merged by symbol across portfolios. Closed items
    and non-positive values (cards, loans, shorts) are left out, and so is an
    account linked to an open portfolio (see Item.linked_until). The client
    picks the top N for the scope it shows.
    """
    by_currency: dict[str, dict[tuple, dict]] = defaultdict(dict)
    for i in items:
        if i.closed_on is not None and i.closed_on <= today:
            continue
        assets = by_currency[i.currency]
        if i.kind == "account":
            value = i.value(today)
            if value is not None and value > 0:
                assets[("account", id(i))] = {"kind": "account", "name": i.name, "symbol": None, "group": i.group, "held_in": [], "value": value}
            continue
        point = i.timeline.at(today)
        if point is None:
            continue
        for h in point.ref.holdings:
            value = holding_value(h)
            if value <= 0:
                continue
            symbol = h.symbol.strip().upper()
            asset = assets.setdefault(
                ("holding", symbol),
                {"kind": "holding", "name": h.name or symbol, "symbol": symbol, "group": h.asset_class, "held_in": [], "value": ZERO},
            )
            asset["value"] += value
            if i.name not in asset["held_in"]:
                asset["held_in"].append(i.name)
    result = []
    for currency, assets in sorted(by_currency.items()):
        ranked = sorted(assets.values(), key=lambda a: (-a["value"], a["name"]))
        if ranked:
            result.append({"currency": currency, "assets": [{**a, "value": q(a["value"]), "held_in": sorted(a["held_in"])} for a in ranked]})
    return result


def _events(items: list[Item]) -> list[dict]:
    events = []
    for i in items:
        if i.opened_on:
            events.append({"date": i.opened_on, "kind": f"{i.kind}_opened", "name": i.name, "currency": i.currency})
        if i.closed_on:
            events.append({"date": i.closed_on, "kind": f"{i.kind}_closed", "name": i.name, "currency": i.currency})
    events.sort(key=lambda e: e["date"], reverse=True)
    return events[:50]
