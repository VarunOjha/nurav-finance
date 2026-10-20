"""Wealth Agent harness, end to end against the scripted model (services/agent/fake.py)."""

import json
from decimal import Decimal

import pytest

from config import settings
from database import SessionLocal
from models import AgentUsage
from services.agent import fake


@pytest.fixture(autouse=True)
def _fake_model(monkeypatch):
    monkeypatch.setattr(settings, "agent_fake", True)
    monkeypatch.setattr(fake, "RECORD", [])
    yield


def events(res) -> list[dict]:
    assert res.status_code == 200, res.text
    return [json.loads(line[6:]) for line in res.text.splitlines() if line.startswith("data: ")]


def of(evs, kind):
    return [e for e in evs if e["type"] == kind]


@pytest.fixture
def money(api):
    """Two USD items with tags, a linked brokerage cash account, an INR account."""
    tags = api.tags()
    em = api.account(name="Chase Savings", account_type="savings", institution="Chase", account_number="123456789", tag_ids=[tags["savings"]])
    api.balance(em["id"], "30000", "2026-01-01")
    cash = api.account(name="Schwab Cash", account_type="brokerage")
    api.balance(cash["id"], "500", "2026-01-01")
    port = api.portfolio(name="Schwab Brokerage", tag_ids=[tags["trading"]], account_id=cash["id"])
    api.snapshot(port["id"], "2026-01-01", [("VTI", 100, 250, "etf"), ("BND", 100, 70, "bond")])
    inr = api.account(name="SBI", currency="INR")
    api.balance(inr["id"], "100000", "2026-01-01")
    return {"em": em, "cash": cash, "port": port, "inr": inr}


def chat(api, messages, text, **prefs):
    return events(api.post("/api/agent/turn", json={"messages": messages, "text": text, "prefs": prefs}))


def draft_in_two_turns(api):
    first = chat(api, [], "I want a million in twenty years")
    msgs = of(first, "done")[0]["messages"]
    second = chat(api, msgs, "The time is flexible")
    return msgs + of(second, "done")[0]["messages"], of(second, "draft")[0]["draft"], second


def test_status_reports_model_and_cap(api):
    s = api.get("/api/agent/status").json()
    assert s["enabled"] is True and s["model"] == "anthropic/claude-sonnet-4.6"
    assert s["cap_usd"] == settings.agent_daily_cap_usd and s["spent_today_usd"] == 0


def test_the_model_sees_aliases_never_names_numbers_or_symbols(api, money):
    msgs, _, _ = draft_in_two_turns(api)
    sent = json.dumps(fake.RECORD)
    for secret in ("Chase Savings", "Schwab", "Chase", "123456789", "6789", "SBI", "VTI", "BND", "@example.com"):
        assert secret not in sent, secret
    snap = api.get("/api/agent/snapshot").json()
    aliases = {i["alias"]: i for i in snap["items"]}
    assert "tags" not in aliases["Account A"] and aliases["Account A"]["value"] == 30000
    # The linked cash account is counted inside the portfolio, not twice.
    assert aliases["Account B"]["counted_in"] == "Portfolio A" and aliases["Account B"]["value"] is None
    assert aliases["Portfolio A"]["asset_mix"] == {"etf": pytest.approx(0.781, abs=1e-3), "bond": pytest.approx(0.219, abs=1e-3)}
    assert {c["currency"]: c["total"] for c in snap["currencies"]} == {"USD": 62000, "INR": 100000}


def test_a_turn_streams_text_aliases_usage_and_the_messages_to_keep(api, money):
    evs = chat(api, [], "Hello")
    assert of(evs, "aliases")[0]["map"]["Account A"] == "Chase Savings"
    assert "".join(e["delta"] for e in of(evs, "text")).startswith("Happy to help")
    assert of(evs, "usage")[0]["cap"] == settings.agent_daily_cap_usd
    done = of(evs, "done")[0]["messages"]
    assert [m["role"] for m in done] == ["user", "assistant"]


