"""Workspace analytics, computed on read from live (non-deleted) rows only.

No FX conversion: every figure is grouped by currency. A month's value is the
carried-forward month-end value (see services/ledger.py), so backdated
entries and snapshots are reflected automatically. Accounts hold cash
balances, portfolios hold holdings value; the two are added for "total".
An account linked to a portfolio is that portfolio's money, so it counts for
nothing while the portfolio is open (see Item.linked_until).

Buckets: every item's value is shared out by the split in force that day
(services/splits.py); a portfolio uses its brokerage account's split. Items
without a split count as Unassigned (bucket id None).
"""

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from models import Account, BalanceEntry, Bucket, Portfolio, Snapshot, Workspace
from services.holdings import ZERO, allocation, holding_value, q, share, snapshot_total
from services.ledger import Point, Timeline, add_months, month_end, month_key, months_between, value_on
from services.splits import HUNDRED, SplitTimeline, load_splits

RANGES = {"6m": 6, "1y": 12, "3y": 36}

# "What it's in" for an account balance. Deposits are cash; an investment or
# retirement account's balance is invested in something we don't know, so it gets
# its own slice rather than pretending to be cash.
ACCOUNT_ASSET_CLASS = {
    "checking": "cash",
    "savings": "cash",
    "fixed_deposit": "cash",
    "brokerage": "cash",  # uninvested cash at a broker; holdings come from its portfolio
    "investment": "unclassified",
    "retirement": "unclassified",
    "asset": "property",  # a house, a car…: neither cash nor a fund
    "other": "other",
}


@dataclass
class Item:
    kind: str  # "account" | "portfolio"
    name: str
    currency: str
    timeline: Timeline[Decimal]
    closed_on: date | None
    group: str  # account type; a portfolio takes its brokerage account's type
    latest_snapshot: Snapshot | None = None
    id: uuid.UUID | None = None
    account_id: uuid.UUID | None = None  # portfolios: the linked brokerage account
    # Accounts: closing date (None = open) of its live portfolio (one per account;
    # a list so the maths needn't assume it). While it is open the account's money is the portfolio's, counted
    # through its holdings, so the account counts as nothing on those days.
    linked_until: list[date | None] = field(default_factory=list)
    created_at: datetime | None = None
    splits: SplitTimeline = field(default_factory=lambda: SplitTimeline([]))

    def linked_on(self, day: date) -> bool:
        return any(until is None or day <= until for until in self.linked_until)

    def value(self, day: date) -> Decimal | None:
        return None if self.linked_on(day) else value_on(self.timeline, day, self.closed_on)

    def portions(self, day: date) -> list[tuple[uuid.UUID | None, Decimal, Decimal]]:
        """[(bucket_id or None for Unassigned, percent, value)] of this item on `day`."""
        value = self.value(day)
        if value is None:
            return []
        split = self.splits.at(day)
        if split is None:
            return [(None, HUNDRED, value)]
        return [(bucket_id, pct, value * pct / HUNDRED) for bucket_id, pct in split.lines]

    def bucket_value(self, bucket_id: uuid.UUID | None, day: date) -> Decimal | None:
        """This item's money in one bucket on `day`; None when it has no value or none of it is in that bucket."""
        parts = [v for b, _, v in self.portions(day) if b == bucket_id]
        return sum(parts, ZERO) if parts else None


def load_items(db: Session, workspace: Workspace) -> list[Item]:
    """Every live account and portfolio of the workspace, with its value timeline."""
    items: list[Item] = []
    accounts = db.scalars(select(Account).where(Account.workspace_id == workspace.id)).all()
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
                Timeline(entries[a.id]),
                a.closed_on,
                a.account_type,
                id=a.id,
                created_at=a.created_at,
            )
        )

    portfolios = db.scalars(select(Portfolio).where(Portfolio.workspace_id == workspace.id)).all()
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
                timeline,
                p.closed_on,
                "portfolio",
                latest.ref if latest else None,
                id=p.id,
                account_id=p.account_id,
                created_at=p.created_at,
            )
        )
    accounts_by_id = {i.id: i for i in items if i.kind == "account"}
    splits = load_splits(db, list(accounts_by_id))
    for account_id, timeline in splits.items():
        accounts_by_id[account_id].splits = timeline
    for i in items:
        if i.kind != "portfolio":
            continue
        # "Where it's held": a portfolio is the money in its brokerage account.
        owner = accounts_by_id.get(i.account_id)
        i.group = owner.group if owner else "brokerage"
        if owner:
            owner.linked_until.append(i.closed_on)
            i.splits = owner.splits  # a portfolio is split like its brokerage account
    return items


def _sum(values: list[Decimal | None]) -> Decimal | None:
    present = [v for v in values if v is not None]
    return q(sum(present, ZERO)) if present else None


