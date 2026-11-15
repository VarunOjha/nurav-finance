"""Wealth estimator: the pool, the checks, the maths, and inquiries through the API (scripted model)."""

import copy
import json
import math
from datetime import date

import httpx
import pytest

from main import app
from routers.estimator import get_estimator_llm
from services.estimator.compute import check, compute, years_to_fi
from services.screenshot.openrouter import OpenRouter
from tests.conftest import Api

FX_INR = 0.0114


def _scenario(ret, reb, targets, years=(2030, 2035, 2040)):
    return {
        "return_pct": ret,
        "return_rebalanced_pct": reb,
        "rebalance": [{"key": k, "target_pct": v} for k, v in targets.items()],
        "milestones": [{"year": y, "focus": f"Step {y}"} for y in years],
    }


TARGETS = {"USD:stock:MSFT": 10, "USD:funds": 60, "USD:bonds": 15, "USD:cash": 5, "INR:deposits": 10}

ANSWER = {
    "inflation": [
        {"currency": "USD", "rate_pct": 2.5, "period": "1995–2024", "index": "US CPI-U"},
        {"currency": "INR", "rate_pct": 6.6, "period": "1995–2024", "index": "India CPI"},
    ],
    "fx": [{"currency": "INR", "value_in_expense_currency": FX_INR, "drift_pct": -3.0}],
    "scenarios": {
        "conservative": _scenario(5.8, 6.1, TARGETS),
        "balanced": _scenario(7.2, 7.6, TARGETS),
        "aggressive": _scenario(8.6, 8.9, TARGETS),
    },
    "structure": {"overall": 6, "diversification": 3, "liquidity": 9, "growth_mix": 6, "currency_spread": 5},
    "keep": ["Cash covers 3 months"],
    "changes": [
        {"title": "Cap MSFT at 10%", "detail": "Now 49% · $40k", "effect": {"kind": "return_pct", "value": 0.4}, "label": None},
        {"title": "Split deposits over ₹5L", "detail": "SBI", "effect": {"kind": "none", "value": 0}, "label": "Safety"},
    ],
    "risks": [
        {"severity": "high", "title": "Single stock", "detail": "MSFT 49%", "stress": {"kind": "pool_pct", "value": -25}, "label": "−50% MSFT"},
        {"severity": "medium", "title": "Inflation above 2.5%", "detail": "", "stress": {"kind": "inflation_pct", "value": 0.5}, "label": "+0.5%"},
        {"severity": "low", "title": "Healthcare", "detail": "", "stress": {"kind": "none", "value": 0}, "label": "+$1k / mo"},
    ],
}


def _wire(args: dict) -> dict:
    """As the model sends it: the scenarios are a list, each with its name."""
    return {**args, "scenarios": [{"name": k, **v} for k, v in args["scenarios"].items()]}


