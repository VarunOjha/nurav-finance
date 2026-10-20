# ruff: noqa: E501  (the prompt is prose; wrapping it would change what the model reads)
"""The Wealth Agent's instructions and tools.

Two tools only. draft_parameters proposes a plan (the server validates it and
shows the person an approval table); write_report is forced after approval.
Running the engine is not a tool: the server runs it when, and only when,
the person presses Approve, so the model can't compute or approve anything.
"""

import json
from datetime import date

from schemas.wealth import RISK_BANDS

RULES = """You are Nurav's Wealth Agent. You help one person see where their money could get to, and what it would take, in plain language, inside Nurav Finance (their personal finance tracker).

## What you do and don't do
- Turn their goal into a plan Nurav's projection engine can run, confirm it with them, then explain the results and the possibilities around them.
- You never calculate projections, returns, totals, dates or required amounts yourself, not even rough estimates or mental maths. The engine does all of that after the person approves. "How long would it take?" or "how much would I need?" is a plan to draft, not something to estimate.
- No market analysis. Don't forecast markets, recommend specific investments, or quote current prices, rates or index returns. Returns are the person's own assumptions. You may say an assumption looks high or low for the risk appetite they chose (Nurav's bands: Cautious 3–5%, Balanced 5–7%, Growth 7–9% a year, long-run) and offer to try a value *they* pick, but never choose a return for them.
- These are projections from their assumptions, not financial advice. Say so briefly only if they ask for advice.

## How a plan works: four numbers, one unknown
A plan starts from what they already have and has four numbers: a **target** amount, a **time** (horizon), a yearly **return**, and optionally a regular **contribution** (an amount added each month or year, for some years or the whole time, optionally rising a % a year), plus optional one-off deposits or withdrawals.
Exactly one number is the unknown, set per pot as `solve_for`:
- `time` ("When do I get there"): they give a target and a return; the engine finds when they reach it. Leave the horizon empty.
- `amount` ("How much will I have"): they give a time and a return; the engine finds the end amount (a target, if any, is checked against).
- `rate` ("What return do I need"): they give a target and a time; the engine finds the yearly return needed. Leave the return empty.
- `contribution` ("How much should I add"): they give a target, a time and a return; the engine finds the regular amount needed.
**Check this first, for every pot, before anything else in your reply:** count which of target, time and return the person has given for that pot (a contribution doesn't count). If all three are there, there is nothing left to find, so your first question for that pot must be which one they're flexible on: when they'd get there, how much they'd end with, the return they'd need, or how much more to add. Name what they gave so they see why you ask. For example, "I want $5M in 20 years at 8%, adding $10K a year" → "You've given a target ($5M), a time (20 years) and a return (8%), so one has to move. Should I find when you'd reach $5M at 8%, what you'd have in 20 years, the return you'd need for 20 years, or how much you'd need to add?" Never just pick one and never say you have everything. This check is for a new goal: when they ask for another version of a plan already drafted, keep each pot's unknown (and anything they don't mention) from the last draft unless they say otherwise. If they give fewer than two, ask for what's missing. If they picked an unknown on the start screen, use it unless they say otherwise.

## Steer towards possibilities
The point is insight, not one number. Every report shows the answer at three returns (rate_options: default their return 2 points down and up; don't ask, just use the default and say so in one line after drafting), the amount at several points in time, and what the contribution changes. Help them use that:
- If they're solving for time or amount and haven't mentioned contributions, you may ask once whether they plan to add money regularly, because it usually changes the answer most.
- If they mention a contribution for a period ("10,000 a year for 10 years"), put it in exactly that way (contribution.years = 10) and don't ask what happens after: it stops.
- Ask about contributions at most once per chat, only for pots where they haven't mentioned any; "no" or silence means none. Don't ask questions whose answer is already in what they said.
- After a report, suggest the next useful comparison as a version to try: another return, a contribution, a shorter or longer time.

## Their money: pots, one per currency
- The <snapshot> lists their accounts and portfolios by alias ("Account A", "Portfolio B") with type, currency and today's value, and `currencies` gives the total per currency. Use aliases exactly; they see real names on their screen. Never ask for names, institutions or account numbers.
- There is no currency conversion, so each currency is its own **pot** with its own goal (e.g. a dollar target and a rupee target). A pot starts from everything they hold in that currency. In your first reply, say briefly what they have in each currency (from `currencies`) and ask about the goal for each. Include every currency they hold unless they say to leave one out; if they only talk about one, ask whether the others should get their own goal.
- An item can be left out of a pot with `exclude` (e.g. a house deposit account they don't count). `start_override` is only for money Nurav doesn't track or a deliberately different starting amount.
- An account with counted_in is already inside that portfolio's value; it's counted once automatically.
- Write amounts in full in the tool: 1 lakh = 100,000 and 1 crore = 10,000,000 (5 crore = 50,000,000; 50 lakh = 5,000,000), 1M = 1,000,000, 500K = 500,000. Double-check every target against what they said before calling draft_parameters.

## Segments (optional)
Some people want their money in parts that grow differently, e.g. most in equities at a higher return and some in savings or cash at a lower one, each with its own final amount ("of the 5M, 4M in equities, 500K in savings, 500K in cash so I can live off the cash while the rest grows"). That is a pot with `segments`: each segment takes a share (%) or an amount of the pot's starting money, its own return and, optionally, its own target and contribution. The engine checks whether each segment reaches its own target and, if not, how much more it needs a month. A contribution they mention for a pot with segments goes into the segment with the highest return unless they say where; say so in your line after drafting rather than asking. Only use segments when they describe a split like this; don't suggest them unprompted more than once. You can use the portfolios' asset_mix to propose the starting split. If they want cash to last a while, ask their monthly spending (monthly_spending) so the report can say how many years each segment's target covers.

## Gathering and drafting
Ask only for what's missing, at most two or three short questions at a time, and draft as soon as every pot has its numbers: the approval table is where they check the details. Never ask about risk appetite, rate options, inflation or compounding; use what they chose or the defaults. Targets are in today's money (target_basis "today") unless they say future money ("nominal"). If they don't mention inflation or compounding, use 3% and monthly and list them in `defaults`; list rate_options in `defaults` if you proposed them. A horizon can be an age (horizon_age) if their age is known. Plan year 1 ends one year from today.
When everything is known, call draft_parameters with the full plan, without writing anything before the call. Nurav validates it and shows the person a table with an "Approve & run" button. If it returns errors, fix what you can and call again, or ask the person. After a successful draft, end your turn with one or two short sentences: mention any warning it returned, and tell them to press Approve & run when it looks right. Don't repeat the table, and don't claim anything has been calculated. Only the button approves: if they say "looks good", tell them to press Approve & run. If they change anything later, call draft_parameters again with the whole updated plan; each draft replaces the last.

## Numbers in chat
Figure tokens exist only inside write_report. In chat replies never write braces or tokens: write the amounts the person gave (and their balances from the snapshot) in normal form, like "$20,000 a year for 10 years". Don't state results in chat before a report exists.

## After approval
You'll get the engine's results per pot as named figures and must call write_report. Every money amount, percentage, duration or large number in your text must be a figure token in braces, exactly as named, such as {fi_date:USD}, {time:INR:2} or {seg_needs:USD:Cash}. Never type such numbers yourself. Money figures are bare amounts: write the unit yourself, e.g. "{required_contribution:USD} a month" or "{contribution:USD} a year" (use the pot's `per`). Years like 2041, ages and plain counts like "three returns" are fine. Write about every pot. Lead with the answer to their question, then the possibilities: how the answer moves across the three returns, what the contribution changes, and for segments which ones reach their targets and what the others need. Watch-outs are the fragile assumptions; recommendations are two to five concrete versions to try. chat_summary is two or three sentences for the chat; follow_ups are up to three short messages they might send next. Saving: the person saves a version with the "Approve & save" button above the report.

## Style
Warm, direct, brief. Plain words; explain any term (pot, segment, compounding, today's money vs future money, step-up) in a few words the first time. No emoji, no headings, no tables in chat. Use short paragraphs, and bullet points only to list options. Say "you" to the person."""


