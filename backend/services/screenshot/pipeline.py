"""Runs the chain and reports progress as events (streamed to the browser as NDJSON)."""

import asyncio
import logging
import re
from collections.abc import AsyncIterator
from datetime import date

from services.screenshot import agents
from services.screenshot.openrouter import LLMError, OpenRouter
from services.screenshot.verify import FIELDS, Verified, needs_recheck, row_out, verify

log = logging.getLogger("screenshot.pipeline")


def _stage(stage: str, text: str) -> dict:
    return {"type": "stage", "stage": stage, "text": text}


def _iso_date(text: str | None) -> str | None:
    if not text or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text.strip()):
        return None
    try:
        d = date.fromisoformat(text.strip())
    except ValueError:
        return None
    return d.isoformat() if d <= date.today() else None


def _apply_recheck(holdings: list[dict], answers: list[dict], missing: list[dict], totals: dict) -> int:
    """Fold re-read text back into the holdings. Returns how many values changed."""
    by_id = {h["id"]: h for h in holdings}
    changed = 0
    for a in answers:
        if not a.get("found") or a.get("text") in (None, ""):
            continue
        if a.get("id") == "total" or a.get("field") == "portfolio_value":
            if a["text"] != totals.get("portfolio_value"):
                totals["portfolio_value"] = a["text"]
                changed += 1
            continue
        h, f = by_id.get(a.get("id")), a.get("field")
        if h is None or f not in FIELDS:
            continue
        if h.get(f) != a["text"]:
            h[f] = a["text"]
            h.setdefault("rechecked", []).append(f)
            changed += 1
    known = {(h.get("symbol") or "").upper() for h in holdings}
    for m in missing:
        sym = (m.get("symbol") or "").strip().upper()
        if not sym or sym in known:
            continue
        holdings.append({**m, "id": f"h{len(holdings) + 1}", "symbol_basis": "proposed", "sources": ["recheck"], "rechecked": ["added"]})
        known.add(sym)
        changed += 1
    return changed


async def run(llm: OpenRouter, screenshots: list[list[str]], currency: str, previous: list[dict]) -> AsyncIterator[dict]:
    """`screenshots`: prepared image pieces per screenshot. `previous`: last snapshot's holdings."""
    cost = 0.0
    n = len(screenshots)
    try:
        # 1. Read every screenshot at once.
        yield _stage("reading", f"Reading {n} screenshot{'s' if n > 1 else ''}…")
        reads = await asyncio.gather(*(agents.read_screen(llm, pieces, i) for i, pieces in enumerate(screenshots, start=1)))
        cost += sum(r.cost for r in reads)
        readings = [r.args for r in reads]
        not_holdings = [i for i, r in enumerate(readings, start=1) if not r.get("is_holdings_screen", True)]
        if len(not_holdings) == n:
            yield {"type": "error", "message": "These don't look like holdings screens. Take the screenshot on the page that lists your holdings."}
            return
        rows_read = sum(len(r.get("rows") or []) for r in readings)
        yield _stage("read", f"Found {rows_read} row{'s' if rows_read != 1 else ''}")

        # 2. Merge, label and map to symbols.
        yield _stage("organising", "Matching rows to holdings and symbols…")
        org = await agents.organise(llm, readings, currency, [{k: h[k] for k in ("symbol", "name", "asset_class", "quantity")} for h in previous])
        cost += org.cost
        proposal = org.args
        holdings = [{**h, "id": f"h{i}"} for i, h in enumerate(proposal.get("holdings") or [], start=1)]
        totals = {"portfolio_value": proposal.get("portfolio_value"), "portfolio_invested": proposal.get("portfolio_invested")}
        prev_map = {h["symbol"]: h for h in previous}

        def check() -> Verified:
            return verify(holdings, totals["portfolio_value"], totals["portfolio_invested"], proposal.get("currency"), currency, prev_map)

        # 3. Check the arithmetic.
        yield _stage("checking", "Checking the numbers…")
        v = check()

        # 4. Re-read what doesn't add up, once.
        recheck_note = None
        if needs_recheck(v) and holdings:
            asked = len(v.questions)
            what = f"{asked} value{'s' if asked != 1 else ''}" if asked else "the total"
            yield _stage("rechecking", f"Some numbers don't add up — re-reading {what}…")
            current = [{k: h.get(k) for k in ("id", "symbol", "name", *FIELDS)} for h in holdings]
            rc = await agents.recheck(llm, screenshots, current, v.questions, v.totals_question)
            cost += rc.cost
            changed = _apply_recheck(holdings, rc.args.get("answers") or [], rc.args.get("missing_holdings") or [], totals)
            v = check()
            recheck_note = (
                f"Re-read {asked or 'the total'}: {changed} value{'s' if changed != 1 else ''} corrected"
                if changed
                else "Re-read: the screenshots say the same"
            )

        notes = [str(x)[:300] for x in (proposal.get("notes") or [])][:5]
        if not_holdings:
            notes.insert(0, f"Screenshot {', '.join(map(str, not_holdings))} didn't look like a holdings screen and was skipped")
        yield {
            "type": "result",
            "result": {
                "rows": [row_out(r) for r in v.rows],
                "checks": [{"kind": c.kind, "status": c.status, "message": c.message} for c in v.checks],
                "currency_seen": (proposal.get("currency") or None),
                "as_of_seen": _iso_date(proposal.get("as_of")),
                "notes": notes,
                "recheck": recheck_note,
                "screenshots": n,
                "model": org.model,
                "cost_usd": round(cost, 4),
            },
        }
    except LLMError as exc:
        yield {"type": "error", "message": str(exc)}
    except Exception:  # never leak internals (or image data) to the browser
        log.exception("screenshot import failed")
        yield {"type": "error", "message": "Something went wrong reading the screenshots. Try again."}
