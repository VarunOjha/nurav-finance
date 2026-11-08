from decimal import Decimal

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
        "holdings": [{"symbol": "aapl", "quantity": "1", "current_price": "1"}, {"symbol": "AAPL", "quantity": "1", "current_price": "1"}],
    }
    assert api.post(url, json=dup_symbols).status_code == 422
    early = {"as_of": "2023-12-01", "holdings": [{"symbol": "X", "quantity": "1", "current_price": "1"}]}
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


def test_portfolio_account_link_must_be_same_workspace(api: Api):
    other = api.post("/api/workspaces", json={"name": "Parents"}).json()
    foreign = api.post("/api/accounts", json={"name": "X", "account_type": "brokerage", "currency": "USD"}, workspace_id=other["id"]).json()
    res = api.post("/api/portfolios", json={"name": "P", "currency": "USD", "account_id": foreign["id"]})
    assert res.status_code == 404


def test_buy_price_gives_cost_and_gain(api: Api):
    port = api.portfolio()
    url = f"/api/portfolios/{port['id']}/snapshots"
    holdings = [
        {"symbol": "AAPL", "quantity": "10", "buy_price": "150", "current_price": "200"},
        {"symbol": "VTI", "quantity": "2", "current_price": "250"},  # cost unknown
    ]
    snap = api.post(url, json={"as_of": "2024-01-31", "holdings": holdings})
    assert snap.status_code == 201, snap.text
    assert snap.json()["total"] == "2500.0000"  # valued at current price

    rows = {h["symbol"]: h for h in api.get(f"{url}/{snap.json()['id']}").json()["holdings"]}
    assert rows["AAPL"]["buy_price"] == "150.000000"
    assert rows["AAPL"]["current_price"] == "200.000000"
    assert (rows["AAPL"]["cost"], rows["AAPL"]["gain"]) == ("1500.0000", "500.0000")
    assert (rows["VTI"]["buy_price"], rows["VTI"]["cost"], rows["VTI"]["gain"]) == (None, None, None)

    prefill = api.get(f"{url}/prefill", params={"as_of": "2024-02-29"}).json()["holdings"]
    assert {h["symbol"]: h["buy_price"] for h in prefill} == {"AAPL": "150.000000", "VTI": None}

    bad = {"as_of": "2024-02-29", "holdings": [{"symbol": "X", "quantity": "1", "buy_price": "-1", "current_price": "1"}]}
    assert api.post(url, json=bad).status_code == 422


def test_snapshot_summary_reports_cost_of_holdings_with_buy_price(api: Api):
    port = api.portfolio()
    url = f"/api/portfolios/{port['id']}/snapshots"
    holdings = [
        {"symbol": "AAPL", "quantity": "10", "buy_price": "150", "current_price": "200"},
        {"symbol": "MSFT", "quantity": "1", "buy_price": "300.5", "current_price": "400"},
        {"symbol": "VTI", "quantity": "2", "current_price": "250"},
    ]
    summary = api.post(url, json={"as_of": "2024-01-31", "holdings": holdings}).json()
    assert (summary["cost"], summary["cost_holdings"]) == ("1800.5000", 2)

    bare = api.post(url, json={"as_of": "2024-02-29", "holdings": [{"symbol": "X", "quantity": "1", "current_price": "1"}]}).json()
    assert (bare["cost"], bare["cost_holdings"]) == (None, 0)


def test_consolidated_history_is_month_end_value_per_portfolio(api: Api):
    from datetime import date

    from services.ledger import add_months, month_end, month_key

    today = date.today()
    three_ago = month_end(add_months(today, -3))
    last = month_end(add_months(today, -1))
    a = api.portfolio(name="Beta")
    b = api.portfolio(name="Alpha")
    api.snapshot(a["id"], three_ago.isoformat(), [("AAPL", 1, 100, "stock")])
    api.snapshot(a["id"], last.isoformat(), [("AAPL", 1, 150, "stock")])
    api.snapshot(b["id"], last.isoformat(), [("BND", 2, 50, "bond")])

    usd = next(c for c in api.get("/api/portfolios/consolidated").json()["currencies"] if c["currency"] == "USD")
    assert len(usd["months"]) == 12 and usd["months"][-1] == month_key(today)
    assert [s["portfolio"] for s in usd["history"]] == ["Alpha", "Beta"]
    beta = usd["history"][1]["values"]
    assert beta[-5] is None  # before the first snapshot
    assert beta[-4:] == ["100.0000", "100.0000", "150.0000", "150.0000"]  # carried forward
    assert usd["history"][0]["values"][-2:] == ["100.0000", "100.0000"]


