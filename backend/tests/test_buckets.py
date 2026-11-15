import uuid
from datetime import date, timedelta
from decimal import Decimal

from database import SessionLocal
from models import Workspace
from services import analytics, metrics
from tests.conftest import Api


def _overview(api: Api, today: date, workspace_id: str | None = None) -> dict:
    with SessionLocal() as db:
        workspace = db.get(Workspace, uuid.UUID(workspace_id or api.workspace_id))
        return analytics.overview(db, workspace, "all", today=today)


def _metrics(api: Api, today: date) -> dict:
    with SessionLocal() as db:
        return metrics.metrics(db, db.get(Workspace, uuid.UUID(api.workspace_id)), today=today)


def _rows(data: dict, currency: str = "USD") -> dict:
    names = {b["id"]: b["name"] for b in data["buckets"]["buckets"]}
    cur = next(c for c in data["buckets"]["currencies"] if c["currency"] == currency)
    return {names.get(r["bucket_id"], "Unassigned"): r for r in cur["rows"]}


def _s(values):
    return [None if v is None else str(v) for v in values]


# ── bucket definitions ────────────────────────────────────────────────────────


def test_bucket_crud_names_colours_order_and_seed(api: Api):
    buckets = api.get("/api/buckets").json()
    assert [(b["name"], b["color"], b["position"]) for b in buckets] == [("Growth", 0, 0), ("Emergency fund", 1, 1), ("Extra cash", 2, 2)]

    rivian = api.post("/api/buckets", json={"name": "  Rivian  ", "description": "R2"}).json()
    assert rivian["name"] == "Rivian" and rivian["color"] == 3 and rivian["position"] == 3
    assert api.post("/api/buckets", json={"name": "rivian"}).status_code == 409  # case-insensitive
    assert api.patch(f"/api/buckets/{rivian['id']}", json={"name": "GROWTH"}).status_code == 409
    renamed = api.patch(f"/api/buckets/{rivian['id']}", json={"name": "Rivian R2", "color": 6}).json()
    assert (renamed["name"], renamed["color"]) == ("Rivian R2", 6)

    ids = [b["id"] for b in api.get("/api/buckets").json()]
    reordered = api.client.put("/api/buckets/order", json={"ids": ids[::-1]}, headers=api.headers()).json()
    assert [b["name"] for b in reordered][0] == "Rivian R2"
    assert api.client.put("/api/buckets/order", json={"ids": ids[:2]}, headers=api.headers()).status_code == 422

    # Never used → it can really go; seeding brings back only missing starters.
    growth = api.buckets()["Growth"]
    assert api.delete(f"/api/buckets/{growth}").status_code == 204
    names = [b["name"] for b in api.post("/api/buckets/seed").json()]
    assert sorted(names) == sorted(["Growth", "Emergency fund", "Extra cash", "Rivian R2"])


def test_buckets_belong_to_the_user_and_are_shared_by_workspaces(api: Api, other_api: Api):
    second = api.post("/api/workspaces", json={"name": "Family"}).json()
    acc = api.post("/api/accounts", json={"name": "Joint", "account_type": "savings", "currency": "USD"}, workspace_id=second["id"]).json()
    growth = api.buckets()["Growth"]
    res = api.post(f"/api/accounts/{acc['id']}/splits", json={"lines": [{"bucket_id": growth, "percent": "100"}]}, workspace_id=second["id"])
    assert res.status_code == 201, res.text
    listing = {b["name"]: b for b in api.get("/api/buckets").json()}
    assert [(a["name"], a["workspace_name"]) for a in listing["Growth"]["current_accounts"]] == [("Joint", "Family")]

    # Someone else's bucket is unknown here.
    mine = other_api.account()
    res = other_api.post(f"/api/accounts/{mine['id']}/splits", json={"lines": [{"bucket_id": growth, "percent": "100"}]})
    assert res.status_code == 422


