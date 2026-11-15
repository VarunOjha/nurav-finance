"""Checks on the model's answer, and every number an inquiry shows.

The target (FI number) is a year's expenses over the person's withdrawal rate
w, in today's money: the retirement year is when w of the pool pays that
year's expenses. Expenses rise with inflation i and the pool grows at return r
with nothing added, so retirement comes after t years where

    pool · (1 + r)^t = FI · (1 + i)^t   →   t = ln(FI / pool) / ln((1 + r) / (1 + i))

Already there: t = 0. If the pool can't outgrow inflation: never (None).

After retiring, the person takes their expenses (rising with inflation) and
the pool keeps growing. With real growth g = (1 + r) / (1 + i) − 1, the pool
is preserved when w ≤ g (it still grows by about g − w a year); otherwise it
runs out after ln(w / (w − g)) / ln(1 + g) years.
Curves are in today's money (real terms): the pool climbs, the FI number is
a flat line, and they cross at t. Floats are fine here — these are
projections, rounded for display — the money itself stays Decimal elsewhere.
"""

import math
from datetime import date, timedelta

from services.estimator.pool import class_label
from services.estimator.review import SCENARIOS

MAX_YEARS = 60
INFLATION_RANGE = (0.0, 15.0)
RETURN_RANGE = (-5.0, 20.0)
WITHDRAWAL_RANGE = (1.0, 10.0)
DRIFT_RANGE = (-15.0, 15.0)
EFFECT_LIMIT = 100.0
LAST_YEAR = 2100


def _num(v) -> float:
    return float(v)


def check(answer: dict, snapshot: dict) -> list[str]:
    """What's wrong with an answer, worded for the model's retry. Empty = fine."""
    problems: list[str] = []
    expense_cur = snapshot["expenses"]["currency"]
    pool_curs = {p["currency"] for p in snapshot["pool_by_currency"]}
    year = date.fromisoformat(snapshot["today"]).year

    infl = {x["currency"]: x for x in answer.get("inflation", [])}
    for cur in sorted(pool_curs | {expense_cur}):
        if cur not in infl:
            problems.append(f"inflation: missing {cur}")
        elif not INFLATION_RANGE[0] <= infl[cur]["rate_pct"] <= INFLATION_RANGE[1]:
            problems.append(f"inflation {cur}: {infl[cur]['rate_pct']}% is outside 0–15%")
    fx = {x["currency"]: x for x in answer.get("fx", [])}
    for cur in sorted(pool_curs - {expense_cur}):
        if cur not in fx:
            problems.append(f"fx: missing {cur}")
            continue
        if fx[cur]["value_in_expense_currency"] <= 0:
            problems.append(f"fx {cur}: value_in_expense_currency must be above 0")
        if not DRIFT_RANGE[0] <= fx[cur]["drift_pct"] <= DRIFT_RANGE[1]:
            problems.append(f"fx {cur}: drift {fx[cur]['drift_pct']}% is outside −15–15%")

    scen = answer.get("scenarios", {})
    for s in SCENARIOS:
        x = scen.get(s)
        if not x:
            problems.append(f"scenarios: missing {s}")
            continue
        for field in ("return_pct", "return_rebalanced_pct"):
            if not RETURN_RANGE[0] <= x[field] <= RETURN_RANGE[1]:
                problems.append(f"{s}.{field}: {x[field]}% is outside −5–20%")
        keys = [t["key"] for t in x["rebalance"]]
        unknown = sorted(set(keys) - set(snapshot.get("target_keys", keys)))
        if unknown:
            problems.append(f"{s}.rebalance: unknown keys {', '.join(unknown)}; use only target_keys")
        if len(keys) != len(set(keys)):
            problems.append(f"{s}.rebalance: a key appears twice")
        if any(not 0 <= t["target_pct"] <= 100 for t in x["rebalance"]):
            problems.append(f"{s}.rebalance: every target must be 0–100%")
        total = sum(t["target_pct"] for t in x["rebalance"])
        if abs(total - 100) > 0.5:
            problems.append(f"{s}.rebalance: targets sum to {total:g}%, not 100%")
        years = [m["year"] for m in x["milestones"]]
        if years != sorted(set(years)) or any(y <= year or y > LAST_YEAR for y in years):
            problems.append(f"{s}.milestones: years must be ascending, after {year} and no later than {LAST_YEAR}")
    if all(s in scen for s in SCENARIOS):
        c, b, a = (scen[s]["return_pct"] for s in SCENARIOS)
        if not c <= b <= a:
            problems.append(f"return_pct must rise from conservative to balanced to aggressive (got {c}, {b}, {a})")

    for k, v in answer.get("structure", {}).items():
        if not 0 <= v <= 10:
            problems.append(f"structure.{k}: {v} is outside 0–10")
    for part in ("changes", "risks"):
        for x in answer.get(part, []):
            e = x["effect" if part == "changes" else "stress"]
            if abs(e["value"]) > EFFECT_LIMIT:
                problems.append(f"{part}: '{x['title']}' has an effect of {e['value']}, beyond ±100")
    return problems


