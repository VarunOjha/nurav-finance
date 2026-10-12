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
