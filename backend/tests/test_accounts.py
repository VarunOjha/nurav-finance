from datetime import date, timedelta

from sqlalchemy import text

from database import engine
from tests.conftest import Api


def test_account_number_is_encrypted_masked_and_revealable(api: Api):
    acc = api.account(
        name="SBI Savings",
        currency="INR",
        account_number="30000005521",
        identifiers=[{"label": "IFSC", "value": "SBIN0001234"}],
        links=[{"label": "Net banking", "url": "https://example.com/login"}],
    )
    assert acc["account_number_masked"] == "••••5521"
    assert "account_number" not in acc
    assert [i["label"] for i in acc["identifiers"]] == ["IFSC"]
    with engine.connect() as conn:
        stored = conn.execute(text("SELECT account_number_enc FROM accounts")).scalar_one()
    assert "30000005521" not in stored
    assert api.post(f"/api/accounts/{acc['id']}/reveal").json() == {"account_number": "30000005521"}


def test_update_replaces_lists_and_clears_number(api: Api):
    tags = api.tags()
    acc = api.account(
        account_number="1234", tag_ids=[tags["savings"]], identifiers=[{"label": "IFSC", "value": "X"}, {"label": "MICR", "value": "Y"}]
    )
    res = api.patch(
        f"/api/accounts/{acc['id']}",
        json={
            "account_number": "",
            "tag_ids": [tags["trading"]],
            "identifiers": [{"label": "SWIFT", "value": "Z"}],
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["account_number_masked"] is None and body["has_account_number"] is False
    assert [t["name"] for t in body["tags"]] == ["trading"]
    assert [i["label"] for i in body["identifiers"]] == ["SWIFT"]


def test_backdated_entries_drive_latest_and_month_end(api: Api):
    acc = api.account(opened_on="2024-01-01")
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
    acc = api.account(opened_on="2024-01-10", closed_on="2024-12-31")
    future = (date.today() + timedelta(days=3)).isoformat()
    bad = [
        ("2024-01-01", "before opened"),
        ("2025-01-02", "after closed"),
        (future, "future"),
    ]
    for as_of, _ in bad:
        res = api.post(f"/api/accounts/{acc['id']}/balances", json={"amount": "1", "as_of": as_of})
        assert res.status_code == 422, as_of
    api.balance(acc["id"], "1", "2024-02-01")
    # Moving the opened date past existing entries is refused.
    assert api.patch(f"/api/accounts/{acc['id']}", json={"opened_on": "2024-03-01"}).status_code == 422
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
