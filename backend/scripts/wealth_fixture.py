"""Regenerate frontend/src/test/wealthVersion.json: a real engine version for UI tests.

    cd backend && .venv/Scripts/python scripts/wealth_fixture.py

Synthetic accounts, the scripted agent's narrative; no database or network.
A USD pot solving for time with a contribution for 10 years, and an INR pot
split into segments, solving for the amount.
"""

import json
import pathlib
import sys
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from services.agent.fake import _report  # noqa: E402
from services.agent.snapshot import Snapshot  # noqa: E402
from services.analytics import Item  # noqa: E402
from services.ledger import Point, Timeline  # noqa: E402
from services.wealth.params import check  # noqa: E402
from services.wealth.run import results_brief, run_version  # noqa: E402

OUT = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src" / "test" / "wealthVersion.json"


def item(name, value, currency, group, n):
    tl = Timeline([Point(date(2026, 1, 1), datetime(2026, 1, 1, tzinfo=UTC), Decimal(str(value)))])
    return Item("account", name, currency, [], tl, None, None, group, id=uuid.UUID(int=n + 1), created_at=datetime(2026, 1, 1, n, tzinfo=UTC))


def main() -> None:
    snap = Snapshot(
        [
            item("Chase Savings", 30000, "USD", "savings", 0),
            item("Fidelity 401k", 170000, "USD", "retirement", 1),
            item("HDFC Savings", 2_000_000, "INR", "savings", 2),
            item("Zerodha", 8_000_000, "INR", "brokerage", 3),
        ],
        date(2026, 10, 16),
        date(1992, 5, 1),
    )
    params = {
        "title": "$5M and a ₹10Cr split",
        "pots": [
            {
                "currency": "USD",
                "solve_for": "time",
                "target": 5_000_000,
                "target_basis": "nominal",
                "rate": 8,
                "contribution": {"amount": 10000, "per": "year", "years": 10, "step_up": 0},
            },
            {
                "currency": "INR",
                "solve_for": "amount",
                "horizon_years": 15,
                "monthly_spending": 150000,
                "segments": [
                    {"name": "Equities", "share": 80, "rate": 11, "target": 80_000_000},
                    {"name": "Savings", "share": 15, "rate": 6, "target": 10_000_000},
                    {"name": "Cash", "share": 5, "rate": 3, "target": 10_000_000},
                ],
            },
        ],
        "inflation": 3,
        "compounding": 12,
        "risk_appetite": "growth",
        "defaults": ["inflation", "compounding", "rate_options"],
    }
    draft, errors = check(params, snap)
    assert not errors, errors
    draft["id"] = "d1"
    draft["sig"] = "0" * 64
    v = run_version(draft, snap, 1)
    v["narrative"] = _report(results_brief(v))
    v["narrative"]["insights"].append("Account B does most of the work.")
    OUT.write_text(json.dumps({"version": v, "aliases": snap.display_map()}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
