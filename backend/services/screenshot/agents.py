# ruff: noqa: E501  (prompts are prose; wrapping them only adds noise)
"""The model steps: reader, organiser and recheck. Each is one forced tool call.

They copy and choose text; they never calculate. Numbers stay as printed
("₹1,23,456.70", "1.2L") and are parsed by numbers.py.
"""

import json

from services.screenshot.openrouter import OpenRouter, ToolResult

ASSET_CLASSES = ["stock", "etf", "mutual_fund", "bond", "cash", "crypto", "other"]
_TEXT = {"type": ["string", "null"]}

# ── 1. Reader ────────────────────────────────────────────────────────────────

READER_SYSTEM = """You transcribe a screenshot of an investment account's holdings screen (a broker's or fund platform's app or website). You copy what is printed. You never calculate, round, convert, reformat or guess a value.

- The screenshot may arrive as several image parts, top to bottom, that overlap a little. A row inside an overlap appears in two parts: transcribe it once.
- For every holding row copy: the main label (ticker, or the stock/fund name as printed), any secondary line under it, and every number in the row with the column heading or caption it belongs to. Copy numbers exactly as printed, with currency symbols, commas, signs, % and suffixes such as L, Cr or K.
- Phone apps often print captions inline ("Qty. 10 · Avg. 1,520.40", "LTP 1,610.10", "Invested 15,204"). Use the caption as the label. If a number has no caption, describe where it sits, e.g. "right, top line".
- Set partial to true for a row that is cut off by the edge of the screenshot.
- Copy the summary figures (current value, invested, total returns, day's change and so on) with their labels.
- Copy any date or time that says when the figures are from.
- Never copy personal identifiers: account or client IDs, people's names, emails, phone numbers.
- If this isn't a holdings screen, set is_holdings_screen to false and leave rows empty."""

READER_TOOL = {
    "type": "function",
    "function": {
        "name": "record_screen",
        "description": "Everything printed on the holdings screen, verbatim.",
        "parameters": {
            "type": "object",
            "properties": {
                "is_holdings_screen": {"type": "boolean"},
                "platform": {**_TEXT, "description": "Broker or app name if printed, else null"},
                "currency_symbols": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Currency symbols or codes printed, e.g. ₹, $, USD",
                },
                "date_text": {**_TEXT, "description": "Date/time the figures are as of, exactly as printed, or null"},
                "column_headings": {"type": "array", "items": {"type": "string"}},
                "rows": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string", "description": "Ticker or name as printed"},
                            "secondary": {**_TEXT, "description": "Second line under the label, if any"},
                            "values": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {"label": {"type": "string"}, "text": {"type": "string"}},
                                    "required": ["label", "text"],
                                },
                            },
                            "partial": {"type": "boolean"},
                        },
                        "required": ["label", "values", "partial"],
                    },
                },
                "totals": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {"label": {"type": "string"}, "text": {"type": "string"}},
                        "required": ["label", "text"],
                    },
                },
            },
            "required": ["is_holdings_screen", "rows", "totals", "currency_symbols", "column_headings"],
        },
    },
}


def _images(urls: list[str]) -> list[dict]:
    return [{"type": "image_url", "image_url": {"url": u}} for u in urls]


async def read_screen(llm: OpenRouter, pieces: list[str], number: int) -> ToolResult:
    intro = f"Screenshot {number}" + (f", in {len(pieces)} overlapping parts, top to bottom." if len(pieces) > 1 else ".")
    return await llm.tool_call(READER_SYSTEM, [{"type": "text", "text": intro}, *_images(pieces)], READER_TOOL)


# ── 2. Organiser ─────────────────────────────────────────────────────────────

ORGANISER_SYSTEM = """You turn transcriptions of holdings screenshots into one list of holdings for a portfolio held in {currency}. You choose text from the transcriptions; you never calculate, round or reformat a number.

- Screenshots taken while scrolling overlap, so the same holding can appear in two of them. Merge those into one holding and list every source row id.
- For each holding, copy the exact text (for example "₹1,23,456.70" or "1.2L") for:
  - quantity: units or shares held
  - buy_price: average cost per unit ("Avg", "Avg. cost", "Buy avg")
  - current_price: today's price per unit ("LTP", "Last price", "Price", "NAV", "Market price")
  - value: the holding's current total value ("Current", "Current value", "Market value", "Value")
  - invested: the holding's total cost ("Invested", "Cost", "Total cost")
  Use null when it isn't printed. Profit/loss, returns, day change and percentages are none of these.
- Per-unit versus total: decide from the labels. "Avg" and "LTP" are per unit; "Invested", "Current" and "Value" are totals. Never put a total in a per-unit field.
- symbol: if the holding is one from the previous snapshot (the same company or fund, even if the name is shortened differently), use that symbol and set symbol_basis to "previous". Otherwise, if a ticker is printed, use it in capitals ("shown"). Otherwise propose a short ticker-like symbol of A-Z, 0-9, ".", "-" or "&", at most 24 characters ("proposed"). Each symbol only once.
- name: the full name if printed, else null. asset_class: one of {classes}.
- portfolio_value / portfolio_invested: the screenshots' overall current value and invested totals, exact text, or null. If several screenshots repeat the same total, give it once.
- currency: ISO code of the currency the screenshots show, or null if unclear.
- as_of: the date the screenshots show as YYYY-MM-DD, only if unambiguous, else null.
- notes: at most 5 short, plain-English observations the person should know, for example "Screenshot 2 seems to be from a different account". No notes about things that are fine, and none about totals, arithmetic or holdings missing since the previous snapshot: the app checks those itself."""