def test_a_draft_is_validated_signed_and_reported_back_to_the_model(api, money):
    msgs, draft, second = draft_in_two_turns(api)
    assert draft["id"] == "d1" and len(draft["sig"]) == 64
    usd, inr = draft["pots"]
    # Every currency held gets a pot: the INR account isn't silently dropped.
    assert usd["currency"] == "USD" and inr["currency"] == "INR" and inr["start"] == 100000
    assert usd["start"] == 62000  # 30000 + 100 x 250 + 100 x 70; the linked cash account is inside the portfolio
    assert {x["name"] for x in usd["items"]} == {"Chase Savings", "Schwab Brokerage"}
    assert not any("Not in this plan" in w for w in draft["warnings"])
    tool = next(m for m in msgs if m["role"] == "tool")
    assert json.loads(tool["content"])["ok"] is True
    assert "Chase" not in tool["content"]  # the model's copy is aliases only
    assert msgs[-1]["role"] == "assistant" and "Approve" in msgs[-1]["content"]


def test_errors_go_back_to_the_model_which_can_fix_them(api, money, monkeypatch):
    calls = {"n": 0}
    good = fake.handle

    def script(request):
        body = json.loads(request.content)
        if body["messages"][-1]["role"] == "user":
            calls["n"] += 1
            args = fake._draft_args(body["messages"][0]["content"][0]["text"])
            bad = {**args, "pots": [{**args["pots"][1], "exclude": ["Account A"]}]}
            return fake.httpx.Response(200, content=fake._tool("draft_parameters", bad), headers={"content-type": "text/event-stream"})
        return good(request)

    monkeypatch.setattr(fake, "handle", script)
    evs = chat(api, [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}], "Plan it")
    assert not of(evs, "draft")
    tool = next(m for m in of(evs, "done")[0]["messages"] if m["role"] == "tool")
    errors = json.loads(tool["content"])["errors"]
    assert any("Account A is in USD, not INR" in e for e in errors)


def test_approve_runs_the_engine_then_the_report_uses_only_figures(api, money):
    msgs, draft, _ = draft_in_two_turns(api)
    evs = events(api.post("/api/agent/approve", json={"messages": msgs, "draft": draft}))
    v = of(evs, "version")[0]["version"]
    assert v["n"] == 1 and [p["currency"] for p in v["pots"]] == ["USD", "INR"]
    assert v["draft"]["sig"] == draft["sig"]  # still signed: the version can be saved as it is
    usd = v["pots"][0]
    assert usd["solve_for"] == "time" and usd["main"]["total"][0] == 62000 and usd["answer"]["status"] == "ok"
    assert [line["label"] for line in usd["lines"]] == ["5%", "7%", "9%"]
    # Without the 500 a month it never gets there: 62K at 7% against a target growing 3% a year.
    assert usd["contribution_effect"]["without"] is None and v["figures"]["without_contribution:USD"] == "not within 60 years"
    assert v["risk"]["USD"]["holdings"]["top"]["symbol"] == "VTI"
    report = of(evs, "report")[0]
    assert report["n"] == 1 and "{fi_date:USD}" in report["narrative"]["headline"]
    # The model was told the figures but not the holding symbol.
    told = fake.RECORD[-1]["messages"][-1]["content"]
    assert v["figures"]["fi_date:USD"] in told and "VTI" not in told
    done = of(evs, "done")[0]["messages"]
    assert done[0]["content"].startswith("[approve d1 v1]") and done[1]["role"] == "assistant"
    # A second approval in the same chat is v2.
    evs2 = events(api.post("/api/agent/approve", json={"messages": msgs + done, "draft": draft}))
    assert of(evs2, "version")[0]["version"]["n"] == 2


def test_a_draft_survives_the_browser_round_trip(api, money):
    """JavaScript sends 30000.0 back as 30000; the signature must still match."""
    msgs, draft, _ = draft_in_two_turns(api)

    def as_js(x):
        if isinstance(x, float) and x.is_integer():
            return int(x)
        if isinstance(x, dict):
            return {k: as_js(v) for k, v in x.items()}
        if isinstance(x, list):
            return [as_js(v) for v in x]
        return x

    js = as_js(draft)
    assert json.dumps(js) != json.dumps(draft)  # the round trip really changed the text
    assert of(events(api.post("/api/agent/approve", json={"messages": msgs, "draft": js})), "version")
    assert api.post("/api/wealth/plans", json={"name": "Round trip", "draft": js}).status_code == 201


def test_a_changed_or_foreign_draft_is_refused(api, other_api, money):
    msgs, draft, _ = draft_in_two_turns(api)
    tampered = {**draft, "pots": [{**draft["pots"][0], "start": 9e9}, *draft["pots"][1:]]}
    assert api.post("/api/agent/approve", json={"messages": msgs, "draft": tampered}).status_code == 422
    assert other_api.post("/api/agent/approve", json={"messages": [], "draft": draft}).status_code == 422
    assert api.post("/api/wealth/plans", json={"name": "x", "draft": tampered}).status_code == 422


