"""A scripted stand-in for the model (AGENT_FAKE=1, and tests).

Served through httpx.MockTransport, so the real request building and SSE
parsing run. The script is deliberately simple:
- first message: ask which number is flexible (as a real agent would for a goal with all three);
- any later message: draft one pot per currency held (7% a year, 500 a month for
  10 years, target 1M in today's money, solving for time unless the start
  screen chose another unknown);
- after a successful draft: one closing sentence;
- write_report (forced): a narrative built only from figure tokens it was given.
"""

import json
import re

import httpx

# Tests set this to a list to see every request body the "model" received.
RECORD: list[dict] | None = None


def _sse(chunks: list[dict]) -> bytes:
    lines = [": OPENROUTER PROCESSING\n\n"]
    for c in chunks:
        lines.append(f"data: {json.dumps(c)}\n\n")
    lines.append("data: [DONE]\n\n")
    return "".join(lines).encode()


def _usage() -> dict:
    return {"prompt_tokens": 1200, "completion_tokens": 150, "total_tokens": 1350, "cost": 0.0}


def _text(text: str) -> bytes:
    words = re.findall(r"\S+\s*", text)
    chunks = [{"id": "gen-fake", "model": "fake/agent", "choices": [{"index": 0, "delta": {"content": w}}]} for w in words]
    chunks.append({"id": "gen-fake", "model": "fake/agent", "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}], "usage": _usage()})
    return _sse(chunks)


def _tool(name: str, args: dict, note: str = "") -> bytes:
    raw = json.dumps(args)
    half = len(raw) // 2
    chunks = []
    if note:
        chunks.append({"id": "gen-fake", "model": "fake/agent", "choices": [{"index": 0, "delta": {"content": note}}]})
    chunks += [
        {
            "id": "gen-fake",
            "model": "fake/agent",
            "choices": [
                {
                    "index": 0,
                    "delta": {
                        "tool_calls": [{"index": 0, "id": "call_fake", "type": "function", "function": {"name": name, "arguments": raw[:half]}}]
                    },
                }
            ],
        },
        {
            "id": "gen-fake",
            "model": "fake/agent",
            "choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "function": {"arguments": raw[half:]}}]}}],
        },
        {"id": "gen-fake", "model": "fake/agent", "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}], "usage": _usage()},
    ]
    return _sse(chunks)


def _between(text: str, tag: str) -> dict:
    m = re.search(rf"<{tag}>\n(.*?)\n</{tag}>", text, re.S)
    return json.loads(m.group(1)) if m else {}


def _pot(currency: str, solve: str, horizon: int | None) -> dict:
    return {
        "currency": currency,
        "solve_for": solve,
        "start_override": None,
        "exclude": [],
        "target": None if solve == "amount" else 1_000_000,
        "target_basis": "today",
        "horizon_years": None if solve == "time" else horizon or 20,
        "horizon_age": None,
        "rate": None if solve == "rate" else 7,
        "rate_options": None,
        "contribution": {"amount": 0, "per": "month", "years": None, "step_up": 0}
        if solve == "contribution"
        else {"amount": 500, "per": "month", "years": 10, "step_up": 0},
        "one_offs": [],
        "segments": [],
        "monthly_spending": None,
    }


def _draft_args(system: str) -> dict:
    snap = _between(system, "snapshot")
    ctx = _between(system, "context")
    choices = ctx.get("start_screen_choices")
    choices = choices if isinstance(choices, dict) else {}
    solve = choices.get("solve_for") or "time"
    currencies = [c["currency"] for c in snap.get("currencies") or []] or ["USD"]
    return {
        "title": "One million",
        "pots": [_pot(c, solve, choices.get("horizon_years")) for c in currencies[:4]],
        "inflation": 3,
        "compounding": 12,
        "risk_appetite": choices.get("risk_appetite"),
        "defaults": ["inflation", "compounding", "rate_options"],
    }


def _report(results: dict) -> dict:
    f = results.get("figures", {})
    heads = []
    for pot in results.get("pots", []):
        c = pot["currency"]
        if pot["question"].startswith("time") and f"fi_date:{c}" in f:
            heads.append(f"you reach {{target:{c}}} by {{fi_date:{c}}}")
        elif f"required_rate:{c}" in f:
            heads.append(f"{{target:{c}}} needs {{required_rate:{c}}} a year")
        elif f"required_contribution:{c}" in f:
            heads.append(f"{{target:{c}}} needs {{required_contribution:{c}}} a month")
        else:
            heads.append(f"you end with {{final:{c}}}")
    first = (results.get("pots") or [{"currency": "USD"}])[0]["currency"]
    spread = [f"{{{k}}}" for k in (f"time:{first}:1", f"time:{first}:3") if k in f]
    return {
        "headline": "On these assumptions " + "; ".join(heads) + ".",
        "insights": [f"You start from {{start:{first}}}."],
        "watch_outs": [
            "Returns are your assumption: across the three returns it takes between " + " and ".join(reversed(spread)) + "."
            if len(spread) == 2
            else "Returns are your assumption."
        ],
        "recommendations": ["Try a version with a bigger contribution and compare it with this one."],
        "glossary": [{"term": "Pot", "meaning": "Your money in one currency, planned on its own."}],
        "chat_summary": f"Version ready, starting from {{start:{first}}}. The report is on the right.",
        "follow_ups": ["What if I add more each year?", "What return would I need to get there in 10 years?"],
    }


def handle(request: httpx.Request) -> httpx.Response:
    if request.url.path.endswith("/audio/transcriptions"):
        return httpx.Response(200, json={"text": "I want one million in twenty years.", "usage": {"seconds": 3, "cost": 0.0}})
    body = json.loads(request.content)
    if RECORD is not None:
        RECORD.append(body)
    messages = body["messages"]
    system = messages[0]["content"][0]["text"] if isinstance(messages[0]["content"], list) else messages[0]["content"]
    if (body.get("tool_choice") or {}).get("function", {}).get("name") == "write_report":
        last = next(m for m in reversed(messages) if m["role"] == "user")
        return httpx.Response(
            200, content=_tool("write_report", _report(_between(last["content"], "results"))), headers={"content-type": "text/event-stream"}
        )
    last = messages[-1]
    if last["role"] == "tool":
        ok = json.loads(last["content"]).get("ok")
        text = "Here's the plan. Press Approve & run when it looks right." if ok else "That didn't check out; let me know what to change."
        return httpx.Response(200, content=_text(text), headers={"content-type": "text/event-stream"})
    users = [m for m in messages if m["role"] == "user"]
    if len(users) == 1:
        text = (
            "Happy to help. You've given a target, a time and a return, so there's nothing left to find. Which one is flexible: "
            "when you'd get there, how much you'd end with, or the return you'd need? Each currency you hold is its own pot."
        )
        return httpx.Response(200, content=_text(text), headers={"content-type": "text/event-stream"})
    return httpx.Response(
        200, content=_tool("draft_parameters", _draft_args(system), "I'll put that together. "), headers={"content-type": "text/event-stream"}
    )


class FakeTransport(httpx.MockTransport):
    def __init__(self) -> None:
        # Looked up per request, so tests can swap the script.
        super().__init__(lambda request: handle(request))
