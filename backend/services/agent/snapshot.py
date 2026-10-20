"""What the Wealth Agent may know about the person's money, and nothing more.

Every live account and portfolio becomes an alias ("Account A", "Portfolio B"),
assigned in creation order so the same item keeps its alias for the whole
chat (a newly added account takes the next letter). The model gets aliases,
types, currency, today's value, totals per currency and, for portfolios, the
asset-class mix: no names, institutions, account numbers, tags, symbols,
email or phone. The browser receives the alias map and shows real names; the
server uses it to render saved reports.
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal

from services.analytics import Item
from services.holdings import ZERO

_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


def letters(i: int) -> str:
    """0 -> A, 25 -> Z, 26 -> AA (spreadsheet columns)."""
    out = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        out = chr(65 + r) + out
    return out


def age_on(birth: date, day: date) -> int:
    return day.year - birth.year - ((day.month, day.day) < (birth.month, birth.day))


@dataclass
class Entry:
    alias: str
    item: Item
    value: Decimal | None  # None: closed, or counted inside its linked portfolio
    counted_in: str | None = None  # alias of the portfolio that counts this account's money


class Snapshot:
    def __init__(self, items: list[Item], as_of: date, birth: date | None):
        self.as_of = as_of
        self.birth = birth
        self.entries: dict[str, Entry] = {}
        order = lambda i: (i.created_at or _EPOCH, str(i.id))  # noqa: E731
        portfolios = sorted((i for i in items if i.kind == "portfolio"), key=order)
        accounts = sorted((i for i in items if i.kind == "account"), key=order)
        by_id: dict = {}
        for prefix, group in (("Account", accounts), ("Portfolio", portfolios)):
            for n, item in enumerate(group):
                alias = f"{prefix} {letters(n)}"
                self.entries[alias] = Entry(alias, item, item.value(as_of))
                by_id[(item.kind, item.id)] = alias
        for p in portfolios:
            linked = by_id.get(("account", p.account_id))
            if linked and self.entries[linked].value is None and self.entries[linked].item.linked_on(as_of):
                self.entries[linked].counted_in = by_id[("portfolio", p.id)]

    # ── for the model ────────────────────────────────────────────────────────

    def _asset_mix(self, item: Item) -> dict[str, float] | None:
        snap = item.latest_snapshot
        if item.kind != "portfolio" or snap is None or not snap.holdings:
            return None
        totals: dict[str, Decimal] = defaultdict(lambda: ZERO)
        for h in snap.holdings:
            totals[h.asset_class] += h.quantity * h.current_price
        whole = sum(totals.values(), ZERO)
        if not whole:
            return None
        return {k: round(float(v / whole), 3) for k, v in sorted(totals.items(), key=lambda kv: -kv[1])}

    def live(self) -> list[Entry]:
        """Entries with a value today (open, and not counted inside a portfolio)."""
        return [e for e in self.entries.values() if e.value is not None]

    def currencies(self) -> list[dict]:
        totals: dict[str, list[Decimal]] = defaultdict(list)
        for e in self.live():
            totals[e.item.currency].append(e.value)  # type: ignore[arg-type]
        rows = [{"currency": c, "count": len(vs), "total": round(float(sum(vs, ZERO)), 2)} for c, vs in totals.items()]
        # Most items first: totals in different currencies can't be compared without conversion.
        return sorted(rows, key=lambda r: (-r["count"], r["currency"]))

    def for_model(self) -> dict:
        items = []
        for e in self.entries.values():
            i = e.item
            if e.value is None and e.counted_in is None:
                continue  # closed: nothing to plan with
            row: dict = {
                "alias": e.alias,
                "kind": i.kind,
                "type": i.group if i.kind == "account" else "portfolio",
                "currency": i.currency,
                "value": None if e.value is None else round(float(e.value), 2),
            }
            if e.counted_in:
                row["counted_in"] = e.counted_in
            if i.kind == "portfolio":
                linked = next((a for a, x in self.entries.items() if x.counted_in == e.alias), None)
                if linked:
                    row["linked_account"] = linked
                mix = self._asset_mix(i)
                if mix:
                    row["asset_mix"] = mix
            items.append(row)
        return {
            "as_of": self.as_of.isoformat(),
            "age": age_on(self.birth, self.as_of) if self.birth else None,
            "currencies": self.currencies(),
            "items": items,
        }

    # ── for the person's screen ──────────────────────────────────────────────

    def display_map(self) -> dict[str, str]:
        """Alias -> real name."""
        return {a: e.item.name for a, e in self.entries.items()}