def overview(db: Session, workspace: Workspace, range_key: str, today: date | None = None) -> dict:
    today = today or date.today()
    items = load_items(db, workspace)

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

    # Allocation as of today, per currency.
    by_type: dict[str, list] = defaultdict(list)
    by_class: dict[str, list] = defaultdict(list)
    for i in items:
        value = i.value(today)
        if not value:
            continue
        by_type[i.currency].append((i.group, value))
        if i.kind == "account":
            by_class[i.currency].append((ACCOUNT_ASSET_CLASS.get(i.group, "other"), value))
        elif i.latest_snapshot is not None:
            for h in i.latest_snapshot.holdings:
                by_class[i.currency].append((h.asset_class, holding_value(h)))

    def slices(grouped: dict[str, list]) -> list[dict]:
        return [{"currency": c, "slices": allocation(pairs)} for c, pairs in sorted(grouped.items())]

    return {
        "months": [month_key(m) for m in months],
        "currencies": currencies,
        "buckets": bucket_overview(db, workspace, items, days, today),
        "allocation": {
            "by_type": slices(by_type),
            "by_asset_class": slices(by_class),
        },
        "top_assets": top_assets(items, today),
        "timeline": _events(items),
    }


def user_buckets(db: Session, user_id: uuid.UUID) -> dict[uuid.UUID, Bucket]:
    """All live buckets of the user, archived ones included (history still shows them)."""
    return {b.id: b for b in db.scalars(select(Bucket).where(Bucket.user_id == user_id))}


def bucket_series(items: list[Item], bucket_id: uuid.UUID | None, days: list[date]) -> list[Decimal | None]:
    return [_sum([i.bucket_value(bucket_id, d) for i in items]) for d in days]


def pace(items: list[Item], bucket_id: uuid.UUID | None, today: date, months: int) -> Decimal | None:
    """Average change per month over the last `months` months (today vs that month-end).

    Only items whose value at the window start is known take part (a recorded
    value then; record a 0 to mark when a new account started). An item first
    recorded inside the window has no known start; counting it as 0 would turn
    "started tracking" into "earned it all". None when nothing qualifies.
    """
    start = month_end(add_months(today, -months))
    known = [i for i in items if i.value(start) is not None]
    if not known:
        return None
    now = _sum([i.bucket_value(bucket_id, today) for i in known])
    then = _sum([i.bucket_value(bucket_id, start) for i in known])
    if now is None and then is None:
        return None
    return q(((now or ZERO) - (then or ZERO)) / months)


def bucket_overview(db: Session, workspace: Workspace, items: list[Item], days: list[date], today: date) -> dict:
    """Per currency, one row per bucket that holds (or held, within the range) any money.

    Unassigned (bucket_id None) is a row like any other. `sources` explains
    today's value: which accounts feed the bucket, at what percent — a
    portfolio's money is shown under its brokerage account.
    """
    known = user_buckets(db, workspace.user_id)
    by_currency: dict[str, list[Item]] = defaultdict(list)
    for i in items:
        by_currency[i.currency].append(i)
    names = {i.id: i.name for i in items if i.kind == "account"}

    currencies = []
    for currency, subset in sorted(by_currency.items()):
        ids: set = set()
        for i in subset:
            for d in [*days, today]:
                ids.update(b for b, _, _ in i.portions(d))
        rows = []
        current_total = _sum([i.value(today) for i in subset]) or ZERO
        for bucket_id in ids:
            values = bucket_series(subset, bucket_id, days)
            if all(v is None for v in values):
                continue
            current = _sum([i.bucket_value(bucket_id, today) for i in subset])
            last_month = _sum([i.bucket_value(bucket_id, month_end(add_months(today, -1))) for i in subset])
            first = next((v for v in values if v is not None), None)
            sources: dict = {}
            for i in subset:
                for b, pct, value in i.portions(today):
                    if b != bucket_id:
                        continue
                    key = i.account_id if i.kind == "portfolio" and i.account_id else i.id
                    src = sources.setdefault(key, {"account_id": key, "name": names.get(key, i.name), "percent": pct, "value": ZERO})
                    src["value"] += value
            rows.append(
                {
                    "bucket_id": bucket_id,
                    "values": values,
                    "current": current,
                    "share": share(current or ZERO, current_total) if current_total > 0 else ZERO,
                    "change_1m": (q((current or ZERO) - last_month) if last_month is not None else None),
                    "pace_3m": pace(subset, bucket_id, today, 3),
                    "pace_6m": pace(subset, bucket_id, today, 6),
                    "pace_12m": pace(subset, bucket_id, today, 12),
                    "growth_pct": (q((current or ZERO) / first * 100 - 100) if first and first > 0 else None),
                    "sources": sorted(({**s, "value": q(s["value"])} for s in sources.values()), key=lambda s: -s["value"]),
                }
            )
        order = {b.id: (b.position, b.name.lower()) for b in known.values()}
        rows.sort(key=lambda r: (r["bucket_id"] is None, order.get(r["bucket_id"], (999, ""))))
        if rows:
            currencies.append({"currency": currency, "rows": rows})
    return {
        "buckets": [
            {"id": b.id, "name": b.name, "color": b.color, "archived": b.archived_at is not None}
            for b in sorted(known.values(), key=lambda b: (b.position, b.name.lower()))
        ],
        "currencies": currencies,
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
        if i.closed_on:
            events.append({"date": i.closed_on, "kind": f"{i.kind}_closed", "name": i.name, "currency": i.currency})
    events.sort(key=lambda e: e["date"], reverse=True)
    return events[:50]
