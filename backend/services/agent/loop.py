"""The harness: one chat turn, or one approval, as a stream of events.

The browser holds the conversation (OpenAI chat format, aliases only) and
sends it with every request; nothing about a chat is stored on the server
except billed usage. A turn calls the model, runs its draft_parameters calls
(validate, resolve, sign), feeds the results back and repeats, at most
MAX_ROUNDS times. An approval runs the engine itself, then makes the model
write the report with write_report (forced), checking every number is a
figure token.

Events (each one SSE `data:` line):
  aliases {map}            alias -> real name, for the person's screen
  text {delta}             streamed reply text
  status {text}            "Checking the plan…", "Running the engine…"
  draft {draft}            a validated, signed draft for the approval table
  version {version}        an approved draft's results (narrative pending)
  report {n, narrative}    the agent's narrative for version n (tokens unrendered)
  usage {cost, chat?, today, cap}
  error {message}
  done {messages}          the messages to append to the conversation
"""

import json
import logging
import re
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import date

from pydantic import ValidationError

from config import settings
from schemas.wealth import Narrative
from services.agent import narrative as narr
from services.agent import usage
from services.agent.openrouter import Completion, LLMError, OpenRouter
from services.agent.prompt import TOOL_DRAFT, TOOL_REPORT, system_message
from services.agent.signing import sign
from services.agent.snapshot import Snapshot
from services.wealth import fmt
from services.wealth.params import check, pydantic_errors
from services.wealth.run import results_brief, run_version

log = logging.getLogger("agent.loop")

MAX_ROUNDS = 8
MAX_USER_MESSAGES = 40
APPROVE_MARK = re.compile(r"^\[approve (d\d+) v(\d+)\]")


@dataclass
class Ctx:
    tenant_id: uuid.UUID
    user_id: uuid.UUID
    snap: Snapshot
    prefs: dict
    today: date


def drafts_in(messages: list[dict]) -> int:
    n = 0
    for m in messages:
        if m["role"] == "tool" and m.get("content"):
            try:
                body = json.loads(m["content"])
            except ValueError:
                continue
            if isinstance(body, dict) and body.get("ok") and str(body.get("draft", "")).startswith("d"):
                n += 1
    return n


def versions_in(messages: list[dict]) -> int:
    return sum(1 for m in messages if m["role"] == "user" and APPROVE_MARK.match(m.get("content") or ""))


def user_messages(messages: list[dict]) -> int:
    return sum(1 for m in messages if m["role"] == "user" and not APPROVE_MARK.match(m.get("content") or ""))


def clean(messages: list[dict]) -> list[dict]:
    """The conversation as the model expects it: drop empty assistant turns and orphan tool results."""
    out, open_calls = [], set()
    for m in messages:
        if m["role"] == "assistant":
            calls = m.get("tool_calls") or []
            if not (m.get("content") or calls):
                continue
            open_calls = {c["id"] for c in calls}
            msg = {"role": "assistant", "content": m.get("content") or ""}
            if calls:
                msg["tool_calls"] = calls
            out.append(msg)
        elif m["role"] == "tool":
            if m.get("tool_call_id") in open_calls:
                out.append({"role": "tool", "tool_call_id": m["tool_call_id"], "content": m.get("content") or ""})
        else:
            out.append({"role": "user", "content": m.get("content") or ""})
    return out


class _Billing:
    def __init__(self, ctx: Ctx):
        self.ctx = ctx
        self.chat = 0.0

    def gate(self) -> str | None:
        return usage.cap_message() if usage.over_cap(self.ctx.tenant_id) else None

    def charge(self, c: Completion) -> dict:
        cost = usage.record(self.ctx.tenant_id, self.ctx.user_id, "chat", c.model or settings.agent_model, c.usage, c.generation_id)
        self.chat += cost
        return {"type": "usage", "cost": cost, "today": usage.spent_today(self.ctx.tenant_id), "cap": settings.agent_daily_cap_usd}


def _assistant(c: Completion) -> dict:
    msg: dict = {"role": "assistant", "content": c.content or ""}
    if c.tool_calls:
        msg["tool_calls"] = c.tool_calls
    return msg


