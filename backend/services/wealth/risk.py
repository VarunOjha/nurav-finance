"""Risk read: facts about the money as it is today, computed, never estimated.

No market data: concentration, access and cover come from the person's own
balances and latest portfolio snapshots, one currency at a time (no
conversion). The model gets the same numbers without holding symbols
(`for_model`); the report shows the symbol.
"""

from collections import defaultdict
from decimal import Decimal

from services.agent.snapshot import Snapshot
from services.holdings import ZERO

CASH_TYPES = ("checking", "savings", "fixed_deposit")


def _f(x: Decimal) -> float:
    return round(float(x), 2)


def risk_read(snap: Snapshot, currency: str, monthly_spending: float | None = None) -> dict:
    """The read for one currency's money (a pot), with cash cover if spending is known."""
    live = [e for e in snap.live() if e.item.currency == currency]
    total = sum((e.value for e in live), ZERO)  # type: ignore[misc]
    by_alias = {e.alias: e for e in snap.entries.values()}

    holdings: dict[str, Decimal] = defaultdict(lambda: ZERO)
    classes: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for e in live:
        snap_row = e.item.latest_snapshot
        if e.item.kind != "portfolio" or snap_row is None:
            continue
        for h in snap_row.holdings:
            v = h.quantity * h.current_price
            holdings[h.symbol.upper()] += v
            classes[h.asset_class] += v
    held = sum(holdings.values(), ZERO)
    ranked = sorted(holdings.items(), key=lambda kv: -kv[1])

    def account_type(e) -> str:
        if e.item.kind == "account":
            return e.item.group
        linked = next((a for a, x in by_alias.items() if x.counted_in == e.alias), None)
        return by_alias[linked].item.group if linked else "portfolio"

    retirement = sum((e.value for e in live if account_type(e) == "retirement"), ZERO)  # type: ignore[misc]
    cash = sum((e.value for e in live if e.item.kind == "account" and e.item.group in CASH_TYPES), ZERO)  # type: ignore[misc]

    out: dict = {
        "currency": currency,
        "net_worth": _f(total),
        "currencies": snap.currencies(),
        "retirement_share": float(retirement / total) if total else None,
        "cash_share": float(cash / total) if total else None,
    }
    if held:
        top_symbol, top_value = ranked[0]
        out["holdings"] = {
            "count": len(ranked),
            "value": _f(held),
            "top": {"symbol": top_symbol, "share": float(top_value / held), "share_of_net_worth": float(top_value / total) if total else None},
            "top3_share": float(sum((v for _, v in ranked[:3]), ZERO) / held),
            "asset_classes": [{"asset_class": k, "share": float(v / held)} for k, v in sorted(classes.items(), key=lambda kv: -kv[1])],
        }
    if monthly_spending and cash:
        out["cash_months"] = float(cash) / monthly_spending
    return out


def for_model(risk: dict) -> dict:
    """The same read without holding symbols."""
    out = {k: v for k, v in risk.items() if k != "holdings"}
    if "holdings" in risk:
        h = risk["holdings"]
        out["holdings"] = {**h, "top": {k: v for k, v in h["top"].items() if k != "symbol"}}
    return out