def test_portfolio_must_belong_to_a_brokerage_account(api: Api):
    assert api.post("/api/portfolios", json={"name": "P", "currency": "USD"}).status_code == 422
    savings = api.account(name="Savings", account_type="savings")
    res = api.post("/api/portfolios", json={"name": "P", "currency": "USD", "account_id": savings["id"]})
    assert res.status_code == 422 and "brokerage" in res.json()["detail"]

    broker = api.account(name="Robinhood", account_type="brokerage")
    port = api.portfolio(name="Robinhood", account_id=broker["id"])
    assert port["account"]["id"] == broker["id"]
    assert api.patch(f"/api/portfolios/{port['id']}", json={"account_id": None}).status_code == 422
    assert api.patch(f"/api/portfolios/{port['id']}", json={"account_id": savings["id"]}).status_code == 422
    # The account can't stop being a brokerage account while it has portfolios.
    assert api.patch(f"/api/accounts/{broker['id']}", json={"account_type": "savings"}).status_code == 409
    assert api.get(f"/api/accounts/{broker['id']}").json()["portfolios"] == [{"id": port["id"], "name": "Robinhood"}]


def test_consolidated_shows_starting_stake_from_avg_buy_price(api: Api):
    def snap(pid: str, rows: list[tuple]):
        holdings = [{"symbol": s, "quantity": q, "buy_price": b, "current_price": c} for s, q, b, c in rows]
        res = api.post(f"/api/portfolios/{pid}/snapshots", json={"as_of": "2024-06-28", "holdings": holdings})
        assert res.status_code == 201, res.text

    a = api.portfolio(name="Robinhood")
    b = api.portfolio(name="Schwab")
    snap(a["id"], [("AAPL", "10", "100", "200"), ("MSFT", "5", "200", "300"), ("TSLA", "1", None, "250")])
    snap(b["id"], [("AAPL", "10", "150", "200")])

    usd = api.get("/api/portfolios/consolidated").json()["currencies"][0]
    by = {h["symbol"]: h for h in usd["holdings"]}
    aapl, msft, tsla = by["AAPL"], by["MSFT"], by["TSLA"]
    # AAPL: 10 @ 100 + 10 @ 150 → cost 2,500, avg 125; value 4,000.
    assert Decimal(aapl["cost"]) == 2500 and Decimal(aapl["avg_buy_price"]) == 125
    assert Decimal(aapl["current_price"]) == 200 and Decimal(aapl["gain"]) == 1500 and Decimal(aapl["gain_pct"]) == Decimal("0.6")
    # Starting stake is over the holdings with a known cost (2,500 + 1,000).
    assert Decimal(aapl["cost_share"]) == Decimal("0.714286") and Decimal(msft["cost_share"]) == Decimal("0.285714")
    # Current share is over the whole value (4,000 + 1,500 + 250).
    assert Decimal(aapl["share"]) == Decimal("0.695652")
    # No buy price anywhere → no cost figures.
    assert tsla["cost"] is None and tsla["avg_buy_price"] is None and tsla["cost_share"] is None and tsla["gain"] is None
    # Cost-side breakdowns cover the same holdings as the starting stake.
    assert {s["label"]: Decimal(s["value"]) for s in usd["cost_by_portfolio"]} == {"Robinhood": 2000, "Schwab": 1500}
    assert {s["label"]: Decimal(s["value"]) for s in usd["cost_by_asset_class"]} == {"stock": 3500}