def _draft_tool(ctx: Ctx, call: dict, number: int) -> tuple[dict, dict | None]:
    """(tool result for the model, signed draft for the screen or None)."""
    try:
        raw = json.loads(call["function"].get("arguments") or "{}")
    except ValueError:
        return {"ok": False, "errors": ["The arguments weren't valid JSON."]}, None
    draft, errors = check(raw, ctx.snap)
    if errors:
        return {"ok": False, "errors": errors}, None
    draft["id"] = f"d{number}"
    signed = sign(draft, str(ctx.tenant_id))
    result = {
        "ok": True,
        "draft": draft["id"],
        "pots": [
            {
                "currency": pot["currency"],
                "start": pot["start"],
                "horizon_years": pot["horizon_years"],
                "target": pot["target"],
                # As the person sees it ("₹50L"): a units slip (lakh vs crore) is easy to spot here.
                "shown_as": f"starts {fmt.money(pot['start'], pot['currency'])}"
                + (f", target {fmt.money(pot['target'], pot['currency'])}" if pot["target"] is not None else ""),
                "rate_options": pot["rate_options"],
                "segment_starts": {s["name"]: s["start"] for s in pot["segments"]} or None,
            }
            for pot in draft["pots"]
        ],
        "warnings": draft["warnings"],
        "note": (
            "The person now sees this plan as a table with an Approve & run button. Nothing has been calculated. "
            "Check shown_as against what they said; if an amount is off, draft again."
        ),
    }
    return result, signed


async def chat_turn(ctx: Ctx, history: list[dict], text: str, client: OpenRouter | None = None) -> AsyncIterator[dict]:
    client = client or OpenRouter()
    bill = _Billing(ctx)
    yield {"type": "aliases", "map": ctx.snap.display_map()}
    if user_messages(history) >= MAX_USER_MESSAGES:
        yield {"type": "error", "message": "This chat is getting long. Start a new chat; you can describe the latest version in one message."}
        yield {"type": "done", "messages": []}
        return

    system = system_message(ctx.snap.for_model(), ctx.prefs, ctx.today)
    convo = clean(history)
    new: list[dict] = [{"role": "user", "content": text}]
    drafts = drafts_in(history)
    said = False
    try:
        for _ in range(MAX_ROUNDS):
            if (msg := bill.gate()) is not None:
                yield {"type": "error", "message": msg}
                break
            completion = None
            gap = said  # a later round's text starts a new paragraph
            async for ev in client.chat([system, *convo, *new], tools=[TOOL_DRAFT]):
                if ev["type"] == "text":
                    if gap:
                        yield {"type": "text", "delta": "\n\n"}
                        gap = False
                    said = True
                    yield ev
                else:
                    completion = ev["completion"]
            assert completion is not None
            yield {**bill.charge(completion), "chat": bill.chat}
            new.append(_assistant(completion))
            if not completion.tool_calls:
                break
            for call in completion.tool_calls:
                if call["function"].get("name") != "draft_parameters":
                    result: dict = {"ok": False, "errors": ["Unknown tool. Use draft_parameters."]}
                else:
                    yield {"type": "status", "text": "Checking the plan against your accounts…"}
                    result, signed = _draft_tool(ctx, call, drafts + 1)
                    if signed is not None:
                        drafts += 1
                        yield {"type": "draft", "draft": signed}
                new.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result)})
            # Next round: the model reads the tool results and finishes its turn.
    except LLMError as exc:
        yield {"type": "error", "message": str(exc)}
    except Exception:
        log.exception("agent turn failed")
        yield {"type": "error", "message": "Something went wrong in the agent. Your conversation is kept; try again."}
    yield {"type": "done", "messages": new}


