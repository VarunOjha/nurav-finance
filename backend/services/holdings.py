"""Snapshot totals, comparisons and allocation — pure functions over ORM rows."""

from collections import defaultdict
from decimal import Decimal

from models import Holding, Snapshot

CENT = Decimal("0.0001")
ZERO = Decimal("0")


def q(value: Decimal) -> Decimal:
    return value.quantize(CENT)


def holding_value(h: Holding) -> Decimal:
    return q(h.quantity * h.price)


def snapshot_total(s: Snapshot) -> Decimal:
    return q(sum((h.quantity * h.price for h in s.holdings), ZERO))


def share(part: Decimal, whole: Decimal) -> Decimal:
    return (part / whole).quantize(Decimal("0.000001")) if whole else ZERO


def allocation(pairs: list[tuple[str, Decimal]]) -> list[dict]:
    """[(label, value)] -> slices sorted by value desc, with shares of the total."""
    totals: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for label, value in pairs:
        totals[label] += value
    whole = sum(totals.values(), ZERO)
    return [
        {"label": label, "value": q(value), "share": share(value, whole)}
        for label, value in sorted(totals.items(), key=lambda kv: kv[1], reverse=True)
    ]


def compare(current: Snapshot, previous: Snapshot | None) -> list[dict]:
    """Per-symbol diff of two snapshots, newest snapshot's weights.

    Ordered: current holdings by value desc, then sold positions.
    """
    total = snapshot_total(current)
    prev_by_symbol = {h.symbol: h for h in previous.holdings} if previous else {}
    rows: list[dict] = []
    for h in current.holdings:
        p = prev_by_symbol.get(h.symbol)
        value = holding_value(h)
        prev_value = holding_value(p) if p else ZERO
        if previous is None:
            state = "unchanged"
        elif p is None:
            state = "new"
        elif p.quantity != h.quantity:
            state = "changed"
        else:
            state = "unchanged"
        rows.append(
            dict(
                symbol=h.symbol,
                name=h.name,
                asset_class=h.asset_class,
                status=state,
                quantity=h.quantity,
                previous_quantity=p.quantity if p else None,
                quantity_change=(h.quantity - p.quantity) if p else None,
                price=h.price,
                value=value,
                previous_value=prev_value,
                value_change=value - prev_value,
                weight=share(value, total),
            )
        )
    rows.sort(key=lambda r: r["value"], reverse=True)
    current_symbols = {h.symbol for h in current.holdings}
    for p in previous.holdings if previous else []:
        if p.symbol in current_symbols:
            continue
        prev_value = holding_value(p)
        rows.append(
            dict(
                symbol=p.symbol,
                name=p.name,
                asset_class=p.asset_class,
                status="sold",
                quantity=None,
                previous_quantity=p.quantity,
                quantity_change=-p.quantity,
                price=None,
                value=ZERO,
                previous_value=prev_value,
                value_change=-prev_value,
                weight=ZERO,
            )
        )
    return rows
