"""Regenerate tests/data/engine_golden.json from the engine.

    cd backend && .venv/Scripts/python scripts/engine_golden.py

Only run this after a deliberate engine change; the hand-computed cases in
tests/test_wealth_engine.py must still pass.
"""

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from services.wealth.engine import project  # noqa: E402

OUT = pathlib.Path(__file__).resolve().parent.parent / "tests" / "data" / "engine_golden.json"


def phase(years, rate, amount=0.0, per="month", step_up=0.0):
    return {"years": years, "rate": rate, "amount": amount, "per": per, "step_up": step_up}


def bucket(key, start, phases, one_offs=()):
    return {"key": key, "start": start, "phases": phases, "one_offs": [{"year": y, "amount": a} for y, a in one_offs]}


def plan(buckets, years, compounding=12, inflation=0.0, target=None, contrib=None):
    return {
        "horizon_years": years,
        "compounding": compounding,
        "inflation": inflation,
        "target_today": target,
        "contrib_bucket": contrib,
        "buckets": buckets,
    }


# The example from the feature request: 30 years, phases 8% + 10k/yr, 10% + 500/mo, 10% nothing, 12%.
EXAMPLE = [
    bucket(
        "trading",
        120000.0,
        [phase(5, 8, 10000, "year"), phase(5, 10, 500), phase(10, 10), phase(None, 12)],
        [(8, -40000.0)],
    ),
    bucket("retirement", 80000.0, [phase(None, 7, 500, "month", 3)]),
    bucket("emergency-fund", 30000.0, [phase(None, 4)]),
]

CASES = {
    "annual_no_contrib": plan([bucket("total", 1000.0, [phase(None, 10)])], 2, compounding=1),
    "monthly_effective_rate": plan([bucket("total", 1000.0, [phase(None, 12)])], 1),
    "annual_with_monthly_contrib": plan([bucket("total", 1000.0, [phase(None, 10, 100)])], 1, compounding=1),
    "quarterly_with_monthly_contrib": plan([bucket("total", 1000.0, [phase(None, 10, 100)])], 3, compounding=4),
    "yearly_contrib_step_up": plan([bucket("total", 0.0, [phase(None, 0, 1000, "year", 10)])], 3),
    "withdrawal_floor": plan([bucket("total", 1000.0, [phase(None, 0, -600, "year")])], 3),
    "monthly_withdrawals": plan([bucket("total", 50000.0, [phase(None, 5, -2000)])], 5),
    "phases_back_to_back": plan([bucket("total", 100.0, [phase(1, 10), phase(None, 0)])], 3, compounding=1),
    "inflation_target": plan([bucket("total", 1000.0, [phase(None, 0)])], 2, inflation=3, target=1000.0),
    "fi_month": plan([bucket("total", 1000.0, [phase(None, 0, 100)])], 2, target=2200.0),
    "required_rate": plan([bucket("total", 1000.0, [phase(None, 0)])], 10, target=2000.0),
    "required_contribution": plan([bucket("total", 0.0, [phase(None, 0)])], 1, target=1200.0),
    "unreachable_rate": plan([bucket("total", 1.0, [phase(None, 0)])], 1, target=1e9),
    "already_there": plan([bucket("total", 5000.0, [phase(None, 5)])], 5, target=1000.0),
    "one_offs_and_lumps": plan([bucket("a", 10000.0, [phase(None, 6, 200)], [(2, 5000.0), (3, -20000.0)])], 4, compounding=4),
    "contrib_bucket_chosen": plan(
        [bucket("big", 100000.0, [phase(None, 6)]), bucket("small", 1000.0, [phase(None, 3)])], 15, inflation=2.5, target=400000.0, contrib="small"
    ),
    "example_30y_monthly": plan(EXAMPLE, 30, inflation=3, target=1500000.0),
    "example_30y_quarterly": plan(EXAMPLE, 30, compounding=4, inflation=3, target=1500000.0),
    "example_30y_annual": plan(EXAMPLE, 30, compounding=1, inflation=0, target=1500000.0),
    "sixty_years_many_phases": plan(
        [
            bucket(
                "eq", 5000.0, [phase(3, 9, 300, "month", 5), phase(7, -4, 0), phase(10, 14, 1200, "year", 2), phase(None, 7, -500)], [(40, -30000.0)]
            ),
            bucket("cash", 2000.0, [phase(None, 2.5, 50)]),
            bucket("untagged", 0.0, [phase(None, 0)], [(1, 100.0)]),
        ],
        60,
        inflation=4,
        target=900000.0,
    ),
}


def main() -> None:
    vectors = [{"name": name, "input": inp, "expected": project(inp)} for name, inp in CASES.items()]
    OUT.write_text(json.dumps(vectors, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {len(vectors)} vectors to {OUT}")


if __name__ == "__main__":
    main()