def fallback_headline(version: dict) -> str:
    """A plain answer per pot, from figure tokens only."""
    f = version["figures"]
    parts = []
    for r in version["pots"]:
        c = r["currency"]
        s = r["solve_for"]
        if s == "time":
            parts.append(f"you reach {{target:{c}}} by {{fi_date:{c}}}" if f"fi_date:{c}" in f else f"{{target:{c}}} is not reached within 60 years")
        elif s == "rate" and f"required_rate:{c}" in f:
            parts.append(f"{{target:{c}}} needs {{required_rate:{c}}} a year")
        elif s == "contribution" and f"required_contribution:{c}" in f:
            parts.append(f"{{target:{c}}} needs {{required_contribution:{c}}} a {r['answer'].get('per', 'month')}")
        else:
            parts.append(f"you reach {{final:{c}}} in {{horizon:{c}}}" if f"horizon:{c}" in f else f"the plan ends at {{final:{c}}}")
    text = "; ".join(parts)
    return f"On these assumptions {text}."


def fallback_narrative(version: dict) -> dict:
    head = fallback_headline(version)
    return {"headline": head, "insights": [], "watch_outs": [], "recommendations": [], "glossary": [], "chat_summary": head, "follow_ups": []}


async def approve_turn(ctx: Ctx, history: list[dict], draft: dict, client: OpenRouter | None = None) -> AsyncIterator[dict]:
    """`draft` is the signed draft, already verified (signature and tenant) by the router."""
    client = client or OpenRouter()
    bill = _Billing(ctx)
    yield {"type": "aliases", "map": ctx.snap.display_map()}
    n = versions_in(history) + 1
    yield {"type": "status", "text": "Running the engine…"}
    version = run_version(draft, ctx.snap, n)
    yield {"type": "version", "version": version}

    brief = results_brief(version)
    approve = {
        "role": "user",
        "content": (
            f"[approve {draft['id']} v{n}] I approved draft {draft['id']}. Nurav's engine ran it as version v{n}. "
            "Write the report with write_report, using only these figure tokens for numbers.\n"
            f"<results>\n{json.dumps(brief, indent=1, ensure_ascii=False)}\n</results>"
        ),
    }
    system = system_message(ctx.snap.for_model(), ctx.prefs, ctx.today)
    convo = [*clean(history), approve]
    new: list[dict] = [approve]
    figures = version["figures"]
    report = None
    yield {"type": "status", "text": "Writing the report…"}
    try:
        for attempt in range(2):
            if (msg := bill.gate()) is not None:
                yield {"type": "error", "message": msg}
                break
            completion = None
            async for ev in client.chat(
                [system, *convo], tools=[TOOL_REPORT], tool_choice={"type": "function", "function": {"name": "write_report"}}
            ):
                if ev["type"] == "done":
                    completion = ev["completion"]
            assert completion is not None
            yield {**bill.charge(completion), "chat": bill.chat}
            call = next((c for c in completion.tool_calls if c["function"].get("name") == "write_report"), None)
            errors: list[str]
            candidate = None
            if call is None:
                errors = ["Call write_report."]
            else:
                try:
                    candidate = Narrative.model_validate(json.loads(call["function"]["arguments"] or "{}")).model_dump()
                    errors = narr.problems(candidate, figures)
                except ValueError as exc:
                    errors = pydantic_errors(exc) if isinstance(exc, ValidationError) else ["The arguments weren't valid JSON."]
            if call is not None:
                convo.append(_assistant(completion))
                result = {"ok": not errors, **({"errors": errors} if errors else {"shown_as": f"v{n}"})}
                convo.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result)})
            if not errors:
                report = candidate
                break
            if attempt == 1 and candidate is not None:
                report = narr.scrub(candidate, figures, fallback_narrative(version)["headline"])
            elif call is None:
                convo.append({"role": "user", "content": "Please call write_report now."})
    except LLMError as exc:
        yield {"type": "error", "message": f"{exc} The numbers are complete; only the commentary is missing."}
    except Exception:
        log.exception("agent report failed")
        yield {"type": "error", "message": "The agent couldn’t write the commentary. The numbers are complete."}

    if report is None:
        report = fallback_narrative(version)
    # Keep the conversation short and well-formed: the approval, then the summary as the agent's reply.
    new.append({"role": "assistant", "content": report["chat_summary"]})
    yield {"type": "report", "n": n, "narrative": report}
    yield {"type": "done", "messages": new}
