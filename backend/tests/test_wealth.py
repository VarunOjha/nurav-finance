"""Draft checks, the four unknowns, possibilities, segments, figures and the numbers-by-token rule (no database)."""

from datetime import date
from decimal import Decimal

import pytest

from services.agent import narrative as narr
from services.agent.loop import fallback_narrative
from services.agent.snapshot import Snapshot, letters
from services.analytics import Item
from services.ledger import Point, Timeline
from services.wealth import fmt
from services.wealth.engine import project
from services.wealth.params import check
from services.wealth.run import Pot, run_version

TODAY = date(2026, 10, 16)


def item(name, value, kind="account", currency="USD", group="savings", n=0):
    import uuid
    from datetime import UTC, datetime

    tl = Timeline([Point(date(2026, 1, 1), datetime(2026, 1, 1, tzinfo=UTC), Decimal(str(value)))])
    return Item(
        kind,
        name,
        currency,
        ["emergency"],
        tl,
        None,
        None,
        group if kind == "account" else "portfolio",
        id=uuid.uuid4(),
        created_at=datetime(2026, 1, 1, n, tzinfo=UTC),
    )


@pytest.fixture
def snap():
    items = [
        item("Emergency fund", 30000, n=0),
        item("401k", 170000, group="retirement", n=1),
        item("SBI", 1_000_000, currency="INR", n=2),
    ]
    return Snapshot(items, TODAY, date(1992, 5, 1))


def pot(**over):
    base = {"currency": "USD", "solve_for": "time", "target": 5_000_000, "target_basis": "nominal", "rate": 8}
    return {**base, **over}


def params(*pots, **over):
    return {"title": "Five million", "pots": list(pots) or [pot()], "inflation": 3, **over}


def run(p, snap):
    draft, errors = check(p, snap)
    assert errors == [], errors
    return draft, run_version(draft, snap, 1)


def test_aliases_follow_creation_order_and_tags_are_never_sent(snap):
    assert [e.alias for e in snap.entries.values()] == ["Account A", "Account B", "Account C"]
    assert letters(0) == "A" and letters(25) == "Z" and letters(26) == "AA"
    assert snap.display_map()["Account B"] == "401k"
    sent = snap.for_model()
    assert "tags" not in sent["items"][0] and "suggested_buckets" not in sent and "emergency" not in str(sent)
    assert {c["currency"]: c["total"] for c in sent["currencies"]} == {"USD": 200000, "INR": 1000000}


def test_a_pot_starts_from_everything_in_its_currency(snap):
    draft, errors = check(params(pot(), risk_appetite="balanced"), snap)
    assert errors == []
    p = draft["pots"][0]
    assert p["start"] == 200000 and [x["alias"] for x in p["items"]] == ["Account A", "Account B"]
    assert p["horizon_years"] is None and p["rate_options"] == [6, 8, 10]
    w = " ".join(draft["warnings"])
    assert "8% is above the 5–7% range for Balanced" in w
    assert "Not in this plan: 1 item in INR. Add a INR pot" in w


def test_every_currency_gets_its_own_pot_and_answer(snap):
    _, v = run(params(pot(), pot(currency="INR", solve_for="amount", target=None, horizon_years=15, rate=9)), snap)
    assert not any("Not in this plan" in w for w in v["draft"]["warnings"])
    usd, inr = v["pots"]
    assert usd["currency"] == "USD" and inr["currency"] == "INR"
    assert inr["start"] == 1_000_000 and inr["answer"]["value"] == pytest.approx(1_000_000 * 1.09**15, rel=1e-6)
    assert v["figures"]["start:INR"] == "₹10L" and v["figures"]["fi_date:USD"]


def test_exclude_and_start_override(snap):
    draft, _ = check(params(pot(exclude=["Account A"])), snap)
    assert draft["pots"][0]["start"] == 170000 and draft["pots"][0]["excluded"][0]["alias"] == "Account A"
    draft, _ = check(params(pot(start_override=250000)), snap)
    assert draft["pots"][0]["start"] == 250000 and "instead of the 200,000" in " ".join(draft["warnings"])


def test_shape_errors_are_worded_for_the_model(snap):
    _, errors = check({**params(), "colour": "blue"}, snap)
    assert any("colour" in e for e in errors)
    _, errors = check(params(pot(rate=99)), snap)
    assert any("rate" in e and "50" in e for e in errors)