def test_the_daily_cap_stops_calls(api, money, monkeypatch):
    monkeypatch.setattr(settings, "agent_daily_cap_usd", 0.5)
    with SessionLocal() as db:
        db.add(
            AgentUsage(
                tenant_id=api.tenant_id,
                user_id=api.client.get("/api/auth/me", headers=api.headers()).json()["id"],
                kind="chat",
                model="m",
                cost_usd=Decimal("0.6"),
            )
        )
        db.commit()
    fake.RECORD.clear()
    evs = chat(api, [], "Hello")
    assert "limit" in of(evs, "error")[0]["message"] and not fake.RECORD
    assert api.post("/api/agent/transcribe", json={"audio": "A" * 64}).status_code == 429


def test_usage_is_recorded_per_call(api, money):
    chat(api, [], "Hello")
    with SessionLocal() as db:
        rows = db.query(AgentUsage).all()
    assert len(rows) == 1 and rows[0].kind == "chat" and rows[0].prompt_tokens == 1200


def test_transcription_goes_through_openrouter(api):
    res = api.post("/api/agent/transcribe", json={"audio": "UklGRiQAAABXQVZF" * 4, "format": "wav"})
    assert res.status_code == 200 and res.json()["text"].startswith("I want")


def test_long_chats_are_stopped(api):
    many = [m for _ in range(40) for m in ({"role": "user", "content": "x"}, {"role": "assistant", "content": "y"})]
    evs = chat(api, many, "one more")
    assert "long" in of(evs, "error")[0]["message"]


def test_saving_freezes_the_version_with_real_names(api, money):
    msgs, draft, _ = draft_in_two_turns(api)
    evs = events(api.post("/api/agent/approve", json={"messages": msgs, "draft": draft}))
    narrative = of(evs, "report")[0]["narrative"]
    narrative["insights"].append("Account A carries the emergency money.")
    version_draft = of(evs, "version")[0]["version"]["draft"]
    res = api.post("/api/wealth/plans", json={"name": "Million plan", "draft": version_draft, "narrative": narrative})
    assert res.status_code == 201, res.text
    plan = res.json()
    report = plan["report"]
    assert report["narrative"]["headline"].startswith("On these assumptions you reach $1M by ")
    assert "Chase Savings carries the emergency money." in report["narrative"]["insights"]
    assert report["pots"][0]["start"] == 62000
    assert api.post("/api/wealth/plans", json={"name": "million PLAN", "draft": draft}).status_code == 409
    listed = api.get("/api/wealth/plans").json()
    assert listed[0]["name"] == "Million plan" and [p["currency"] for p in listed[0]["pots"]] == ["USD", "INR"]
    assert listed[0]["pots"][0]["start"] == 62000 and listed[0]["pots"][0]["answer"] == report["figures"]["fi_date:USD"]
    assert api.patch(f"/api/wealth/plans/{plan['id']}", json={"name": "Renamed"}).json()["name"] == "Renamed"
    assert api.delete(f"/api/wealth/plans/{plan['id']}").status_code == 204
    assert api.get(f"/api/wealth/plans/{plan['id']}").status_code == 404


def test_a_typed_number_in_a_saved_narrative_is_dropped(api, money):
    msgs, draft, _ = draft_in_two_turns(api)
    narrative = {
        "headline": "You will have $9M.",
        "insights": ["Saving matters: {added:USD} goes in.", "Expect 7% a year."],
        "watch_outs": [],
        "recommendations": ["Add more."],
        "glossary": [],
        "chat_summary": "Done.",
        "follow_ups": [],
    }
    report = api.post("/api/wealth/plans", json={"name": "Typed", "draft": draft, "narrative": narrative}).json()["report"]["narrative"]
    assert "$9M" not in report["headline"] and report["headline"].startswith("On these assumptions")
    assert report["insights"] == [f"Saving matters: {report['insights'][0].split(': ')[1]}"] and "$" in report["insights"][0]


def test_plans_are_tenant_scoped(api, other_api, money):
    msgs, draft, _ = draft_in_two_turns(api)
    plan = api.post("/api/wealth/plans", json={"name": "Mine", "draft": draft}).json()
    assert other_api.get(f"/api/wealth/plans/{plan['id']}").status_code == 404
    assert other_api.get("/api/wealth/plans").json() == []
