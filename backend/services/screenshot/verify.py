"""Step 3: plain code. Parses the chosen text, fills in what can be derived,
checks the arithmetic, and says what to re-read.

Issue levels:
- error: the row can't be saved as it is (no symbol, quantity or price; a duplicate)
- warn:  the numbers don't agree, or something looks off; the person should look
- info:  worth knowing (a calculated value, a proposed symbol)
"""

from dataclasses import dataclass, field
from decimal import Decimal

from services.screenshot.numbers import Parsed, parse, plain

QTY_PLACES = 8
PRICE_PLACES = 6
REL_TOLERANCE = Decimal("0.001")  # brokers round prices for display; 0.1% absorbs that
TOTAL_REL_TOLERANCE = Decimal("0.005")
QTY_JUMP = Decimal(5)  # quantity ×5 or ÷5 vs the last snapshot looks like a misread
MAX_QUESTIONS = 20
FIELDS = ("quantity", "buy_price", "current_price", "value", "invested")


@dataclass
class Issue:
    level: str
    message: str
    field: str | None = None


@dataclass
class Row:
    id: str
    symbol: str
    symbol_basis: str
    name: str | None
    asset_class: str
    printed: dict[str, str | None]
    quantity: Decimal | None = None
    buy_price: Decimal | None = None
    current_price: Decimal | None = None
    value: Decimal | None = None
    derived: list[str] = field(default_factory=list)
    rechecked: list[str] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)


@dataclass
class Check:
    kind: str
    status: str  # ok | warn | error | info
    message: str


@dataclass
class Verified:
    rows: list[Row]
    checks: list[Check]
    questions: list[dict]
    totals_question: bool


def _fmt(d: Decimal, currency: str | None = None) -> str:
    """For messages: grouped like the rest of the app (INR in lakhs and crores, else thousands),
    at most 2 decimals unless it's small."""
    places = 2 if abs(d) >= 1 else 6
    s = f"{abs(d).quantize(Decimal(10) ** -places):f}"
    whole, _, frac = s.partition(".")
    if currency and currency.upper() == "INR" and len(whole) > 3:
        head, groups = whole[:-3], [whole[-3:]]
        while head:
            groups.insert(0, head[-2:])
            head = head[:-2]
        whole = ",".join(groups)
    else:
        whole = f"{int(whole):,}"
    frac = frac.rstrip("0")
    return ("-" if d < 0 else "") + whole + (f".{frac}" if frac else "")


def _tolerance(total: Parsed, qty: Parsed, price: Parsed) -> Decimal:
    """How far qty × price may sit from a printed total, given how precisely the price and total
    were printed. Quantities are taken as exact: brokers print them in full."""
    return total.half_unit + abs(qty.value) * price.half_unit + abs(total.value) * REL_TOLERANCE


def _clean_symbol(s: str | None) -> str:
    return " ".join((s or "").split()).upper()