@pytest.mark.parametrize(
    "over, needle",
    [
        ({"horizon_years": 10}, "the horizon is the answer"),
        ({"target": None}, "solving for time needs a target"),
        ({"rate": None}, "needs a return"),
        ({"solve_for": "amount"}, "needs a horizon"),
        ({"solve_for": "rate", "horizon_years": 10}, "leave rate (and segment rates) null"),
        ({"solve_for": "contribution", "horizon_years": 10, "contribution": {"amount": 500}}, "its amount is the answer"),
        ({"currency": "EUR"}, "they hold nothing in EUR"),
        ({"exclude": ["Account C"]}, "Account C is in INR, not USD"),
        ({"exclude": ["Account Z"]}, "there is no Account Z"),
        ({"horizon_years": None, "solve_for": "amount", "horizon_age": 30}, "not after their current age"),
        ({"one_offs": [{"year": 61, "amount": 5}]}, "less than or equal to 60"),
        ({"solve_for": "amount", "horizon_years": 10, "contribution": {"amount": 5, "years": 12}}, "runs 12 years but the plan is 10"),
        ({"rate_options": [9, 7, 5]}, "ascending"),
        ({"rate": None, "segments": [{"name": "A", "share": 60, "rate": 9}, {"name": "B", "share": 30, "rate": 4}]}, "add up to 90%"),
        ({"rate": None, "segments": [{"name": "A", "share": 60, "rate": 9}, {"name": "B", "amount": 30, "rate": 4}]}, "not a mix"),
        ({"rate": None, "segments": [{"name": "A", "amount": 150000, "rate": 9}]}, "unassigned 50,000.00"),
        ({"segments": [{"name": "A", "share": 100, "rate": 9}]}, "leave the pot's rate"),
        ({"rate": None, "segments": [{"name": "A", "share": 100}]}, "segment A needs a rate"),
    ],
)
def test_plan_errors(snap, over, needle):
    draft, errors = check(params(pot(**over)), snap)
    assert draft is None and any(needle in e for e in errors), errors


def test_one_pot_per_currency(snap):
    _, errors = check(params(pot(), pot()), snap)
    assert any("One pot per currency" in e for e in errors)


def test_age_horizon_needs_a_birth_date(snap):
    snap.birth = None
    _, errors = check(params(pot(solve_for="amount", horizon_age=60)), snap)
    assert any("date of birth" in e for e in errors)


def test_time_answers_when_and_compares_three_returns(snap):
    _, v = run(params(pot()), snap)
    r = v["pots"][0]
    months = r["answer"]["months"]
    assert r["answer"]["status"] == "ok" and months == r["fi_months"]
    # 200K at 8% doubles about every 9 years: 5M (25x) takes about 42 years.
    assert 40 * 12 < months < 43 * 12
    times = [line["fi_months"] for line in r["lines"]]
    assert [line["label"] for line in r["lines"]] == ["6%", "8%", "10%"]
    assert times[0] > times[1] == months > times[2]
    assert r["horizon_years"] * 12 >= max(t for t in times if t is not None)
    assert v["figures"]["time:USD:1"].endswith("years") and "final:USD" not in v["figures"]


def test_a_contribution_for_ten_years_shows_how_much_sooner(snap):
    _, v = run(params(pot(contribution={"amount": 10000, "per": "year", "years": 10, "step_up": 0})), snap)
    r = v["pots"][0]
    e = r["contribution_effect"]
    assert e["kind"] == "time" and e["without"] > e["with"] == r["fi_months"]
    assert v["figures"]["contribution_saves:USD"].endswith("years") and v["figures"]["contribution_years:USD"] == "10 years"
    # It stops after 10 years: 10 x 10K added in all.
    assert sum(r["main"]["buckets"][0]["added"]) == pytest.approx(100000)


def test_amount_checks_against_the_target(snap):
    _, v = run(params(pot(solve_for="amount", horizon_years=20)), snap)
    r = v["pots"][0]
    assert r["answer"]["value"] == pytest.approx(200000 * 1.08**20, rel=1e-6)
    assert "shortfall:USD" in v["figures"] and v["figures"]["final:USD"] == fmt.money(r["answer"]["value"], "USD")
    assert r["grid_years"] == [5, 10, 15, 20]
    assert [line["end"] for line in r["lines"]] == sorted(line["end"] for line in r["lines"])


def test_rate_finds_the_return_and_how_it_moves_with_time(snap):
    _, v = run(params(pot(solve_for="rate", horizon_years=20, rate=None)), snap)
    r = v["pots"][0]
    rate = r["answer"]["value"]
    assert r["answer"]["status"] == "ok" and r["main"]["total"][-1] == pytest.approx(5_000_000, rel=1e-4)
    assert 17 < rate < 18 and v["figures"]["required_rate:USD"] == fmt.pct(rate)
    by = {h["years"]: h["value"] for h in r["rate_by_horizon"]}
    assert list(by) == [15, 20, 25] and by[15] > by[20] > by[25]
    # The options sit around the solved return.
    assert [line["rate"] for line in r["lines"]] == [15.5, 17.5, 19.5]


def test_contribution_finds_the_amount_with_its_shape(snap):
    _, v = run(params(pot(solve_for="contribution", horizon_years=20, contribution={"amount": 0, "per": "year", "years": 10, "step_up": 0})), snap)
    r = v["pots"][0]
    a = r["answer"]
    assert a["status"] == "ok" and a["per"] == "year" and r["main"]["total"][-1] == pytest.approx(5_000_000, rel=1e-4)
    assert sum(r["main"]["buckets"][0]["added"]) == pytest.approx(a["value"] * 10, rel=1e-6)
    needed = [x["value"] for x in r["contribution_by_rate"]]
    assert needed[0] > needed[1] > needed[2] and needed[1] == pytest.approx(a["value"], rel=1e-6)
    assert v["figures"]["required_contribution:USD"] == fmt.money(a["value"], "USD")


