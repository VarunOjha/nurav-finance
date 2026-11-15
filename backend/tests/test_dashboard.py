import uuid
from datetime import date

from database import SessionLocal
from models import Workspace
from services import dashboard
from tests.conftest import Api
from tests.test_buckets import _milestone


def _dash(api: Api, today: date) -> dict:
    with SessionLocal() as db:
        workspace = db.get(Workspace, uuid.UUID(api.workspace_id))
        return dashboard.dashboard(db, workspace, today=today)


def _setup(api: Api) -> dict:
    """Starter buckets: Growth / Emergency fund / Extra cash."""
    fd = api.account(name="SBI FD", account_type="fixed_deposit", currency="INR")
    api.balance(fd["id"], "900", "2025-03-01")
    api.split(fd["id"], {"Growth": 100})
    shares = api.portfolio(name="Zerodha", currency="INR")
    api.snapshot(shares["id"], "2025-03-01", [("INFY", 1, 100, "stock")])
    api.split(shares["account"]["id"], {"Growth": 100})

    save = api.account(name="Chase", account_type="savings", currency="USD")
    api.balance(save["id"], "100", "2024-06-01")
    api.balance(save["id"], "300", "2025-02-01")
    api.split(save["id"], {"Emergency fund": 50, "Extra cash": 50})
    us = api.portfolio(name="Fidelity", currency="USD")
    body = {
        "as_of": "2025-02-01",
        "holdings": [
            {"symbol": "MSFT", "quantity": "2", "current_price": "100", "buy_price": "50", "asset_class": "stock"},
            {"symbol": "VTI", "quantity": "1", "current_price": "100", "asset_class": "etf"},
        ],
    }
    assert api.post(f"/api/portfolios/{us['id']}/snapshots", json=body).status_code == 201
    api.split(us["account"]["id"], {"Growth": 100})
    rh = api.portfolio(name="Robinhood", currency="USD")
    api.snapshot(rh["id"], "2025-02-01", [("msft", 1, 100, "stock")])  # merges with Fidelity's MSFT
    api.split(rh["account"]["id"], {"Growth": 100})
    return {"save": save}


def test_dashboard_numbers(api: Api):
    _setup(api)
    _milestone(api, "2030", "2030-12-31", {"Growth": ("1000", "10"), "Emergency fund": "500", "Extra cash": "50"})
    _milestone(api, "growth-inr", "2031-12-31", {"Growth": ("5000", "8", "INR")})
    d = _dash(api, date(2025, 3, 15))

    assert d["next_milestone"]["name"] == "2030"
    usd, inr = d["currencies"]
    assert (usd["currency"], usd["account_count"]) == ("USD", 3)  # Chase + 2 brokerage accounts
    assert str(usd["net_worth"]) == "700.0000"  # 300 + Fidelity 300 + Robinhood 100
    assert [(y["year"], str(y["value"])) for y in usd["yearly"]] == [(2024, "100.0000"), (2025, "700.0000")]

    # Brokerage accounts are replaced by their holdings; MSFT merged across portfolios.
    top = [(e["name"], str(e["value"])) for e in usd["top_entries"]]
    assert top == [("Chase", "300.0000"), ("MSFT", "300.0000"), ("VTI", "100.0000")]  # ties by name
    assert usd["top_entries"][1]["held_in"] == ["Fidelity", "Robinhood"]

    # Robinhood's MSFT has no buy price, so the merged stock has no gain.
    stocks = usd["top_stocks"]
    assert [s["symbol"] for s in stocks] == ["MSFT"] and stocks[0]["gain_pct"] is None
    assert inr["top_stocks"][0]["symbol"] == "INFY"

    grid = usd["grid"]
    assert [b["name"] for b in grid["buckets"]] == ["Growth", "Emergency fund", "Extra cash"]
    rows = {r["name"]: [None if c is None else str(c) for c in r["cells"]] for r in grid["rows"]}
    assert rows["Chase"] == [None, "150.0000", "150.0000"]
    assert rows["Fidelity account"] == ["300.0000", None, None]
    assert [str(t) for t in grid["totals"]] == ["400.0000", "150.0000", "150.0000"]

    kinds = {(a["kind"], a["currency"]) for a in d["attention"]}
    # USD: Extra cash 150 > 50, Emergency 150 < 500 → rebalance; MSFT 300/400 of Growth → concentration.
    rebalance = next(a for a in d["attention"] if a["kind"] == "rebalance")
    assert (rebalance["bucket"]["name"], str(rebalance["amount"])) == ("Extra cash", "100.0000")
    assert (rebalance["other_bucket"]["name"], str(rebalance["other_amount"])) == ("Emergency fund", "350.0000")
    conc = next(a for a in d["attention"] if a["kind"] == "concentration" and a["currency"] == "USD")
    assert conc["symbol"] == "MSFT" and str(conc["share"]) == "0.750000"
    # INR Growth isn't in the next milestone, so no intent alert yet.
    assert ("intent", "INR") not in kinds

    chk = d["checkin"]
    assert chk["last"] == date(2025, 3, 1)
    assert {(i["kind"], i["name"]) for i in chk["items"]} == {
        ("balance", "SBI FD"),
        ("balance", "Chase"),
        ("holdings", "Zerodha"),
        ("holdings", "Fidelity"),
        ("holdings", "Robinhood"),
    }  # brokerage accounts are updated through their holdings


def test_intent_alert_for_growth_bucket_in_deposits(api: Api):
    _setup(api)
    _milestone(api, "2030", "2030-12-31", {"Growth": ("10000", "8", "INR")})
    d = _dash(api, date(2025, 3, 15))
    intent = next(a for a in d["attention"] if a["kind"] == "intent")
    assert (intent["bucket"]["name"], intent["label"], str(intent["share"])) == ("Growth", "fixed_deposits", "0.900000")


def test_dashboard_endpoint_empty_workspace(api: Api):
    res = api.get("/api/dashboard")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["currencies"] == [] and body["attention"] == [] and body["next_milestone"] is None


def test_one_milestone_per_date(api: Api):
    first = _milestone(api, "2030", "2030-12-31", {"Growth": "1"})
    _milestone(api, "other", "2030-12-31", {"Growth": "1"}, status=409)
    second = _milestone(api, "2035", "2035-12-31", {"Growth": "1"})
    body = {"name": "2035", "target_date": "2030-12-31", "lines": [{"bucket_id": api.buckets()["Growth"], "currency": "USD", "amount": "1"}]}
    assert api.put(f"/api/milestones/{second['id']}", json=body).status_code == 409
    # Saving a milestone on its own date is fine; a deleted one frees the date.
    body["name"] = "2030"
    assert api.put(f"/api/milestones/{first['id']}", json=body).status_code == 200
    assert api.delete(f"/api/milestones/{first['id']}").status_code == 204
    _milestone(api, "again", "2030-12-31", {"Growth": "1"})