def years_to_fi(fi: float, pool: float, r: float, i: float) -> float | None:
    if pool >= fi:
        return 0.0
    if pool <= 0:
        return None
    g = (1 + r) / (1 + i)
    if g <= 1:
        return None
    return math.log(fi / pool) / math.log(g)


def _when(today: date, years: float | None) -> date | None:
    if years is None or years > MAX_YEARS:
        return None
    return today + timedelta(days=round(years * 365.25))


def _age_on(dob: date | None, day: date | None) -> int | None:
    if dob is None or day is None:
        return None
    return day.year - dob.year - ((day.month, day.day) < (dob.month, dob.day))


def _delta(base: float | None, other: float | None) -> float | None:
    """Years gained (−) or lost (+); None when either side never gets there. Not capped at
    the horizon: a shock that pushes FI past it still has a size."""
    if base is None or other is None:
        return None
    return round(other - base, 1)


def lasts(w: float, g: float) -> float | None:
    """Years a pool lasts paying w of its starting value a year (kept level in today's money) while it
    earns real growth g. None = preserved: the growth pays for it."""
    if w <= g:
        return None
    if abs(g) < 1e-9:
        return 1 / w
    return math.log(w / (w - g)) / math.log(1 + g)


def _shocked(kind: str, value: float, fi: float, pool: float, r: float, i: float) -> float | None:
    if kind == "return_pct":
        return years_to_fi(fi, pool, r + value / 100, i)
    if kind == "inflation_pct":
        return years_to_fi(fi, pool, r, i + value / 100)
    if kind == "pool_pct":
        return years_to_fi(fi, pool * (1 + value / 100), r, i)
    if kind == "expenses_pct":
        return years_to_fi(fi * (1 + value / 100), pool, r, i)
    return None