def _reply(args: dict, cost: float = 0.02) -> httpx.Response:
    args = _wire(args)
    return httpx.Response(
        200,
        json={"model": "test/model", "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(args)}}], "usage": {"cost": cost}},
    )


class Script:
    """Answers each call with the next scripted answer, recording the requests."""

    def __init__(self, *answers: dict):
        self.answers = list(answers)
        self.calls: list[dict] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(json.loads(request.content))
        return _reply(self.answers[min(len(self.calls), len(self.answers)) - 1])


@pytest.fixture
def scripted():
    def install(script: Script) -> Script:
        app.dependency_overrides[get_estimator_llm] = lambda: OpenRouter(transport=httpx.MockTransport(script), api_key="test")
        return script

    yield install
    app.dependency_overrides.pop(get_estimator_llm, None)


def _household(api: Api) -> dict:
    """USD: checking $10k, brokerage holding MSFT $40k + VTI $20k, a $300k house. INR: an FD of ₹10L."""
    checking = api.account(name="Chase", account_type="checking")
    api.balance(checking["id"], "10000", "2026-01-15")
    p = api.portfolio(name="Fidelity")
    api.snapshot(p["id"], "2026-01-15", [("MSFT", 100, 400, "stock"), ("VTI", 100, 200, "etf")])
    house = api.account(name="House", account_type="asset")
    api.balance(house["id"], "300000", "2026-01-15")
    fd = api.account(name="SBI FD", account_type="fixed_deposit", currency="INR")
    api.balance(fd["id"], "1000000", "2026-01-15")
    return {"checking": checking["id"], "house": house["id"], "fd": fd["id"], "portfolio": p["id"]}


def _run(api: Api, body: dict) -> list[dict]:
    res = api.post("/api/estimator/inquiries", json=body)
    assert res.status_code == 200, res.text
    return [json.loads(line) for line in res.text.splitlines() if line.strip()]


BODY = {"monthly_expenses": "1500", "currency": "USD"}


# ── maths ────────────────────────────────────────────────────────────────────


def test_how_long_the_pool_lasts_after_retiring():
    from services.estimator.compute import lasts

    assert lasts(0.035, 0.0537) is None  # growth pays for it: preserved
    assert lasts(0.04, 0.04) is None
    n = lasts(0.04, 0.03)  # 4% taken, 3% real growth
    assert n == pytest.approx(math.log(4) / math.log(1.03))  # ~46.9 years
    # Check by simulation: start at 100, take 4 a year (today's money), grow 3%.
    pool, years = 100.0, 0
    while pool > 0:
        pool = pool * 1.03 - 4
        years += 1
    assert years == math.ceil(n)
    assert lasts(0.04, 0.0) == 25


def test_years_to_fi_edges():
    assert years_to_fi(100, 100, 0.07, 0.03) == 0.0  # already there
    assert years_to_fi(100, 50, 0.02, 0.03) is None  # never outgrows inflation
    t = years_to_fi(200, 100, 0.0712, 0.025)
    assert 100 * 1.0712**t == pytest.approx(200 * 1.025**t)


def test_pool_keeps_fixed_assets_out_and_counts_portfolios_through_holdings(api: Api):
    ids = _household(api)
    pool = api.get("/api/estimator/pool").json()
    by_name = {a["name"]: a for a in pool["accounts"]}
    assert by_name["House"]["fixed"] is True
    assert float(by_name["Fidelity account"]["value"]) == 60000
    assert by_name["Fidelity account"]["fixed"] is False
    assert pool["currencies"] == ["USD", "INR"]  # most accounts first, not the biggest raw number
    assert ids["house"] in {a["id"] for a in pool["accounts"]}


def test_inquiry_runs_checks_computes_and_saves(api: Api, scripted):
    _household(api)
    script = scripted(Script(ANSWER))
    events = _run(api, BODY)
    assert [e.get("stage") for e in events if e["type"] == "stage" and e["status"] == "done"] == ["snapshot", "review", "checks", "compute"]
    result = events[-1]
    assert result["type"] == "result"

    sent = script.calls[0]
    assert sent["model"] == "anthropic/claude-sonnet-5.5"
    assert sent["response_format"]["json_schema"]["strict"] is True
    household = json.loads(sent["messages"][1]["content"].split("\n", 1)[1])
    assert household["expenses"] == {"monthly": "1500.0000", "currency": "USD"}
    house = next(a for a in household["accounts"] if a["name"] == "House")
    assert house["in_pool"] is False and house["excluded_because"].startswith("fixed")
    keys = {c["key"]: c["value"] for c in household["classes"]}
    assert keys == {"USD:stock:MSFT": "40000.0000", "USD:funds": "20000.0000", "USD:cash": "10000.0000", "INR:deposits": "1000000.0000"}
    assert "USD:bonds" in household["target_keys"]

    detail = api.get(f"/api/estimator/inquiries/{result['id']}").json()
    r = detail["result"]
    pool = 70000 + 1_000_000 * FX_INR
    assert r["pool"] == pytest.approx(pool)
    b = r["scenarios"]["balanced"]
    fi = 18000 / 0.035
    t = math.log(fi / pool) / math.log(1.072 / 1.025)
    assert b["fi_today"] == pytest.approx(fi, abs=0.01)
    assert b["years"] == pytest.approx(t, abs=0.01)
    assert b["fi_year"] == date.fromordinal(date.today().toordinal() + round(t * 365.25)).year
    assert b["fi_nominal"] == pytest.approx(fi * 1.025**t, rel=1e-6)
    assert b["rebalanced_year"] <= b["fi_year"]
    assert r["scenarios"]["conservative"]["fi_year"] >= b["fi_year"] >= r["scenarios"]["aggressive"]["fi_year"]
    assert r["scenarios"]["conservative"]["fi_today"] == b["fi_today"]  # one withdrawal rate for all three
    assert r["withdrawal_rate_pct"] == 3.5 and household["withdrawal_rate_pct"] == "3.5"
    # After retiring: 7.2% growth, 2.5% inflation → 4.59% real > 3.5% taken → preserved.
    assert b["preserved"] is True and b["lasts_years"] is None
    assert b["real_growth_pct"] == pytest.approx((1.072 / 1.025 - 1) * 100, abs=0.001)
    assert b["surplus_pct"] == pytest.approx((1.072 / 1.025 - 1) * 100 - 3.5, abs=0.01)
    # Curve in today's money crosses the flat FI number at t.
    crossing = next(p["year"] for p in b["curve"] if p["as_is"] >= fi)
    assert crossing - date.today().year == math.ceil(t)
    # Rebalance: now vs target, move in USD.
    msft = next(x for x in b["rebalance"] if x["key"] == "USD:stock:MSFT")
    assert msft["label"] == "MSFT"
    assert msft["now_pct"] == pytest.approx(40000 / pool * 100, abs=0.05)
    assert msft["move"] == pytest.approx((10 - 40000 / pool * 100) / 100 * pool, abs=1)
    # Milestones before FI keep their focus; FI is last.
    assert b["milestones"][-1]["fi"] is True and b["milestones"][-1]["year"] == b["fi_year"]
    assert b["milestones"][0]["amount"] == pytest.approx(
        pool * 1.072 ** (2030 - (date.today().year + (date.today().timetuple().tm_yday - 1) / 365.25)), rel=1e-6
    )
    # Effects in years: more return → sooner; a smaller pool or more inflation → later; "none" → no number.
    assert b["change_years"][0] < 0 and b["change_years"][1] is None
    assert b["risk_years"][0] > 0 and b["risk_years"][1] > 0 and b["risk_years"][2] is None
    assert r["excluded"] == [{"name": "House", "currency": "USD", "value": 300000.0, "reason": "fixed"}]
    assert detail["previous"] is None and detail["model"] == "test/model"

    listed = api.get("/api/estimator/inquiries").json()
    assert len(listed) == 1
    assert listed[0]["fi_years"]["balanced"] == b["fi_year"]
    assert listed[0]["changes"] == ["Cap MSFT at 10%", "Split deposits over ₹5L"]
    assert listed[0]["targets"]["USD:stock:MSFT"] == 10


def test_unticked_accounts_leave_the_pool_and_previous_advice_goes_along(api: Api, scripted):
    ids = _household(api)
    scripted(Script(ANSWER))
    first = _run(api, BODY)[-1]["id"]
    script = scripted(Script(ANSWER))
    second = _run(api, {**BODY, "excluded_account_ids": [ids["checking"]]})[-1]["id"]
    household = json.loads(script.calls[0]["messages"][1]["content"].split("\n", 1)[1])
    assert household["previous_advice"] == ["Cap MSFT at 10%", "Split deposits over ₹5L"]
    chase = next(a for a in household["accounts"] if a["name"] == "Chase")
    assert chase["in_pool"] is False and chase["excluded_because"] == "left out by the person"
    detail = api.get(f"/api/estimator/inquiries/{second}").json()
    assert detail["result"]["pool"] == pytest.approx(60000 + 1_000_000 * FX_INR)
    assert detail["previous"]["id"] == first


def test_a_failing_answer_is_retried_once_with_its_problems(api: Api, scripted):
    _household(api)
    bad = copy.deepcopy(ANSWER)
    bad["scenarios"]["balanced"]["rebalance"] = [{"key": "USD:funds", "target_pct": 90}]
    bad["fx"] = []
    script = scripted(Script(bad, ANSWER))
    events = _run(api, BODY)
    assert events[-1]["type"] == "result"
    retry = next(e for e in events if e.get("status") == "retry")
    assert "fx: missing INR" in retry["problems"]
    assert any("sum to 90%" in p for p in retry["problems"])
    assert len(script.calls) == 2
    assert "failed these checks" in script.calls[1]["messages"][1]["content"]


def test_two_failing_answers_save_nothing(api: Api, scripted):
    _household(api)
    bad = copy.deepcopy(ANSWER)
    bad["scenarios"]["aggressive"]["return_pct"] = 25
    scripted(Script(bad, bad))
    events = _run(api, BODY)
    assert events[-1]["type"] == "error"
    assert "outside −5–20%" in events[-1]["message"]
    assert api.get("/api/estimator/inquiries").json() == []


def test_checks_catch_order_ranges_and_milestones():
    snap = {"today": "2026-11-08", "expenses": {"monthly": "1", "currency": "USD"}, "pool_by_currency": [{"currency": "USD", "value": "1"}]}
    bad = copy.deepcopy(ANSWER)
    bad["scenarios"]["conservative"]["return_pct"] = 9.5
    bad["scenarios"]["balanced"]["milestones"] = [{"year": 2035, "focus": "x"}, {"year": 2030, "focus": "y"}]
    bad["inflation"][0]["rate_pct"] = 22
    bad["structure"]["overall"] = 11
    problems = check(bad, snap)
    assert any("must rise from conservative" in p for p in problems)
    assert any("milestones" in p for p in problems)
    assert any("inflation USD" in p for p in problems)
    assert any("structure.overall" in p for p in problems)
    assert check(ANSWER, snap) == []
    unknown = copy.deepcopy(ANSWER)
    unknown["scenarios"]["balanced"]["rebalance"][0]["key"] = "USD:gold"
    assert any("unknown keys USD:gold" in p for p in check(unknown, {**snap, "target_keys": list(TARGETS)}))


def test_answer_schema_stays_small():
    """Anthropic refuses strict schemas whose grammar is too big: one scenario schema, no per-key enums."""
    from services.estimator.review import tool

    schema = tool()["function"]["parameters"]["properties"]
    assert schema["scenarios"]["type"] == "array"
    assert "enum" not in schema["scenarios"]["items"]["properties"]["rebalance"]["items"]["properties"]["key"]
    assert len(json.dumps(tool())) < 4000


def test_already_independent_and_never(api: Api):
    snap = {
        "today": "2026-11-08",
        "age": 40,
        "expenses": {"monthly": "100", "currency": "USD"},
        "withdrawal_rate_pct": "4",
        "pool_by_currency": [{"currency": "USD", "value": "1000000"}],
        "classes": [{"key": "USD:cash", "currency": "USD", "value": "1000000"}],
        "accounts": [],
    }
    answer = copy.deepcopy(ANSWER)
    answer["fx"] = []
    rich = compute(answer, snap, date(1986, 1, 1))["scenarios"]["balanced"]
    assert rich["years"] == 0 and rich["fi_year"] == 2026 and rich["fi_age"] == 40 and rich["progress"] == 1.0
    assert [m["fi"] for m in rich["milestones"]] == [True]
    poor = copy.deepcopy(snap)
    poor["expenses"]["monthly"] = "1000000"
    answer["scenarios"]["balanced"]["return_pct"] = 2.0
    never = compute(answer, poor, None)["scenarios"]["balanced"]
    assert never["fi_year"] is None and never["years"] is None and never["fi_nominal"] is None
    assert len(never["milestones"]) == 3 and never["change_years"][0] is None


def test_delete_scoping_and_errors(api: Api, other_api: Api, scripted):
    _household(api)
    scripted(Script(ANSWER))
    inquiry = _run(api, BODY)[-1]["id"]
    assert other_api.get(f"/api/estimator/inquiries/{inquiry}").status_code == 404
    assert other_api.delete(f"/api/estimator/inquiries/{inquiry}").status_code == 404
    assert api.delete(f"/api/estimator/inquiries/{inquiry}").status_code == 204
    assert api.get(f"/api/estimator/inquiries/{inquiry}").status_code == 404
    assert api.get("/api/estimator/inquiries").json() == []
    # Nothing in the pool, bad input.
    assert other_api.post("/api/estimator/inquiries", json=BODY).status_code == 422
    assert api.post("/api/estimator/inquiries", json={**BODY, "monthly_expenses": "0"}).status_code == 422
    assert api.post("/api/estimator/inquiries", json={**BODY, "currency": "usd"}).status_code == 422
    assert api.post("/api/estimator/inquiries", json={**BODY, "withdrawal_rate_pct": "0.5"}).status_code == 422


def test_without_a_key_says_what_is_missing(api: Api):
    _household(api)
    app.dependency_overrides[get_estimator_llm] = lambda: OpenRouter(api_key="", feature="The wealth estimator")
    try:
        res = api.post("/api/estimator/inquiries", json=BODY)
        assert res.status_code == 503
        assert res.json()["detail"].startswith("The wealth estimator needs an OpenRouter key")
    finally:
        app.dependency_overrides.pop(get_estimator_llm, None)


def test_model_errors_come_back_as_an_error_event(api: Api):
    _household(api)
    app.dependency_overrides[get_estimator_llm] = lambda: OpenRouter(
        transport=httpx.MockTransport(lambda r: httpx.Response(402, json={})), api_key="k"
    )
    try:
        events = _run(api, BODY)
        assert events[-1] == {"type": "error", "message": "The OpenRouter account is out of credits."}
    finally:
        app.dependency_overrides.pop(get_estimator_llm, None)


def test_deleting_a_workspace_deletes_its_inquiries(api: Api, scripted):
    import uuid

    from sqlalchemy import text

    from database import SessionLocal, engine
    from services.soft_delete import delete_workspace

    _household(api)
    scripted(Script(ANSWER))
    _run(api, BODY)
    with SessionLocal() as db:
        delete_workspace(db, uuid.UUID(api.workspace_id))
        db.commit()
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM wealth_inquiries WHERE deleted_at IS NULL")).scalar_one() == 0