def test_archive_needs_no_current_split_and_used_buckets_cannot_be_deleted(api: Api):
    acc = api.account(name="Ally")
    api.split(acc["id"], {"Growth": 60, "Extra cash": 40})
    extra = api.buckets()["Extra cash"]

    res = api.post(f"/api/buckets/{extra}/archive")
    assert res.status_code == 409 and "Ally" in res.json()["detail"]
    assert api.delete(f"/api/buckets/{extra}").status_code == 409

    api.split(acc["id"], {"Growth": 100}, effective_from=date.today().isoformat())
    archived = api.post(f"/api/buckets/{extra}/archive").json()
    assert archived["archived"] is True and archived["used"] is True
    assert api.delete(f"/api/buckets/{extra}").status_code == 409  # history keeps it

    # Archived: not usable in new splits or targets, still named in history.
    api.split(acc["id"], {"Extra cash": 100}, effective_from=date.today().isoformat(), status=422)
    line = {"bucket_id": extra, "currency": "USD", "amount": "10"}
    assert api.post("/api/milestones", json={"name": "2030", "target_date": "2030-01-01", "lines": [line]}).status_code == 422
    history = api.get(f"/api/accounts/{acc['id']}/splits").json()["history"]
    assert any(line["name"] == "Extra cash" and line["archived"] for line in history[-1]["lines"])

    assert api.post(f"/api/buckets/{extra}/unarchive").json()["archived"] is False


# ── splits ────────────────────────────────────────────────────────────────────


def test_split_validation_and_versions(api: Api):
    acc = api.account(name="Chase")
    api.balance(acc["id"], "1000", "2024-01-10")
    ids = api.buckets()
    url = f"/api/accounts/{acc['id']}/splits"

    assert api.get(url).json()["current"] is None  # Unassigned
    assert api.get("/api/accounts").json()[0]["buckets"] == []

    bad = [
        [{"bucket_id": ids["Growth"], "percent": "60"}],  # 60 ≠ 100
        [{"bucket_id": ids["Growth"], "percent": "50"}, {"bucket_id": ids["Growth"], "percent": "50"}],  # duplicate
        [{"bucket_id": ids["Growth"], "percent": "0"}, {"bucket_id": ids["Extra cash"], "percent": "100"}],  # zero line
        [{"bucket_id": ids["Growth"], "percent": "33.333"}, {"bucket_id": ids["Extra cash"], "percent": "66.667"}],  # >2 dp
        [],
    ]
    for lines in bad:
        assert api.post(url, json={"lines": lines}).status_code == 422, lines

    # First split: its date is ignored — it covers all history.
    first = api.split(acc["id"], {"Growth": "33.33", "Extra cash": "66.67"}, effective_from="2025-06-01")
    assert first["current"]["effective_from"] is None and first["current"]["covers_history"] is True
    assert [str(line["value"]) for line in first["current"]["lines"]] == ["333.3000", "666.7000"]

    # Later ones need a date: not missing, not in the future.
    api.split(acc["id"], {"Growth": 100}, status=422)
    api.split(acc["id"], {"Growth": 100}, effective_from=(date.today() + timedelta(days=5)).isoformat(), status=422)

    api.split(acc["id"], {"Growth": 85, "Emergency fund": 15}, effective_from="2024-03-01")
    # Same date again replaces it (a correction), it doesn't stack.
    data = api.split(acc["id"], {"Growth": 80, "Emergency fund": 20}, effective_from="2024-03-01")
    assert [s["effective_from"] for s in data["history"]] == ["2024-03-01", None]
    assert data["history"][1]["until"] == "2024-02-29"
    assert [(line["name"], line["percent"]) for line in data["current"]["lines"]] == [("Growth", "80.0000"), ("Emergency fund", "20.0000")]
    summary = api.get("/api/accounts").json()[0]["buckets"]
    assert [(b["name"], b["percent"]) for b in summary] == [("Growth", "80.0000"), ("Emergency fund", "20.0000")]

    # Undo the change → the first split is in force again; undo that → Unassigned.
    after = api.delete(f"{url}/{data['current']['id']}").json()
    assert after["current"]["effective_from"] is None
    assert api.delete(f"{url}/{after['current']['id']}").json()["current"] is None