def test_segments_grow_apart_and_say_what_each_needs(snap):
    segs = [
        {"name": "Equities", "share": 75, "rate": 10, "target": 4_000_000},
        {"name": "Savings", "share": 15, "rate": 4, "target": 500_000},
        {"name": "Cash", "share": 10, "rate": 0, "target": 500_000},
    ]
    draft, v = run(params(pot(solve_for="amount", horizon_years=25, target=None, rate=None, segments=segs, monthly_spending=10000)), snap)
    assert [s["start"] for s in draft["pots"][0]["segments"]] == [150000, 30000, 20000]
    assert draft["pots"][0]["target"] == 5_000_000
    r = v["pots"][0]
    assert [line["label"] for line in r["lines"]] == ["−2 points", "as set", "+2 points"]
    rows = {s["name"]: s for s in r["segments"]}
    assert rows["Cash"]["end"] == pytest.approx(20000) and rows["Cash"]["months"] is None  # 0% never gets there alone
    assert rows["Cash"]["runway_months"] == 50
    assert not rows["Cash"]["reaches"] and rows["Cash"]["required"]["value"] > 0
    # The extra it needs, added monthly, gets the segment exactly to its target (in nominal terms).
    pot_ = Pot(v["draft"], 0)
    plan = pot_.plan(25, only="Cash", target=500_000)
    plan["extra"] = {"bucket": "Cash", "monthly": rows["Cash"]["required"]["value"]}
    assert project(plan, solve=False)["total"][-1] == pytest.approx(rows["Cash"]["target_end"], rel=1e-4)
    assert v["figures"]["seg_needs:USD:Cash"] and v["figures"]["seg_runway:USD:Cash"] == "4.2 years"


def test_segment_contributions_are_solved_one_by_one(snap):
    segs = [{"name": "Equities", "share": 80, "rate": 10, "target": 4_000_000}, {"name": "Cash", "share": 20, "rate": 2, "target": 1_000_000}]
    _, v = run(params(pot(solve_for="contribution", horizon_years=20, rate=None, target=None, segments=segs)), snap)
    r = v["pots"][0]
    parts = r["answer"]["by_segment"]
    assert r["answer"]["value"] == pytest.approx(parts["Equities"]["value"] + parts["Cash"]["value"], abs=0.02)
    assert r["main"]["total"][-1] == pytest.approx(5_000_000, rel=1e-4)


def test_the_fallback_headline_uses_known_tokens_only(snap):
    _, v = run(params(pot(), pot(currency="INR", solve_for="rate", horizon_years=15, rate=None, target=10_000_000)), snap)
    head = fallback_narrative(v)["headline"]
    assert narr.problems({**fallback_narrative(v)}, v["figures"]) == []
    assert "{fi_date:USD}" in head and "{required_rate:INR}" in head


def test_numbers_must_be_tokens():
    figures = {"fi_date:USD": "Nov 2064", "rate:USD:1": "6%"}
    good = {
        "headline": "You get there by {fi_date:USD}, in 2064.",
        "insights": ["{rate:USD:1} for 6 months"],
        "watch_outs": [],
        "recommendations": ["Try 2 points less."],
        "glossary": [],
        "chat_summary": "ok",
    }
    assert narr.problems(good, figures) == []
    for text in ("$6.4M", "8%", "8 percent", "1,500", "6.4M", "USD 500", "₹5 lakh", "{nope}"):
        assert narr.problems({**good, "headline": f"About {text}."}, figures), text
    scrubbed = narr.scrub({**good, "insights": ["fine", "costs $5"], "headline": "$1"}, figures, "fallback")
    assert scrubbed["insights"] == ["fine"] and scrubbed["headline"] == "fallback"


def test_rendering_fills_tokens_and_names():
    out = narr.render_all(
        {
            "headline": "{final:USD} in Account A, not Account AA.",
            "insights": [],
            "watch_outs": [],
            "recommendations": [],
            "glossary": [],
            "chat_summary": "x",
            "follow_ups": [],
        },
        {"final:USD": "$6.4M"},
        {"Account A": "Chase", "Account AA": "Ally"},
    )
    assert out["headline"] == "$6.4M in Chase, not Ally."


@pytest.mark.parametrize(
    "value, currency, expected",
    [
        (6_400_000, "USD", "$6.4M"),
        (802_000, "USD", "$802K"),
        (999_960, "USD", "$1M"),
        (950, "USD", "$950"),
        (-1500, "EUR", "−€1.5K"),
        (6_400_000, "INR", "₹64L"),
        (25_000_000, "INR", "₹2.5Cr"),
        (12, "XYZ", "XYZ 12"),
    ],
)
def test_money_format(value, currency, expected):
    assert fmt.money(value, currency) == expected


def test_pct():
    assert fmt.pct(8) == "8%" and fmt.pct(9.37) == "9.4%" and fmt.share(0.412) == "41%"
