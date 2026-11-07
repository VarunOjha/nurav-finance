"""Numbers as brokers print them: ₹1,23,456.70 · $12,345.6 · 1.2L · 3.4 Cr · (450.20) · −12.5.

`parse` returns the value and how precisely it was printed, so checks can
allow for rounding: "1.2L" only says 1,15,000-1,25,000; "1,20,000.00" is exact
to the paisa.
"""

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

# Longest first, so "lakhs" wins over "l" and "crore" over "cr".
_SUFFIXES = [
    ("crores", 10**7),
    ("crore", 10**7),
    ("lakhs", 10**5),
    ("lakh", 10**5),
    ("lacs", 10**5),
    ("lac", 10**5),
    ("cr", 10**7),
    ("mn", 10**6),
    ("bn", 10**9),
    ("k", 10**3),
    ("l", 10**5),
    ("m", 10**6),
    ("b", 10**9),
]
_CURRENCY = re.compile(r"(rs\.?|inr|usd|us\$|eur|gbp|sgd|aed|cad|aud|[₹$€£¥])", re.IGNORECASE)
_NUMBER = re.compile(r"^\d+(\.\d+)?$")


@dataclass(frozen=True)
class Parsed:
    value: Decimal
    # Half of the last printed digit, after any suffix: "1.2L" → 5,000; "16.50" → 0.005.
    half_unit: Decimal
    abbreviated: bool = False


def parse(text: str | None) -> Parsed | None:
    """The number in `text`, or None if it isn't a plain amount (blank, a percentage, words)."""
    if text is None:
        return None
    s = str(text).strip().replace(" ", " ").replace("−", "-").replace("–", "-")
    if not s or "%" in s:
        return None
    negative = False
    if s.startswith("(") and s.endswith(")"):
        negative, s = True, s[1:-1]
    s = _CURRENCY.sub("", s).strip()
    if s.startswith("+"):
        s = s[1:].strip()
    elif s.startswith("-"):
        negative, s = True, s[1:].strip()
    s = _CURRENCY.sub("", s).strip()  # "-₹1,200" and "₹-1,200"
    multiplier = 1
    lower = s.lower().rstrip(".")
    for suffix, factor in _SUFFIXES:
        if lower.endswith(suffix) and re.search(r"\d\s*" + suffix + "$", lower):
            multiplier, s = factor, lower[: -len(suffix)].strip()
            break
    s = s.replace(",", "").replace(" ", "")
    if not _NUMBER.match(s):
        return None
    try:
        value = Decimal(s)
    except InvalidOperation:
        return None
    places = len(s.split(".")[1]) if "." in s else 0
    half = Decimal(5) * Decimal(10) ** -(places + 1) * multiplier
    value *= multiplier
    return Parsed(-value if negative else value, half, abbreviated=multiplier != 1)


def plain(d: Decimal, places: int) -> str:
    """Decimal → plain string with at most `places` decimals, trailing zeros trimmed."""
    q = d.quantize(Decimal(10) ** -places)
    s = format(q, "f")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s or "0"