# ── analytics ─────────────────────────────────────────────────────────────────


def test_bucket_series_follow_effective_dates_and_portfolios_inherit(api: Api):
    chase = api.account(name="Chase", currency="USD")
    api.balance(chase["id"], "1000", "2024-01-10")
    api.split(chase["id"], {"Growth": 100})
    api.split(chase["id"], {"Growth": 85, "Emergency fund": 15}, effective_from="2024-03-01")

    broker = api.account(name="Schwab", currency="USD", account_type="brokerage")
    api.split(broker["id"], {"Growth": 50, "Extra cash": 50})
    port = api.portfolio(name="Schwab holdings", currency="USD", account_id=broker["id"])
    api.snapshot(port["id"], "2024-02-01", [("VTI", 2, 100, "etf")])

    loose = api.account(name="Loose", currency="USD")
    api.balance(loose["id"], "40", "2024-01-05")

    data = _overview(api, today=date(2024, 4, 10))
    rows = _rows(data)
    assert list(rows) == ["Growth", "Emergency fund", "Extra cash", "Unassigned"]
    # Jan: 1000; Feb: +100 from the portfolio's half; Mar: 85% of Chase + 100.
    assert _s(rows["Growth"]["values"]) == ["1000.0000", "1100.0000", "950.0000", "950.0000"]
    assert _s(rows["Emergency fund"]["values"]) == [None, None, "150.0000", "150.0000"]
    assert _s(rows["Extra cash"]["values"]) == [None, "100.0000", "100.0000", "100.0000"]
    assert _s(rows["Unassigned"]["values"]) == ["40.0000", "40.0000", "40.0000", "40.0000"]

    growth = rows["Growth"]
    assert str(growth["current"]) == "950.0000" and str(growth["change_1m"]) == "0.0000"
    assert str(growth["growth_pct"]) == "-5.0000"
    assert str(growth["share"]) == "0.766129"  # 950 of 1240
    # The portfolio's money shows under its brokerage account.
    assert [(s["name"], s["percent"], str(s["value"])) for s in growth["sources"]] == [
        ("Chase", Decimal("85"), "850.0000"),
        ("Schwab", Decimal("50"), "100.0000"),
    ]
    # 3-month pace from Jan month-end: Chase 1000 → 850. The portfolio was first
    # recorded inside the window (no opened date), so its start is unknown and it sits out.
    assert str(growth["pace_3m"]) == "-50.0000"


# ── milestones & metrics ──────────────────────────────────────────────────────


def _milestone(api: Api, name: str, when: str, lines: dict, start: str | None = None, status: int = 201, **kw) -> dict:
    """lines: {bucket name: amount or (amount, return) or (amount, return, currency)}."""
    ids = api.buckets()
    body_lines = []
    for bucket, spec in lines.items():
        amount, ret, currency = (spec, None, "USD") if isinstance(spec, str) else (*spec, "USD")[:3]
        body_lines.append({"bucket_id": ids[bucket], "currency": currency, "amount": amount, "expected_return": ret})
    body = {"name": name, "target_date": when, "start_date": start, "lines": body_lines}
    res = api.post("/api/milestones", json=body, **kw)
    assert res.status_code == status, res.text
    return res.json()


