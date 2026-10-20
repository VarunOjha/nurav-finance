"""Keep the agent's report honest: numbers only by figure token.

The model writes {final_nominal}, never "$6.4M". `problems` lists unknown
tokens and any typed money, percentage or magnitude outside a token, so the
model can be asked to fix them once; `scrub` drops whatever still breaks the
rule, so a typed number never reaches the report. Years ("2056") and plain
counts ("6 months", "2 points") are fine.
"""

import re

TOKEN = re.compile(r"\{([a-z_0-9]+(?::[^{}:]+)*)\}")
_RAW = [
    re.compile(r"[$€£₹¥]\s?\d"),
    re.compile(r"\d\s?(%|percent\b|per cent\b)", re.I),
    re.compile(r"\b\d{1,3}(?:,\d{2,3})+\b"),
    re.compile(r"\b\d+(?:\.\d+)?\s?(?:k|m|bn|b|t|mn|million|billion|trillion|thousand|lakh|lakhs|crore|crores|cr|l)\b", re.I),
    re.compile(r"\b(?:USD|EUR|GBP|INR|JPY|SGD|AUD|CAD|AED|CHF)\s?\d"),
]
TEXT_FIELDS = ("headline", "chat_summary")
LIST_FIELDS = ("insights", "watch_outs", "recommendations")


def _raw_numbers(text: str) -> list[str]:
    bare = TOKEN.sub("", text)
    hits = []
    for rx in _RAW:
        hits += [m.group(0) for m in rx.finditer(bare)]
    return hits


def _texts(n: dict):
    for f in TEXT_FIELDS:
        yield f, n.get(f) or ""
    for f in LIST_FIELDS:
        for i, t in enumerate(n.get(f) or []):
            yield f"{f}[{i}]", t
    for i, g in enumerate(n.get("glossary") or []):
        yield f"glossary[{i}]", g.get("meaning", "")


def problems(n: dict, figures: dict[str, str]) -> list[str]:
    out = []
    for where, text in _texts(n):
        unknown = [t for t in TOKEN.findall(text) if t not in figures]
        if unknown:
            out.append(f"{where}: unknown token(s) {', '.join('{' + t + '}' for t in unknown)}; use only the figure names you were given.")
        raw = _raw_numbers(text)
        if raw:
            out.append(f"{where}: typed number(s) {', '.join(repr(r) for r in raw)}; replace each with a figure token.")
    return out


def _ok(text: str, figures: dict[str, str]) -> bool:
    return not _raw_numbers(text) and all(t in figures for t in TOKEN.findall(text))


def scrub(n: dict, figures: dict[str, str], fallback_headline: str) -> dict:
    """Drop any sentence-level item that still breaks the rule."""
    out = dict(n)
    for f in LIST_FIELDS:
        out[f] = [t for t in n.get(f) or [] if _ok(t, figures)]
    out["glossary"] = [g for g in n.get("glossary") or [] if _ok(g.get("meaning", ""), figures)]
    if not _ok(out.get("headline", ""), figures):
        out["headline"] = fallback_headline
    if not _ok(out.get("chat_summary", ""), figures):
        out["chat_summary"] = fallback_headline
    return out


def render(text: str, figures: dict[str, str], names: dict[str, str] | None = None) -> str:
    """Fill tokens, then (for saved reports) swap aliases for real names."""
    text = TOKEN.sub(lambda m: figures.get(m.group(1), m.group(0)), text)
    if names:
        text = swap_aliases(text, names)
    return text


def swap_aliases(text: str, names: dict[str, str]) -> str:
    if not names:
        return text
    # Longest first so "Account AA" isn't caught by "Account A".
    rx = re.compile(r"\b(" + "|".join(re.escape(a) for a in sorted(names, key=len, reverse=True)) + r")\b")
    return rx.sub(lambda m: names[m.group(1)], text)


def render_all(n: dict, figures: dict[str, str], names: dict[str, str] | None = None) -> dict:
    out = dict(n)
    for f in TEXT_FIELDS:
        if out.get(f):
            out[f] = render(out[f], figures, names)
    for f in LIST_FIELDS + ("follow_ups",):
        out[f] = [render(t, figures, names) for t in n.get(f) or []]
    out["glossary"] = [{**g, "meaning": render(g.get("meaning", ""), figures, names)} for g in n.get("glossary") or []]
    return out
