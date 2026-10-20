import uuid
from datetime import date

from database import SessionLocal
from models import Tenant
from services import analytics
from tests.conftest import Api


def _overview(api: Api, today: date) -> dict:
    with SessionLocal() as db:  # type: Session
        tenant = db.get(Tenant, uuid.UUID(api.tenant_id))
        return analytics.overview(db, tenant, "all", today=today)


def test_per_currency_series_with_carry_forward_and_close(api: Api):
    tags = api.tags()
    usd = api.account(name="Chase", currency="USD", tag_ids=[tags["salary"]])
    old = api.account(name="Wells", currency="USD", closed_on="2024-03-15")
    inr = api.account(name="SBI", currency="INR", tag_ids=[tags["savings"]])
    api.balance(usd["id"], "100", "2024-01-10")
    api.balance(usd["id"], "150", "2024-03-05")
    api.balance(old["id"], "40", "2024-01-20")
    api.balance(inr["id"], "1000", "2024-02-01")
    port = api.portfolio(name="Fidelity", currency="USD", tag_ids=[tags["trading"]])
    api.snapshot(port["id"], "2024-02-28", [("AAPL", 2, 100, "stock"), ("BND", 1, 50, "bond")])

    data = _overview(api, today=date(2024, 4, 10))
    assert data["months"] == ["2024-01", "2024-02", "2024-03", "2024-04"]
    usd_series = next(c for c in data["currencies"] if c["currency"] == "USD")
    # Jan: 100+40; Feb: 100+40 + 250 portfolio; Mar: 150 (Wells closed mid-March) + 250; Apr: same.
    assert [str(v) for v in usd_series["accounts"]] == ["140.0000", "140.0000", "150.0000", "150.0000"]
    assert [None if v is None else str(v) for v in usd_series["portfolios"]] == [None, "250.0000", "250.0000", "250.0000"]
    assert str(usd_series["total"][-1]) == "400.0000"
    assert usd_series["account_count"] == 1  # closed accounts aren't counted as active

    inr_series = next(c for c in data["currencies"] if c["currency"] == "INR")
    assert inr_series["accounts"][0] is None and str(inr_series["accounts"][1]) == "1000.0000"

    salary = next(t for t in data["tags"] if t["tag"] == "salary")
    assert [str(v) for v in salary["currencies"][0]["values"]] == ["100.0000", "100.0000", "150.0000", "150.0000"]

    classes = {s["label"]: str(s["value"]) for s in next(a for a in data["allocation"]["by_asset_class"] if a["currency"] == "USD")["slices"]}
    assert classes == {"cash": "150.0000", "stock": "200.0000", "bond": "50.0000"}

    kinds = {(e["kind"], e["name"]) for e in data["timeline"]}
    assert ("account_closed", "Wells") in kinds


def test_overview_endpoint_ranges(api: Api):
    acc = api.account()
    api.balance(acc["id"], "10", date.today().isoformat())
    for key, months in (("6m", 6), ("1y", 12), ("3y", 36)):
        data = api.get("/api/analytics/overview", params={"range": key}).json()
        assert len(data["months"]) == months
    assert len(api.get("/api/analytics/overview", params={"range": "all"}).json()["months"]) == 1


def test_top_assets_merge_holdings_and_skip_debts_closed_and_linked(api: Api):
    chase = api.account(name="Chase", currency="USD")
    card = api.account(name="Amex", currency="USD", account_type="other")
    gone = api.account(name="Wells", currency="USD", closed_on="2024-03-15")
    sbi = api.account(name="SBI", currency="INR")
    api.balance(chase["id"], "300", "2024-01-10")
    api.balance(card["id"], "-900", "2024-01-10")
    api.balance(gone["id"], "5000", "2024-01-10")
    api.balance(sbi["id"], "1000", "2024-01-10")
    schwab_cash = api.account(name="Schwab cash", currency="USD", account_type="brokerage")
    api.balance(schwab_cash["id"], "700", "2024-01-10")
    old_cash = api.account(name="Old broker cash", currency="USD", account_type="brokerage")
    api.balance(old_cash["id"], "20", "2024-01-10")
    schwab = api.portfolio(name="Schwab", currency="USD", account_id=schwab_cash["id"])  # its cash is the portfolio's
    api.portfolio(name="Old broker", currency="USD", account_id=old_cash["id"], closed_on="2024-02-01")
    fidelity = api.portfolio(name="Fidelity", currency="USD")
    api.snapshot(schwab["id"], "2024-02-01", [("VTI", 1, 100, "etf"), ("bnd", 1, 50, "bond")])
    api.snapshot(fidelity["id"], "2024-02-01", [("vti", 2, 100, "etf")])

    data = _overview(api, today=date(2024, 4, 10))
    usd = next(c for c in data["top_assets"] if c["currency"] == "USD")["assets"]
    assert [(a["kind"], a["name"], str(a["value"])) for a in usd] == [
        ("account", "Chase", "300.0000"),
        ("holding", "VTI", "300.0000"),
        ("holding", "BND", "50.0000"),
        ("account", "Old broker cash", "20.0000"),  # its portfolio is closed, so it counts again
    ]
    vti = usd[1]
    assert vti["symbol"] == "VTI" and vti["group"] == "etf" and vti["held_in"] == ["Fidelity", "Schwab"]
    assert usd[0]["group"] == "checking" and usd[0]["held_in"] == []
    assert [a["name"] for a in next(c for c in data["top_assets"] if c["currency"] == "INR")["assets"]] == ["SBI"]


def test_linked_account_counts_through_its_portfolio_while_open(api: Api):
    tags = api.tags()
    cash = api.account(name="Schwab cash", currency="USD", account_type="brokerage", tag_ids=[tags["trading"]])
    api.balance(cash["id"], "1000", "2024-01-10")
    api.portfolio(name="Schwab", currency="USD", account_id=cash["id"], closed_on="2024-02-15")
    other = api.portfolio(name="Fidelity", currency="USD")
    api.snapshot(other["id"], "2024-01-05", [("VTI", 1, 500, "etf")])

    data = _overview(api, today=date(2024, 3, 10))
    usd = next(c for c in data["currencies"] if c["currency"] == "USD")
    # Jan: hidden behind Schwab; Feb month-end: Schwab closed on the 15th, so the cash is back.
    assert [None if v is None else str(v) for v in usd["accounts"]] == [None, "1000.0000", "1000.0000"]
    assert str(usd["total"][0]) == "500.0000"
    assert usd["account_count"] == 1

    data = _overview(api, today=date(2024, 2, 1))  # Schwab still open
    usd = next(c for c in data["currencies"] if c["currency"] == "USD")
    assert usd["current_accounts"] is None and usd["account_count"] == 0
    by_type = {s["label"] for s in data["allocation"]["by_type"][0]["slices"]}
    assert by_type == {"portfolio"}
    trading = next(t for t in data["tags"] if t["tag"] == "trading")
    assert trading["currencies"][0]["values"] == [None, None]