ORGANISER_TOOL = {
    "type": "function",
    "function": {
        "name": "propose_holdings",
        "description": "The holdings found across all screenshots.",
        "parameters": {
            "type": "object",
            "properties": {
                "holdings": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "symbol": {"type": "string"},
                            "symbol_basis": {"type": "string", "enum": ["previous", "shown", "proposed"]},
                            "name": _TEXT,
                            "asset_class": {"type": "string", "enum": ASSET_CLASSES},
                            "quantity": _TEXT,
                            "buy_price": _TEXT,
                            "current_price": _TEXT,
                            "value": _TEXT,
                            "invested": _TEXT,
                            "sources": {"type": "array", "items": {"type": "string"}, "description": "Source row ids, e.g. s1r3"},
                        },
                        "required": ["symbol", "symbol_basis", "asset_class", "quantity", "current_price", "value", "sources"],
                    },
                },
                "portfolio_value": _TEXT,
                "portfolio_invested": _TEXT,
                "currency": _TEXT,
                "as_of": _TEXT,
                "notes": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["holdings", "currency", "as_of", "notes"],
        },
    },
}


def readings_for_prompt(readings: list[dict]) -> list[dict]:
    """Give every transcribed row a stable id (s<screenshot>r<row>) for the organiser to cite."""
    out = []
    for i, r in enumerate(readings, start=1):
        rows = [{"id": f"s{i}r{j}", **row} for j, row in enumerate(r.get("rows") or [], start=1)]
        out.append({"screenshot": i, **{k: v for k, v in r.items() if k != "rows"}, "rows": rows})
    return out


async def organise(llm: OpenRouter, readings: list[dict], currency: str, previous: list[dict]) -> ToolResult:
    system = ORGANISER_SYSTEM.format(currency=currency, classes=", ".join(ASSET_CLASSES))
    prompt = (
        f"Portfolio currency: {currency}\n\n"
        f"Previous snapshot holdings (symbol, name, asset class, quantity):\n{json.dumps(previous, ensure_ascii=False)}\n\n"
        f"Transcriptions:\n{json.dumps(readings_for_prompt(readings), ensure_ascii=False)}"
    )
    return await llm.tool_call(system, prompt, ORGANISER_TOOL)


# ── 4. Recheck ───────────────────────────────────────────────────────────────

RECHECK_SYSTEM = """You double-check specific values in holdings screenshots, because the numbers read from them don't add up. Look at the screenshots again carefully.

- For each question, report the exact text printed for that field of that holding, as printed (with commas and symbols). Copy; don't calculate. If you can't find it, set text to null and found to false.
- If you're asked about the totals, also list any holding rows that are visible in the screenshots but missing from the list you're given, copying their figures exactly.
- Never copy personal identifiers (account or client IDs, people's names, emails, phone numbers)."""

RECHECK_TOOL = {
    "type": "function",
    "function": {
        "name": "report_recheck",
        "description": "Exact re-reads of the questioned cells, and any rows that were missed.",
        "parameters": {
            "type": "object",
            "properties": {
                "answers": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "field": {"type": "string", "enum": ["quantity", "buy_price", "current_price", "value", "invested", "portfolio_value"]},
                            "text": _TEXT,
                            "found": {"type": "boolean"},
                        },
                        "required": ["id", "field", "text", "found"],
                    },
                },
                "missing_holdings": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "symbol": {"type": "string", "description": "Ticker if printed, else a short proposed one"},
                            "name": _TEXT,
                            "asset_class": {"type": "string", "enum": ASSET_CLASSES},
                            "quantity": _TEXT,
                            "buy_price": _TEXT,
                            "current_price": _TEXT,
                            "value": _TEXT,
                            "invested": _TEXT,
                        },
                        "required": ["symbol", "asset_class", "quantity", "current_price", "value"],
                    },
                },
            },
            "required": ["answers", "missing_holdings"],
        },
    },
}


async def recheck(llm: OpenRouter, pieces: list[list[str]], holdings: list[dict], questions: list[dict], totals_question: bool) -> ToolResult:
    content: list[dict] = []
    for i, p in enumerate(pieces, start=1):
        content.append({"type": "text", "text": f"Screenshot {i}" + (f" ({len(p)} overlapping parts, top to bottom)" if len(p) > 1 else "")})
        content.extend(_images(p))
    ask = (
        f"Holdings as currently read:\n{json.dumps(holdings, ensure_ascii=False)}\n\n"
        f"Questions (id = holding id, field = what to re-read):\n{json.dumps(questions, ensure_ascii=False)}"
    )
    if totals_question:
        ask += '\n\nThe holdings don\'t add up to the screenshots\' total value: re-read the total (id "total", field "portfolio_value") and list any missing holdings.'
    content.append({"type": "text", "text": ask})
    return await llm.tool_call(RECHECK_SYSTEM, content, RECHECK_TOOL)
