# ruff: noqa: E501  (prompts are prose; wrapping them only adds noise)
"""The model step: one structured review of the pool.

The model supplies assumptions (inflation, FX, returns),
judgement (scores, what to keep, what to change, risks, rebalance targets)
and milestone themes. It never computes the financial-independence number
or year: code does that from its assumptions (compute.py), so every chart
agrees with every figure and inquiries compare like for like.
"""

import copy
import json

from services.screenshot.openrouter import OpenRouter, ToolResult

SCENARIOS = ("conservative", "balanced", "aggressive")
EFFECT_KINDS = ["return_pct", "inflation_pct", "pool_pct", "expenses_pct", "none"]
SEVERITIES = ["high", "medium", "low"]

SYSTEM = """You are a careful, independent financial planner reviewing one household's investable money. You are shown every account in a workspace, what the money is in, and the household's current monthly expenses. Your job is to judge how well the money is structured and to give the assumptions a projection needs. You do not compute the financial-independence number or year: code computes them from your assumptions.

Ground rules:
- The person retires in the year when their chosen withdrawal rate (withdrawal_rate_pct) of the pool pays that year's expenses; after that they take their expenses, rising with inflation, and the pool keeps growing. The withdrawal rate is theirs: never propose another one. Assume NO new savings: only today's pool grows.
- Fixed assets (a house, a car; marked "fixed asset") are kept and never sold. They are not in the pool. Every other account marked in_pool is in the pool. Accounts the person left out are not in the pool; ignore them.
- Expenses are in one currency (expenses.currency). Every combined figure is in that currency. Give an exchange rate for each other pool currency.
- Inflation: for every currency that appears (pool currencies and the expenses currency), give the AVERAGE annual consumer-price inflation over the last 30 full calendar years, from official CPI data as you know it, and name the period (e.g. "1995–2024") and the index (e.g. "US CPI-U").
- FX: value_in_expense_currency is what ONE unit of that currency is worth in the expenses currency today (e.g. 1 INR = 0.0114 USD). drift_pct is its average yearly change in value against the expenses currency over the same 30 years (negative when it weakens).
- Three scenarios, one entry each, named conservative, balanced and aggressive. For each give:
  - return_pct: the expected long-run NOMINAL yearly return of the pool AS IT IS NOW, in the expenses currency (include currency drift of foreign holdings), after costs.
  - return_rebalanced_pct: the same if the pool were moved to that scenario's rebalance targets.
  - rebalance: target shares (percent of the whole pool), each for a key copied exactly from target_keys. Shares sum to 100. Leave out keys at 0. A class ending in "investment accounts" is a retirement or investment balance whose holdings aren't shown: keep its target at its current share.
  - milestones: up to 8 waypoints, years ascending, starting at the next year divisible by 5, one every 5 years, at most 40 years out. focus = the one thing to have done by then (at most 32 characters). Code drops those after the retirement year and fills in the amounts.
  Conservative must have the lowest returns, aggressive the highest.
- structure: whole-number scores 0–10 for overall, diversification, liquidity, growth_mix (enough growth assets for the horizon), currency_spread (currencies match where the money will be spent).
- keep: up to 3 things that are fine as they are (each at most 60 characters).
- changes: up to 5 changes, most valuable first. title at most 40 characters; detail at most 60 characters with the fact behind it (e.g. "Now 31% · $238.1k"). effect says what the change does to the BALANCED projection: return_pct (+percentage points of yearly return), inflation_pct, pool_pct (% change of the pool), expenses_pct, or none when it is about safety. label is a 1–2 word chip when effect is none (e.g. "Safety"), otherwise null.
- risks: up to 6 risks to retiring on time and to the pool lasting afterwards, highest first. title at most 40 characters, detail at most 40 characters. stress is the shock that tests it: pool_pct (e.g. -15 if one holding halves), return_pct (e.g. -1), inflation_pct (e.g. 0.5), expenses_pct (e.g. 15), or none. label is a short chip (at most 16 characters) naming the shock, e.g. "−50% MSFT", "+0.5% inflation", "2 yrs cash".
- previous_advice lists the change titles of the last inquiry. When you give the same advice again, reuse that exact title.
- Be concrete and use the household's own names (accounts, symbols, buckets). No disclaimers, no filler."""


def _scenario_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "name": {"type": "string", "enum": list(SCENARIOS)},
            "return_pct": {"type": "number"},
            "return_rebalanced_pct": {"type": "number"},
            "rebalance": {
                "type": "array",
                "items": {"type": "object", "properties": {"key": {"type": "string"}, "target_pct": {"type": "number"}}},
            },
            "milestones": {
                "type": "array",
                "items": {"type": "object", "properties": {"year": {"type": "integer"}, "focus": {"type": "string"}}},
            },
        },
    }


def _effect_schema() -> dict:
    return {"type": "object", "properties": {"kind": {"type": "string", "enum": EFFECT_KINDS}, "value": {"type": "number"}}}


def tool() -> dict:
    """The answer's shape. Kept small: a strict schema compiles to a grammar, and Anthropic refuses
    big ones ("compiled grammar is too large"), so the three scenarios share one item schema and
    class keys are plain strings that the checks validate."""
    return {
        "type": "function",
        "function": {
            "name": "wealth_review",
            "description": "The review: assumptions, three scenarios, structure, keep, changes, risks.",
            "parameters": {
                "type": "object",
                "properties": {
                    "inflation": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "currency": {"type": "string"},
                                "rate_pct": {"type": "number"},
                                "period": {"type": "string"},
                                "index": {"type": "string"},
                            },
                        },
                    },
                    "fx": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "currency": {"type": "string"},
                                "value_in_expense_currency": {"type": "number"},
                                "drift_pct": {"type": "number"},
                            },
                        },
                    },
                    "scenarios": {"type": "array", "items": _scenario_schema()},
                    "structure": {
                        "type": "object",
                        "properties": {k: {"type": "integer"} for k in ("overall", "diversification", "liquidity", "growth_mix", "currency_spread")},
                    },
                    "keep": {"type": "array", "items": {"type": "string"}},
                    "changes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "detail": {"type": "string"},
                                "effect": _effect_schema(),
                                "label": {"type": ["string", "null"]},
                            },
                        },
                    },
                    "risks": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "severity": {"type": "string", "enum": SEVERITIES},
                                "title": {"type": "string"},
                                "detail": {"type": "string"},
                                "stress": _effect_schema(),
                                "label": {"type": "string"},
                            },
                        },
                    },
                },
            },
        },
    }


async def review(llm: OpenRouter, snapshot: dict, problems: list[str] | None = None, previous: dict | None = None) -> ToolResult:
    """One call. On a retry, the earlier answer and what was wrong with it go along."""
    content = "The household:\n" + json.dumps(snapshot, ensure_ascii=False, indent=1)
    if problems and previous is not None:
        content += (
            "\n\nYour previous answer:\n"
            + json.dumps(previous, ensure_ascii=False)
            + "\n\nIt failed these checks; answer again with them fixed:\n- "
            + "\n- ".join(problems)
        )
    reply = await llm.tool_call(SYSTEM, content, tool())
    reply.args = by_name(reply.args)
    return reply


def by_name(args: dict) -> dict:
    """Scenarios arrive as a list (one schema for all three); the rest of the code keys them by name."""
    if isinstance(args.get("scenarios"), list):
        args = {**args, "scenarios": {s.pop("name"): s for s in copy.deepcopy(args["scenarios"])}}
    return args