def test_milestones_crud_rules_and_scope(api: Api):
    m = _milestone(api, "2030", "2030-12-31", {"Growth": ("1000000", "8"), "Emergency fund": "60000"})
    assert m["start_date"] == date.today().isoformat()
    assert [(line["bucket_name"], line["amount"], line["expected_return"]) for line in m["lines"]] == [
        ("Growth", "1000000.0000", "8.000"),
        ("Emergency fund", "60000.0000", None),
    ]
    # Rules: unique name (any case), date after measure-from, at least one line, bucket+currency once.
    _milestone(api, "2030 ", "2031-12-31", {"Growth": "1"}, status=409)
    _milestone(api, "later", "2030-06-30", {"Growth": "1"}, start="2031-01-01", status=422)
    assert api.post("/api/milestones", json={"name": "empty", "target_date": "2030-12-31", "lines": []}).status_code == 422
    growth = api.buckets()["Growth"]
    twice = [{"bucket_id": growth, "currency": "USD", "amount": "1"}] * 2
    assert api.post("/api/milestones", json={"name": "dup", "target_date": "2031-06-30", "lines": twice}).status_code == 422
    # …but the same bucket in another currency is fine.
    _milestone(api, "2035", "2035-12-31", {"Growth": ("2000000", None, "USD")})
    counts = {b["name"]: b["milestone_count"] for b in api.get("/api/buckets").json()}
    assert counts["Growth"] == 2 and counts["Emergency fund"] == 1 and counts["Extra cash"] == 0
    inr = {"bucket_id": growth, "currency": "INR", "amount": "8000000"}
    res = api.put(
        f"/api/milestones/{m['id']}",
        json={"name": "2030", "target_date": "2030-12-31", "lines": [{"bucket_id": growth, "currency": "USD", "amount": "1"}, inr]},
    )
    assert res.status_code == 200, res.text

    # Save replaces lines: the kept one keeps its id, a dropped one is soft-deleted, a new one is added.
    before = {(line["bucket_name"], line["currency"]): line["id"] for line in api.get("/api/milestones").json()[0]["lines"]}
    body = {
        "name": "Year 2030",
        "target_date": "2030-06-30",
        "note": " house ",
        "lines": [
            {"bucket_id": growth, "currency": "INR", "amount": "9000000"},
            {"bucket_id": api.buckets()["Extra cash"], "currency": "USD", "amount": "5000"},
        ],
    }
    saved = api.put(f"/api/milestones/{m['id']}", json=body).json()
    assert (saved["name"], saved["target_date"], saved["start_date"], saved["note"]) == ("Year 2030", "2030-06-30", date.today().isoformat(), "house")
    after = {(line["bucket_name"], line["currency"]): line["id"] for line in saved["lines"]}
    assert list(after) == [("Growth", "INR"), ("Extra cash", "USD")]
    assert after[("Growth", "INR")] == before[("Growth", "INR")]

    # Per workspace.
    second = api.post("/api/workspaces", json={"name": "Family"}).json()
    assert api.get("/api/milestones", workspace_id=second["id"]).json() == []
    assert api.put(f"/api/milestones/{m['id']}", json=body, workspace_id=second["id"]).status_code == 404
    _milestone(api, "2030", "2030-12-31", {"Growth": "1"}, workspace_id=second["id"])  # names are per workspace

    assert api.delete(f"/api/milestones/{m['id']}").status_code == 204
    assert [x["name"] for x in api.get("/api/milestones").json()] == ["2035"]
    with SessionLocal() as db:
        from models import BucketTarget

        assert db.query(BucketTarget).filter(BucketTarget.milestone_id == uuid.UUID(m["id"])).count() == 0  # lines went with it
    # The name is free again.
    _milestone(api, "Year 2030", "2030-12-31", {"Growth": "1"})


def test_archived_bucket_stays_in_its_milestone_but_leaves_the_numbers(api: Api):
    acc = api.account(name="Chase", currency="USD")
    api.balance(acc["id"], "100", "2024-01-31")
    api.split(acc["id"], {"Growth": 100})
    m = _milestone(api, "2030", "2030-12-31", {"Growth": "1000", "Extra cash": "50"})
    extra = api.buckets()["Extra cash"]
    assert api.post(f"/api/buckets/{extra}/archive").status_code == 200
    lines = api.get("/api/milestones").json()[0]["lines"]
    assert [(line["bucket_name"], line["archived"]) for line in lines] == [("Growth", False), ("Extra cash", True)]
    # Saving it again keeps the archived line (it was already there).
    body = {
        "name": "2030",
        "target_date": "2030-12-31",
        "lines": [{"bucket_id": line["bucket_id"], "currency": "USD", "amount": line["amount"]} for line in lines],
    }
    assert api.put(f"/api/milestones/{m['id']}", json=body).status_code == 200
    view = _metrics(api, date(2024, 2, 1))["milestones"][0]
    assert [r["bucket"]["name"] for r in view["rows"]] == ["Growth"]