def verify(
    holdings: list[dict],
    portfolio_value: str | None,
    portfolio_invested: str | None,
    currency_seen: str | None,
    currency: str,
    previous: dict[str, dict],
) -> Verified:
    def fmt(d: Decimal) -> str:  # noqa: F811 — every message in this run uses the portfolio's grouping
        return _fmt(d, currency)

    rows: list[Row] = []
    questions: list[dict] = []
    seen: dict[str, str] = {}

    def ask(row: Row, *fields: str) -> None:
        for f in fields:
            if len(questions) >= MAX_QUESTIONS:
                return
            if not any(q["id"] == row.id and q["field"] == f for q in questions):
                questions.append({"id": row.id, "symbol": row.symbol, "field": f, "read_as": row.printed.get(f)})

    for h in holdings:
        printed = {f: (str(h[f]).strip() if h.get(f) not in (None, "") else None) for f in FIELDS}
        row = Row(
            id=h["id"],
            symbol=_clean_symbol(h.get("symbol")),
            symbol_basis=h.get("symbol_basis") or "proposed",
            name=(h.get("name") or "").strip()[:160] or None,
            asset_class=h.get("asset_class") or "stock",
            printed=printed,
            rechecked=list(h.get("rechecked") or []),
        )
        p = {f: parse(printed[f]) for f in FIELDS}
        for f in FIELDS:
            if printed[f] is not None and p[f] is None:
                row.issues.append(Issue("warn", f"“{printed[f]}” isn't a number I can use", f))
        qty, buy, price, value, invested = (p[f] for f in FIELDS)
        for f, parsed in (("quantity", qty), ("current_price", price), ("buy_price", buy)):
            if parsed is not None and parsed.value < 0:
                row.issues.append(Issue("error", f"{f.replace('_', ' ').capitalize()} can't be negative", f))
                p[f] = None
        qty, buy, price = p["quantity"], p["buy_price"], p["current_price"]

        # Derive what wasn't printed.
        if price is None and value is not None and qty is not None and qty.value > 0:
            row.current_price = (value.value / qty.value).quantize(Decimal(10) ** -PRICE_PLACES)
            row.derived.append("current_price")
            row.issues.append(Issue("info", "Current price calculated as value ÷ quantity", "current_price"))
        elif price is not None:
            row.current_price = price.value.quantize(Decimal(10) ** -PRICE_PLACES)
        if qty is None and value is not None and price is not None and price.value > 0:
            q = value.value / price.value
            nearest = q.to_integral_value()
            slack = (value.half_unit + q * price.half_unit) / price.value
            row.quantity = nearest if abs(q - nearest) <= slack else q.quantize(Decimal(10) ** -QTY_PLACES)
            row.derived.append("quantity")
            row.issues.append(Issue("warn", "Quantity wasn't shown; calculated as value ÷ price — check it", "quantity"))
        elif qty is not None:
            row.quantity = qty.value.quantize(Decimal(10) ** -QTY_PLACES)
        if buy is None and invested is not None and row.quantity:
            row.buy_price = (invested.value / row.quantity).quantize(Decimal(10) ** -PRICE_PLACES)
            row.derived.append("buy_price")
            row.issues.append(Issue("info", "Buy price calculated as invested ÷ quantity", "buy_price"))
        elif buy is not None:
            row.buy_price = buy.value.quantize(Decimal(10) ** -PRICE_PLACES)

        # What's still missing.
        if not row.symbol:
            row.issues.append(Issue("error", "Needs a symbol", "symbol"))
        elif len(row.symbol) > 24:
            row.issues.append(Issue("error", "Symbol is longer than 24 characters", "symbol"))
        elif row.symbol in seen:
            row.issues.append(Issue("error", f"{row.symbol} appears twice — merge or rename one", "symbol"))
        if row.symbol:
            seen.setdefault(row.symbol, row.id)
        if row.quantity is not None and row.quantity <= 0:
            row.quantity = None
        if row.quantity is None:
            row.issues.append(Issue("error", "Needs a quantity greater than 0", "quantity"))
            ask(row, "quantity")
        if row.current_price is None:
            row.issues.append(Issue("error", "Needs a current price (or a value to work it out from)", "current_price"))
            ask(row, "current_price", "value")

        # Arithmetic: quantity × price against the printed value, and × buy price against invested.
        if qty and price and value:
            computed = qty.value * price.value
            if abs(computed - value.value) > _tolerance(value, qty, price):
                row.issues.append(
                    Issue("warn", f"{fmt(qty.value)} × {fmt(price.value)} = {fmt(computed)}, but the screenshot shows {fmt(value.value)}", "value")
                )
                ask(row, "quantity", "current_price", "value")
        if qty and buy and invested:
            computed = qty.value * buy.value
            if abs(computed - invested.value) > _tolerance(invested, qty, buy):
                row.issues.append(
                    Issue("warn", f"{fmt(qty.value)} × {fmt(buy.value)} = {fmt(computed)}, but invested shows {fmt(invested.value)}", "buy_price")
                )
                ask(row, "quantity", "buy_price", "invested")

        # Against the last snapshot.
        prev = previous.get(row.symbol)
        if prev and row.quantity and prev.get("quantity"):
            before = Decimal(str(prev["quantity"]))
            if before > 0 and (row.quantity / before >= QTY_JUMP or before / row.quantity >= QTY_JUMP):
                row.issues.append(Issue("warn", f"Quantity was {fmt(before)} in the last snapshot — a misread, or a real change?", "quantity"))
        if row.symbol_basis == "proposed" and row.symbol and row.symbol not in previous:
            row.issues.append(Issue("info", "Symbol proposed from the name — check it", "symbol"))

        if row.quantity is not None and row.current_price is not None:
            row.value = row.quantity * row.current_price
        rows.append(row)

    checks: list[Check] = []
    totals_question = False

    # Totals.
    total = sum((r.value for r in rows if r.value is not None), Decimal(0))
    pv = parse(portfolio_value)
    complete = all(r.value is not None for r in rows)
    if pv is not None and rows:
        slack = pv.half_unit + abs(pv.value) * TOTAL_REL_TOLERANCE
        if complete and abs(total - pv.value) <= slack:
            checks.append(Check("total", "ok", f"Holdings add up to the screenshots' total value ({fmt(pv.value)})"))
        elif complete:
            diff = pv.value - total
            hint = "a holding may be missing or cut off" if diff > 0 else "a holding may be counted twice or misread"
            checks.append(
                Check(
                    "total",
                    "warn",
                    f"Holdings add up to {fmt(total)}, but the screenshots' total is {fmt(pv.value)} "
                    f"({fmt(abs(diff))} {'short' if diff > 0 else 'over'}) — {hint}",
                )
            )
            totals_question = True
        else:
            checks.append(Check("total", "info", f"The screenshots' total is {fmt(pv.value)}; fix the incomplete rows to compare"))
    elif rows:
        checks.append(Check("total", "info", "No overall total in the screenshots to check against"))

    pi = parse(portfolio_invested)
    if pi is not None and rows and all(r.buy_price is not None and r.quantity is not None for r in rows):
        cost = sum((r.quantity * r.buy_price for r in rows), Decimal(0))
        slack = pi.half_unit + abs(pi.value) * TOTAL_REL_TOLERANCE
        if abs(cost - pi.value) <= slack:
            checks.append(Check("invested", "ok", f"Buy prices add up to the invested total ({fmt(pi.value)})"))
        else:
            checks.append(Check("invested", "warn", f"Quantity × buy price adds up to {fmt(cost)}, but the screenshots say {fmt(pi.value)} invested"))

    if currency_seen and currency_seen.upper() != currency.upper():
        checks.append(Check("currency", "warn", f"The screenshots look like {currency_seen.upper()}, but this portfolio is in {currency}"))

    gone = sorted(set(previous) - {r.symbol for r in rows})
    if gone and rows:
        shown = ", ".join(gone[:8]) + (f" and {len(gone) - 8} more" if len(gone) > 8 else "")
        checks.append(Check("missing", "info", f"In the last snapshot but not in these screenshots: {shown}. They'll count as sold"))

    if not rows:
        checks.append(Check("empty", "error", "No holdings found in the screenshots"))

    return Verified(rows=rows, checks=checks, questions=questions, totals_question=totals_question)


def needs_recheck(v: Verified) -> bool:
    return bool(v.questions) or v.totals_question


def row_out(r: Row) -> dict:
    return {
        "id": r.id,
        "symbol": r.symbol,
        "symbol_basis": r.symbol_basis,
        "name": r.name,
        "asset_class": r.asset_class,
        "quantity": plain(r.quantity, QTY_PLACES) if r.quantity is not None else None,
        "buy_price": plain(r.buy_price, PRICE_PLACES) if r.buy_price is not None else None,
        "current_price": plain(r.current_price, PRICE_PLACES) if r.current_price is not None else None,
        "value": plain(r.value, 2) if r.value is not None else None,
        "printed": r.printed,
        "derived": r.derived,
        "rechecked": r.rechecked,
        "issues": [{"level": i.level, "field": i.field, "message": i.message} for i in r.issues],
    }