def compute(answer: dict, snapshot: dict, dob: date | None) -> dict:
    today = date.fromisoformat(snapshot["today"])
    cur = snapshot["expenses"]["currency"]
    annual = _num(snapshot["expenses"]["monthly"]) * 12
    infl = {x["currency"]: x for x in answer["inflation"]}
    i = infl[cur]["rate_pct"] / 100
    fx = {x["currency"]: x for x in answer["fx"]}
    rate = {c: 1.0 if c == cur else fx[c]["value_in_expense_currency"] for c in [p["currency"] for p in snapshot["pool_by_currency"]]}

    by_currency = [
        {"currency": p["currency"], "value": _num(p["value"]), "rate": rate[p["currency"]], "value_in": _num(p["value"]) * rate[p["currency"]]}
        for p in snapshot["pool_by_currency"]
    ]
    pool = sum(p["value_in"] for p in by_currency)
    now_pct = {c["key"]: (_num(c["value"]) * rate[c["currency"]] / pool * 100 if pool else 0.0) for c in snapshot["classes"]}
    t0 = today.year + (today.timetuple().tm_yday - 1) / 365.25
    swr = _num(snapshot["withdrawal_rate_pct"]) / 100

    scenarios = {}
    for name in SCENARIOS:
        s = answer["scenarios"][name]
        r, rr = s["return_pct"] / 100, s["return_rebalanced_pct"] / 100
        fi = annual / swr
        t = years_to_fi(fi, pool, r, i)
        tr = years_to_fi(fi, pool, rr, i)
        when, when_r = _when(today, t), _when(today, tr)
        horizon = min(MAX_YEARS, math.ceil(max(x for x in (t, tr, 25.0) if x is not None)) + 5)
        g, gr = (1 + r) / (1 + i), (1 + rr) / (1 + i)
        curve = [{"year": today.year + k, "as_is": round(pool * g**k, 2), "rebalanced": round(pool * gr**k, 2)} for k in range(horizon + 1)]

        targets = {x["key"]: x["target_pct"] for x in s["rebalance"]}
        keys = list(now_pct) + [k for k in targets if k not in now_pct]
        rebalance = [
            {
                "key": k,
                "label": class_label(k),
                "now_pct": round(now_pct.get(k, 0.0), 1),
                "target_pct": round(targets.get(k, 0.0), 1),
                "move": round((targets.get(k, 0.0) - now_pct.get(k, 0.0)) / 100 * pool, 2),
            }
            for k in keys
        ]
        rebalance = [x for x in rebalance if x["now_pct"] or x["target_pct"]]
        rebalance.sort(key=lambda x: -max(x["now_pct"], x["target_pct"]))

        miles = [
            {"year": m["year"], "focus": m["focus"], "amount": round(pool * (1 + r) ** (m["year"] - t0), 2), "fi": False}
            for m in s["milestones"]
            if when is None or m["year"] < when.year
        ]
        if when is not None:
            miles.append({"year": when.year, "focus": "Retire", "amount": round(fi * (1 + i) ** t, 2), "fi": True})
        real = (1 + r) / (1 + i) - 1
        runway = lasts(swr, real)

        scenarios[name] = {
            "return_pct": s["return_pct"],
            "return_rebalanced_pct": s["return_rebalanced_pct"],
            "real_growth_pct": round(real * 100, 3),
            "preserved": runway is None,
            "surplus_pct": round((real - swr) * 100, 2),  # how much faster than the withdrawals the pool grows
            "lasts_years": round(runway, 1) if runway is not None else None,
            "fi_today": round(fi, 2),
            "fi_nominal": round(fi * (1 + i) ** t, 2) if when is not None else None,
            "years": round(t, 2) if when is not None else None,
            "fi_date": when.isoformat() if when else None,
            "fi_year": when.year if when else None,
            "fi_age": _age_on(dob, when),
            "rebalanced_years": round(tr, 2) if when_r is not None else None,
            "rebalanced_year": when_r.year if when_r else None,
            "progress": round(min(pool / fi, 1.0), 4) if fi else 0.0,
            "curve": curve,
            "rebalance": rebalance,
            "milestones": miles,
            "change_years": [
                _delta(t, _shocked(c["effect"]["kind"], c["effect"]["value"], fi, pool, r, i)) if c["effect"]["kind"] != "none" else None
                for c in answer["changes"]
            ],
            "risk_years": [
                _delta(t, _shocked(x["stress"]["kind"], x["stress"]["value"], fi, pool, r, i)) if x["stress"]["kind"] != "none" else None
                for x in answer["risks"]
            ],
        }

    return {
        "currency": cur,
        "today": today.isoformat(),
        "withdrawal_rate_pct": _num(snapshot["withdrawal_rate_pct"]),
        "monthly_expenses": _num(snapshot["expenses"]["monthly"]),
        "age": snapshot.get("age"),
        "pool": round(pool, 2),
        "pool_by_currency": [{**p, "value": round(p["value"], 2), "value_in": round(p["value_in"], 2)} for p in by_currency],
        "inflation": answer["inflation"],
        "expense_inflation_pct": infl[cur]["rate_pct"],
        "fx": [x for x in answer["fx"] if x["currency"] != cur],  # a model may list the expenses currency at 1
        "scenarios": scenarios,
        "structure": answer["structure"],
        "keep": answer["keep"],
        "changes": answer["changes"],
        "risks": answer["risks"],
        "excluded": [
            {
                "name": a["name"],
                "currency": a["currency"],
                "value": _num(a["value"]),
                "reason": "fixed" if a["excluded_because"].startswith("fixed") else "unticked",
            }
            for a in snapshot["accounts"]
            if not a["in_pool"]
        ],
    }