def test_metrics_by_milestone_rows_and_totals(api: Api):
    chase = api.account(name="Chase", currency="USD")
    api.balance(chase["id"], "1000", "2024-01-31")
    api.balance(chase["id"], "4000", "2024-07-31")
    api.split(chase["id"], {"Growth": 75, "Emergency fund": 25})  # Jul: Growth 3000, Emergency 1000
    today = date(2024, 7, 31)
    start = "2024-01-31"  # Growth 750, Emergency 250 then

    _milestone(api, "Early", "2024-03-31", {"Growth": "500", "Emergency fund": "2000"}, start="2024-01-01")  # past: achieved + missed
    _milestone(api, "2025", "2025-07-31", {"Growth": ("6000", None), "Emergency fund": "1100"}, start=start)
    _milestone(api, "2026", "2026-07-31", {"Growth": ("20000", "7")}, start=start)
    _milestone(api, "2027", "2027-07-31", {"Emergency fund": "900"}, start=start)  # already there

    data = _metrics(api, today)
    assert [v["name"] for v in data["milestones"]] == ["2025", "2026", "2027", "Early"]  # upcoming by date, then past
    by_name = {v["name"]: v for v in data["milestones"]}

    early = by_name["Early"]
    assert early["past"] and early["months_left"] is None
    assert [(r["bucket"]["name"], r["status"], str(r["value_on_date"])) for r in early["rows"]] == [
        ("Growth", "achieved", "750.0000"),
        ("Emergency fund", "missed", "250.0000"),
    ]
    assert [(t["currency"], str(t["current"]), str(t["amount"]), t["need"]) for t in early["totals"]] == [("USD", "1000.0000", "2500.0000", None)]

    m25 = by_name["2025"]
    growth, emergency = m25["rows"]
    assert (growth["bucket"]["name"], growth["status"], str(growth["current"]), str(growth["gap"])) == ("Growth", "open", "3000.0000", "3000.0000")
    # Growth path: 750 → 6000 over 18 months; 6 months in → 2500; at 3000 → ahead (beyond 1% of 6000).
    assert Decimal("2490") < growth["required_now"] < Decimal("2510") and growth["standing"] == "ahead"
    assert Decimal("245") < growth["need_flat"] < Decimal("255")  # 3000 over ~12 months
    # Emergency path: 250 → 1100; 6 of 18 months → ~533; at 1000 → ahead.
    assert emergency["standing"] == "ahead"
    total = m25["totals"][0]
    assert (str(total["current"]), str(total["amount"])) == ("4000.0000", "7100.0000")
    assert total["need"] == growth["need_flat"] + emergency["need_flat"]
    # The row's own chart leads to this milestone.
    chart = growth["trajectory"]
    assert chart["months"][0] == "2024-01" and chart["months"][-1] == "2025-07"
    assert chart["required"][chart["months"].index("2025-07")] == Decimal("6000.0000")
    assert str(growth["pace_6m"]) == "375.0000"  # (3000 - 750) / 6

    m26 = by_name["2026"]
    (g26,) = m26["rows"]
    assert g26["need_with_return"] < g26["need_flat"]  # 7% growth does part of the work
    # 750 → 20000 over 30 months at 7%: 6 months in the path is ~4400; at 3000 → behind.
    assert g26["standing"] == "behind"

    m27 = by_name["2027"]
    assert m27["rows"][0]["status"] == "achieved" and m27["totals"][0]["need"] is None

    # By bucket: Growth across Early, 2025, 2026; the needed path leads to the nearest open one.
    views = {v["bucket"]["name"]: v for v in data["buckets"]}
    gv = views["Growth"]
    assert [(mk["name"], mk["status"]) for mk in gv["marks"]] == [("Early", "achieved"), ("2025", "open"), ("2026", "open")]
    assert gv["next_row_id"] == growth["id"]
    assert gv["trajectory"]["months"][-1] == "2026-07"
    assert gv["trajectory"]["required"][gv["trajectory"]["months"].index("2025-07")] == Decimal("6000.0000")
    assert [mk["name"] for mk in views["Emergency fund"]["marks"]] == ["Early", "2025", "2027"]


