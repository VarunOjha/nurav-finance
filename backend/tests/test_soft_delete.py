"""Deleted rows must be fully ignored: lists, sums, counts, analytics, uniqueness."""

from sqlalchemy import func, select, text

from database import SessionLocal, engine
from models import Account, BalanceEntry
from tests.conftest import Api


def test_deleted_entry_is_ignored_everywhere(api: Api):
    acc = api.account()
    api.balance(acc["id"], "100", "2024-03-01")
    wrong = api.balance(acc["id"], "999", "2024-04-01")
    assert api.delete(f"/api/accounts/{acc['id']}/balances/{wrong['id']}").status_code == 204

    assert api.get(f"/api/accounts/{acc['id']}").json()["balance"] == "100.0000"
    history = api.get(f"/api/accounts/{acc['id']}/balances").json()
    assert [e["amount"] for e in history["entries"]] == ["100.0000"]
    assert {m["balance"] for m in history["monthly"]} == {"100.0000"}
    overview = api.get("/api/analytics/overview", params={"range": "all"}).json()
    assert "999.0000" not in str(overview)

    # The row still exists physically…
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM balance_entries")).scalar_one() == 2
    # …but ORM queries, including bare aggregates, never see it.
    with SessionLocal() as db:
        assert db.scalar(select(func.count(BalanceEntry.id))) == 1
        assert db.scalar(select(func.sum(BalanceEntry.amount))) == 100


def test_deleting_account_cascades_and_hides_it(api: Api):
    tags = api.tags()
    acc = api.account(tag_ids=[tags["savings"]], identifiers=[{"label": "IFSC", "value": "X"}], account_number="123456")
    api.balance(acc["id"], "50", "2024-01-01")
    port = api.portfolio(account_id=acc["id"])
    assert api.delete(f"/api/accounts/{acc['id']}").status_code == 204

    assert api.get("/api/accounts").json() == []
    assert api.get(f"/api/accounts/{acc['id']}").status_code == 404
    assert {t["name"]: t["account_count"] for t in api.get("/api/tags").json()}["savings"] == 0
    assert api.tenants()[0]["account_count"] == 0
    # The portfolio survives, unlinked.
    assert api.get(f"/api/portfolios/{port['id']}").json()["account"] is None
    overview = api.get("/api/analytics/overview", params={"range": "all"}).json()
    assert overview["currencies"][0]["account_count"] == 0

    with engine.connect() as conn:
        live = conn.execute(
            text(
                "SELECT (SELECT count(*) FROM account_identifiers WHERE deleted_at IS NULL)"
                " + (SELECT count(*) FROM account_tags WHERE deleted_at IS NULL)"
                " + (SELECT count(*) FROM balance_entries WHERE deleted_at IS NULL)"
            )
        ).scalar_one()
    assert live == 0


def test_deleted_rows_do_not_block_names_or_dates(api: Api):
    port = api.portfolio()
    snap = api.snapshot(port["id"], "2024-06-30", [("AAPL", 1, 100, "stock")])
    dup = api.post(
        f"/api/portfolios/{port['id']}/snapshots", json={"as_of": "2024-06-30", "holdings": [{"symbol": "AAPL", "quantity": "2", "current_price": "1"}]}
    )
    assert dup.status_code == 409
    assert api.delete(f"/api/portfolios/{port['id']}/snapshots/{snap['id']}").status_code == 204
    api.snapshot(port["id"], "2024-06-30", [("AAPL", 2, 100, "stock")])

    tag = api.post("/api/tags", json={"name": "travel"}).json()
    api.delete(f"/api/tags/{tag['id']}")
    assert api.post("/api/tags", json={"name": "travel"}).status_code == 201


def test_relationship_loads_skip_deleted_children(api: Api):
    acc = api.account(identifiers=[{"label": "A", "value": "1"}])
    api.patch(f"/api/accounts/{acc['id']}", json={"identifiers": [{"label": "B", "value": "2"}]})
    with SessionLocal() as db:
        account = db.scalar(select(Account))
        assert [i.label for i in account.identifiers] == ["B"]