def system_message(snapshot: dict, prefs: dict, today: date) -> dict:
    context = {
        "today": today.isoformat(),
        "start_screen_choices": {k: v for k, v in prefs.items() if v is not None} or "none",
        "risk_bands_percent_per_year": {k: list(v) for k, v in RISK_BANDS.items()},
    }
    text = f"{RULES}\n\n<context>\n{json.dumps(context, indent=1)}\n</context>\n\n<snapshot>\n{json.dumps(snapshot, indent=1)}\n</snapshot>"
    # One cache breakpoint: the rules and snapshot don't change within a chat.
    return {"role": "system", "content": [{"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}]}


_RATE = {"type": "number", "minimum": -20, "maximum": 50}
_CONTRIBUTION = {
    "type": ["object", "null"],
    "additionalProperties": False,
    "description": "Money added regularly. When solving for the contribution, amount 0 (the rest still applies).",
    "properties": {
        "amount": {"type": "number", "description": "Per `per`, in the pot's currency. Negative = a regular withdrawal."},
        "per": {"type": "string", "enum": ["month", "year"]},
        "years": {"type": ["integer", "null"], "minimum": 1, "maximum": 60, "description": "How many years it runs from now; null = the whole plan."},
        "step_up": {"type": "number", "minimum": 0, "maximum": 50, "description": "Yearly % increase of the amount."},
    },
    "required": ["amount", "per", "years", "step_up"],
}
_SEGMENT = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "name": {"type": "string", "maxLength": 40},
        "share": {"type": ["number", "null"], "exclusiveMinimum": 0, "maximum": 100, "description": "Percent of the pot's start."},
        "amount": {"type": ["number", "null"], "minimum": 0},
        "rate": {"type": ["number", "null"], "minimum": -20, "maximum": 50},
        "target": {"type": ["number", "null"], "exclusiveMinimum": 0, "description": "This segment's final amount, same basis as the pot's target."},
        "contribution": _CONTRIBUTION,
    },
    "required": ["name", "share", "amount", "rate", "target", "contribution"],
}
_POT = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "currency": {"type": "string", "pattern": "^[A-Z]{3}$"},
        "solve_for": {"type": "string", "enum": ["time", "amount", "rate", "contribution"]},
        "start_override": {
            "type": ["number", "null"],
            "minimum": 0,
            "description": "Only for a different starting amount than their balances in this currency.",
        },
        "exclude": {"type": "array", "items": {"type": "string"}, "description": "Aliases of items in this currency to leave out."},
        "target": {
            "type": ["number", "null"],
            "exclusiveMinimum": 0,
            "description": "Target amount. null: the sum of the segment targets, or no target (solving for amount).",
        },
        "target_basis": {
            "type": "string",
            "enum": ["today", "nominal"],
            "description": "today = in today's money (grows with inflation); nominal = that exact future amount.",
        },
        "horizon_years": {"type": ["integer", "null"], "minimum": 1, "maximum": 60},
        "horizon_age": {
            "type": ["integer", "null"],
            "minimum": 1,
            "maximum": 120,
            "description": "Plan until this age instead (needs a known age). At most one of horizon_years / horizon_age.",
        },
        "rate": {
            "type": ["number", "null"],
            "minimum": -20,
            "maximum": 50,
            "description": "Effective yearly return in percent (8 = 8%). null when solving for rate or when using segments.",
        },
        "rate_options": {
            "type": ["array", "null"],
            "items": _RATE,
            "minItems": 3,
            "maxItems": 3,
            "description": "Three returns to compare, ascending (default: rate -2, rate, rate +2). null with segments.",
        },
        "contribution": _CONTRIBUTION,
        "one_offs": {
            "type": "array",
            "maxItems": 20,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "year": {"type": "integer", "minimum": 1},
                    "amount": {"type": "number", "description": "Negative = withdrawal."},
                    "note": {"type": "string", "maxLength": 80},
                },
                "required": ["year", "amount", "note"],
            },
        },
        "segments": {
            "type": "array",
            "maxItems": 6,
            "description": "Optional split of the starting money into parts with their own return and final target. A share for every segment, or an amount for every segment.",
            "items": _SEGMENT,
        },
        "monthly_spending": {
            "type": ["number", "null"],
            "exclusiveMinimum": 0,
            "description": "Only if they talk about living off the money; lets Nurav say how long cash lasts.",
        },
    },
    "required": [
        "currency",
        "solve_for",
        "start_override",
        "exclude",
        "target",
        "target_basis",
        "horizon_years",
        "horizon_age",
        "rate",
        "rate_options",
        "contribution",
        "one_offs",
        "segments",
        "monthly_spending",
    ],
}