def test_measure_from_in_the_future_is_not_started(api: Api):
    acc = api.account(name="Chase", currency="USD")
    api.balance(acc["id"], "100", "2024-01-31")
    api.split(acc["id"], {"Growth": 100})
    _milestone(api, "2030", "2030-12-31", {"Growth": "1000"}, start="2025-01-01")
    view = _metrics(api, date(2024, 6, 1))["milestones"][0]
    assert view["rows"][0]["standing"] is None and view["rows"][0]["status"] == "open"


def test_goal_maths():
    # 0% return: the level addition is just gap / months.
    assert metrics.need_with_return(Decimal(0), Decimal(1200), 12, 0.0) == Decimal("100.0000")
    i = metrics._rate(Decimal(12))
    # Enough already: growth alone gets there → nothing to add.
    assert metrics.need_with_return(Decimal(1000), Decimal(1100), 12, i) == Decimal("0.0000")
    # Compounding path ends exactly at the amount, starts at the base.
    assert metrics.path_value(Decimal(100), Decimal(1000), 24, 0, i) == Decimal("100.0000")
    assert metrics.path_value(Decimal(100), Decimal(1000), 24, 24, i) == Decimal("1000.0000")
    assert metrics.path_value(Decimal(0), Decimal(1000), 10, 5, None) == Decimal("500.0000")
    today = date(2024, 1, 1)
    assert metrics.projected_pace_date(Decimal(0), Decimal(100), Decimal(0), today) is None
    doubled = metrics.projected_return_date(Decimal(100), Decimal(200), metrics._rate(Decimal(100)), today)
    assert abs((doubled - date(2025, 1, 1)).days) <= 1  # 100%/yr doubles in a year (month = 365.25/12 days)


def test_pace_ignores_accounts_first_recorded_inside_the_window(api: Api):
    """Money that only *started being tracked* recently isn't growth; a newly opened account is."""
    today = date(2026, 11, 7)
    fresh = api.account(name="Fresh", currency="USD")  # opened long ago, first recorded this week
    api.balance(fresh["id"], "500000", "2026-11-06")
    api.split(fresh["id"], {"Growth": 100})
    _milestone(api, "2029", "2029-12-31", {"Growth": ("1000000", "8")}, start="2026-11-07")

    row = _metrics(api, today)["milestones"][0]["rows"][0]
    assert row["pace_3m"] is None and row["pace_6m"] is None and row["pace_12m"] is None
    assert row["projected_pace_date"] is None
    chart = row["trajectory"]
    assert all(v is None for v in chart["projection_pace"])
    # Growth-only projection ends at the first month it reaches the target instead of running flat.
    shown = [v for v in chart["projection_return"] if v is not None]
    assert shown and shown[-1] < Decimal("1000000")

    old = api.account(name="Old", currency="USD")
    api.balance(old["id"], "1000", "2026-01-31")
    api.balance(old["id"], "1600", "2026-11-01")
    api.split(old["id"], {"Growth": 100})
    new = api.account(name="New", account_type="savings", currency="USD")
    api.balance(new["id"], "0", "2026-01-01")  # a 0 entry marks when it started
    api.balance(new["id"], "300", "2026-10-01")
    api.split(new["id"], {"Growth": 100})
    row = _metrics(api, today)["milestones"][0]["rows"][0]
    # 6 months back (May 31): Old was 1000, New 0 → (1600 + 300 − 1000) / 6; Fresh is left out.
    assert str(row["pace_6m"]) == "150.0000"
