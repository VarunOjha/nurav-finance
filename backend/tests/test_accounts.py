from datetime import date, timedelta

from sqlalchemy import text

from database import engine
from tests.conftest import Api


def test_only_planning_fields_are_kept(api: Api):
    acc = api.account(
        name="SBI Savings",
        currency="INR",
        country="IN",
        institution="State Bank of India",
        links=[{"label": "Net banking", "url": "https://example.com/login"}],
        account_number="30000005521",  # no longer stored: ignored
        holder_name="Someone",
    )
    for gone in ("account_number_masked", "identifiers", "holder_name", "opened_on", "city", "notes"):
        assert gone not in acc
    assert [link["label"] for link in acc["links"]] == ["Net banking"]
    with engine.connect() as conn:
        columns = conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'accounts'")).scalars().all()
        assert not {"account_number_enc", "holder_name", "opened_on", "city", "notes"} & set(columns)
        assert conn.execute(text("SELECT to_regclass('account_identifiers')")).scalar_one() is None
    res = api.patch(f"/api/accounts/{acc['id']}", json={"links": [{"label": "App", "url": "https://example.com/app"}]})
    assert [link["label"] for link in res.json()["links"]] == ["App"]


def test_close_and_reopen(api: Api):
    acc = api.account()
    api.balance(acc["id"], "10", "2024-02-01")
    url = f"/api/accounts/{acc['id']}"
    assert api.patch(url, json={"closed_on": "2024-01-15"}).status_code == 422  # entries after it
    future = (date.today() + timedelta(days=3)).isoformat()
    assert api.patch(url, json={"closed_on": future}).status_code == 422
    closed = api.patch(url, json={"closed_on": date.today().isoformat()}).json()
    assert closed["status"] == "closed"
    assert api.patch(url, json={"closed_on": None}).json()["status"] == "active"


def test_backdated_entries_drive_latest_and_month_end(api: Api):
    acc = api.account()
    api.balance(acc["id"], "100", "2024-03-15")
    api.balance(acc["id"], "300", "2024-05-10")
    # Recorded later, but dated in between: becomes April's value, not the latest.
    api.balance(acc["id"], "200", "2024-04-20")

    summary = api.get(f"/api/accounts/{acc['id']}").json()
    assert summary["balance"] == "300.0000"
    assert summary["previous_balance"] == "200.0000"
    assert summary["delta"] == "100.0000"

    history = api.get(f"/api/accounts/{acc['id']}/balances").json()
    monthly = {m["month"]: m["balance"] for m in history["monthly"]}
    assert monthly["2024-03"] == "100.0000"
    assert monthly["2024-04"] == "200.0000"
    assert monthly["2024-05"] == "300.0000"
    assert monthly["2024-06"] == "300.0000"  # carried forward
    assert [e["as_of"] for e in history["entries"]] == ["2024-05-10", "2024-04-20", "2024-03-15"]


def test_same_day_entries_last_recorded_wins(api: Api):
    acc = api.account()
    api.balance(acc["id"], "100", "2024-03-15")
    api.balance(acc["id"], "150", "2024-03-15")
    entries = api.get(f"/api/accounts/{acc['id']}/balances").json()["entries"]
    assert [(e["amount"], e["effective"]) for e in entries] == [("150.0000", True), ("100.0000", False)]
    assert api.get(f"/api/accounts/{acc['id']}").json()["balance"] == "150.0000"


def test_entry_date_rules(api: Api):
    acc = api.account(closed_on="2024-12-31")
    future = (date.today() + timedelta(days=3)).isoformat()
    bad = [
        ("2025-01-02", "after closed"),
        (future, "future"),
    ]
    for as_of, _ in bad:
        res = api.post(f"/api/accounts/{acc['id']}/balances", json={"amount": "1", "as_of": as_of})
        assert res.status_code == 422, as_of
    api.balance(acc["id"], "1", "1999-02-01")  # any past date: there is no opened date
    # Currency is locked once balances exist.
    assert api.patch(f"/api/accounts/{acc['id']}", json={"currency": "EUR"}).status_code == 409


def test_opening_balance_on_create(api: Api):
    acc = api.account(opening_balance={"amount": "5000", "as_of": "2023-06-30"})
    assert acc["balance"] == "5000.0000" and acc["balance_as_of"] == "2023-06-30"


def test_status_filter(api: Api):
    api.account(name="Open")
    api.account(name="Old", closed_on="2024-01-01")
    names = lambda status: [a["name"] for a in api.get("/api/accounts", params={"status": status}).json()]  # noqa: E731
    assert names("active") == ["Open"]
    assert names("closed") == ["Old"]
    assert set(names("all")) == {"Open", "Old"}


def test_investment_account_type(api: Api):
    acc = api.account(name="Wealthfront Automated", institution="Wealthfront", account_type="investment", currency="USD")
    assert acc["account_type"] == "investment"
    assert api.patch(f"/api/accounts/{acc['id']}", json={"account_type": "brokerage"}).json()["account_type"] == "brokerage"
    assert api.post("/api/accounts", json={"name": "X", "account_type": "robo", "currency": "USD"}).status_code == 422