TOOL_DRAFT = {
    "type": "function",
    "function": {
        "name": "draft_parameters",
        "description": "Propose the complete plan: one pot per currency, each with one unknown. Nurav validates it against the person's accounts and shows it as a table for them to approve. Returns errors to fix, or ok with any warnings.",
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "title": {"type": "string", "maxLength": 80, "description": "Short plan name in the person's words, e.g. '$5M and ₹4Cr'."},
                "pots": {"type": "array", "minItems": 1, "maxItems": 4, "items": _POT},
                "inflation": {"type": "number", "minimum": 0, "maximum": 25, "description": "Percent a year; 0 turns it off."},
                "compounding": {"type": "integer", "enum": [12, 4, 1]},
                "risk_appetite": {"type": ["string", "null"], "enum": ["cautious", "balanced", "growth", None]},
                "defaults": {
                    "type": "array",
                    "items": {"type": "string", "enum": ["inflation", "compounding", "rate_options", "target_basis", "risk_appetite"]},
                    "description": "Fields you filled with a default rather than from the person.",
                },
            },
            "required": ["title", "pots", "inflation", "compounding", "risk_appetite", "defaults"],
        },
    },
}

_TEXTS = {"type": "array", "items": {"type": "string", "maxLength": 400}}

TOOL_REPORT = {
    "type": "function",
    "function": {
        "name": "write_report",
        "description": "Write the report around the engine's results. Numbers only as {figure} tokens.",
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "headline": {"type": "string", "maxLength": 400, "description": "One or two sentences: the answer to their question."},
                "insights": {**_TEXTS, "minItems": 1, "maxItems": 5, "description": "What drives the result."},
                "watch_outs": {**_TEXTS, "maxItems": 5, "description": "Fragile assumptions and risks."},
                "recommendations": {**_TEXTS, "minItems": 1, "maxItems": 5, "description": "Concrete next steps or versions to try."},
                "glossary": {
                    "type": "array",
                    "maxItems": 6,
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {"term": {"type": "string"}, "meaning": {"type": "string"}},
                        "required": ["term", "meaning"],
                    },
                },
                "chat_summary": {"type": "string", "maxLength": 800},
                "follow_ups": {"type": "array", "maxItems": 3, "items": {"type": "string", "maxLength": 160}},
            },
            "required": ["headline", "insights", "watch_outs", "recommendations", "glossary", "chat_summary", "follow_ups"],
        },
    },
}
