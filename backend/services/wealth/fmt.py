"""Display strings for figures the agent quotes by token.

Close to the browser's Intl formatting (lib/format.ts): narrow currency
symbols, compact amounts with at most one decimal ("$6.4M", "$802K"), INR in
lakh / crore. These strings are what the person reads in the report, so they
are produced here once rather than typed by the model.
"""

SYMBOLS = {"USD": "$", "EUR": "€", "GBP": "£", "INR": "₹", "JPY": "¥", "SGD": "$", "AUD": "$", "CAD": "$", "AED": "AED ", "CHF": "CHF "}


def _trim(x: float) -> str:
    s = f"{x:.1f}"
    return s[:-2] if s.endswith(".0") else s


def money(value: float, currency: str, compact: bool = True) -> str:
    sign = "−" if value < 0 else ""
    v = abs(value)
    sym = SYMBOLS.get(currency, f"{currency} ")
    if not compact:
        return f"{sign}{sym}{v:,.0f}"
    if currency == "INR":
        steps = ((1e7, "Cr"), (1e5, "L"), (1e3, "K"))
    else:
        steps = ((1e12, "T"), (1e9, "B"), (1e6, "M"), (1e3, "K"))
    for size, suffix in steps:
        # Round first so 999,960 shows as "$1M", not "$1000K".
        if round(v / size, 1) >= 1:
            return f"{sign}{sym}{_trim(v / size)}{suffix}"
    return f"{sign}{sym}{v:,.0f}"


def signed_money(value: float, currency: str) -> str:
    if abs(value) < 0.5:
        return money(0, currency)
    return ("+" if value > 0 else "") + money(value, currency)


def pct(value: float, digits: int = 1) -> str:
    """A percentage given in percent units (8 -> "8%", 9.37 -> "9.4%")."""
    s = f"{value:.{digits}f}"
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return f"{s}%"


def share(value: float) -> str:
    """A fraction as a whole percentage (0.412 -> "41%")."""
    return f"{round(value * 100)}%"


MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def month_label(year: int, month: int) -> str:
    return f"{MONTHS[month - 1]} {year}"
