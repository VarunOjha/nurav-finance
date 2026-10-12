from tests.conftest import Api


def test_snapshot_diff_new_sold_changed(api: Api):
    port = api.portfolio(name="Fidelity")
    api.snapshot(port["id"], "2024-08-31", [("AAPL", 10, 100, "stock"), ("BND", 5, 70, "bond")])
    latest = api.snapshot(port["id"], "2024-09-30", [("AAPL", 20, 110, "stock"), ("VTI", 3, 250, "etf")])

    detail = api.get(f"/api/portfolios/{port['id']}/snapshots/{latest['id']}").json()
    by_symbol = {h["symbol"]: h for h in detail["holdings"]}
    assert by_symbol["AAPL"]["status"] == "changed" and by_symbol["AAPL"]["quantity_change"] == "10.00000000"
    assert by_symbol["VTI"]["status"] == "new"
    assert by_symbol["BND"]["status"] == "sold" and by_symbol["BND"]["value_change"] == "-350.0000"
    assert detail["current"]["total"] == "2950.0000"
    assert detail["previous"]["total"] == "1350.0000"
    assert detail["change"] == "1600.0000"

    summary = api.get(f"/api/portfolios/{port['id']}").json()
    assert summary["value"] == "2950.0000" and summary["delta"] == "1600.0000"
    assert summary["holdings_count"] == 2 and summary["snapshot_count"] == 2


def test_backdated_snapshot_slots_in_by_date(api: Api):
    port = api.portfolio()
    jan = api.snapshot(port["id"], "2024-01-31", [("AAPL", 1, 100, "stock")])
    mar = api.snapshot(port["id"], "2024-03-31", [("AAPL", 3, 100, "stock")])
    # Recorded last, dated February.
    api.snapshot(port["id"], "2024-02-29", [("AAPL", 2, 100, "stock")])

    detail = api.get(f"/api/portfolios/{port['id']}/snapshots/{mar['id']}").json()
    assert detail["previous"]["as_of"] == "2024-02-29"
    prefill = api.get(f"/api/portfolios/{port['id']}/snapshots/prefill", params={"as_of": "2024-02-15"}).json()
    assert prefill["based_on"]["id"] == jan["id"]
    assert [h["quantity"] for h in prefill["holdings"]] == ["1.00000000"]
    # Latest by date is still March.
    assert api.get(f"/api/portfolios/{port['id']}").json()["value"] == "300.0000"


def test_snapshot_validation(api: Api):
    port = api.portfolio(opened_on="2024-01-01")
    url = f"/api/portfolios/{port['id']}/snapshots"
    dup_symbols = {
        "as_of": "2024-02-01",
        "holdings": [{"symbol": "aapl", "quantity": "1", "price": "1"}, {"symbol": "AAPL", "quantity": "1", "price": "1"}],
    }
    assert api.post(url, json=dup_symbols).status_code == 422
    early = {"as_of": "2023-12-01", "holdings": [{"symbol": "X", "quantity": "1", "price": "1"}]}
    assert api.post(url, json=early).status_code == 422
    assert api.post(url, json={"as_of": "2024-02-01", "holdings": []}).status_code == 422


def test_consolidated_merges_symbols_per_currency(api: Api):
    fid = api.portfolio(name="Fidelity")
    rh = api.portfolio(name="Robinhood")
    zer = api.portfolio(name="Zerodha", currency="INR")
    api.snapshot(fid["id"], "2024-09-30", [("AAPL", 40, 200, "stock"), ("BND", 10, 70, "bond")])
    api.snapshot(rh["id"], "2024-09-30", [("AAPL", 15, 200, "stock")])
    api.snapshot(zer["id"], "2024-09-30", [("INFY", 10, 1800, "stock")])

    data = api.get("/api/portfolios/consolidated").json()["currencies"]
    usd = next(c for c in data if c["currency"] == "USD")
    aapl = next(h for h in usd["holdings"] if h["symbol"] == "AAPL")
    assert aapl["quantity"] == "55.00000000"
    assert aapl["portfolios"] == ["Fidelity", "Robinhood"]
    assert usd["total"] == "11700.0000"
    assert {s["label"] for s in usd["by_portfolio"]} == {"Fidelity", "Robinhood"}
    inr = next(c for c in data if c["currency"] == "INR")
    assert inr["total"] == "18000.0000"


def test_portfolio_account_link_must_be_same_tenant(api: Api):
    other = api.post("/api/tenants", json={"name": "Parents"}).json()
    foreign = api.post("/api/accounts", json={"name": "X", "account_type": "brokerage", "currency": "USD"}, tenant_id=other["id"]).json()
    res = api.post("/api/portfolios", json={"name": "P", "currency": "USD", "account_id": foreign["id"]})
    assert res.status_code == 404
