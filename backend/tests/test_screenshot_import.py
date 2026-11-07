"""Screenshot import: number parsing, image prep, the arithmetic checks, and the
whole chain through the API with a scripted OpenRouter (no network, no cost)."""

import asyncio
import base64
import io
import json
from decimal import Decimal

import httpx
import pytest
from PIL import Image

from main import app
from services.screenshot.images import ImageError, prepare
from services.screenshot.numbers import parse
from services.screenshot.openrouter import MAX_BUDGET, LLMError, OpenRouter, get_llm
from services.screenshot.verify import verify
from tests.conftest import Api

# ── numbers ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "text,value",
    [
        ("₹1,23,456.70", "123456.70"),
        ("$12,345.6", "12345.6"),
        ("Rs. 1,000", "1000"),
        ("1.2L", "120000"),
        ("3.45 Cr", "34500000"),
        ("12.5K", "12500"),
        ("(450.20)", "-450.20"),
        ("−12.5", "-12.5"),
        ("-₹1,200", "-1200"),
        ("+3.10", "3.10"),
        ("0.04250000", "0.0425"),
    ],
)
def test_parse_broker_numbers(text, value):
    assert parse(text).value == Decimal(value)


@pytest.mark.parametrize("text", [None, "", "12.5%", "N/A", "—", "Qty 10"])
def test_parse_rejects_non_amounts(text):
    assert parse(text) is None


def test_parse_knows_printed_precision():
    assert parse("16.50").half_unit == Decimal("0.005")
    assert parse("1.2L").half_unit == Decimal("5000")
    assert parse("1.2L").abbreviated


# ── images ───────────────────────────────────────────────────────────────────


def _png(w: int, h: int, exif: bool = False) -> bytes:
    img = Image.new("RGB", (w, h), "white")
    buf = io.BytesIO()
    if exif:
        e = Image.Exif()
        e[0x010F] = "SecretPhoneMaker"
        img.save(buf, format="JPEG", exif=e)
    else:
        img.save(buf, format="PNG")
    return buf.getvalue()


def test_prepare_refuses_non_images_and_tiny_ones():
    with pytest.raises(ImageError, match="isn't a readable"):
        prepare(b"not an image at all", "Screenshot 1")
    with pytest.raises(ImageError, match="too small"):
        prepare(_png(100, 100), "Screenshot 1")


def test_prepare_cuts_tall_phone_screenshots_into_overlapping_pieces():
    assert len(prepare(_png(1200, 800), "s")) == 1
    pieces = prepare(_png(1170, 6000), "s")
    assert 3 <= len(pieces) <= 6
    very_long = prepare(_png(1000, 40000), "s")
    assert len(very_long) == 6  # capped; pieces get taller instead of dropping rows


def test_prepare_strips_metadata():
    (url,) = prepare(_png(800, 600, exif=True), "s")
    raw = base64.b64decode(url.split(",", 1)[1])
    assert b"SecretPhoneMaker" not in raw
    assert not Image.open(io.BytesIO(raw)).getexif()


# ── verify ───────────────────────────────────────────────────────────────────


def _h(symbol, quantity=None, current_price=None, value=None, **kw):
    return {
        "id": f"h-{symbol}",
        "symbol": symbol,
        "symbol_basis": "shown",
        "asset_class": "stock",
        "quantity": quantity,
        "current_price": current_price,
        "value": value,
        **kw,
    }


def test_verify_accepts_numbers_that_add_up():
    v = verify([_h("INFY", "10", "₹1,610.10", "₹16,101.00"), _h("TCS", "2", "4,120.5", "8,241")], "₹24,342", None, "INR", "INR", {})
    assert not v.questions and not v.totals_question
    assert [i for r in v.rows for i in r.issues if i.level != "info"] == []
    assert v.checks[0].status == "ok"
    assert v.rows[0].current_price == Decimal("1610.10")


def test_verify_flags_a_misread_and_asks_to_reread_it():
    v = verify([_h("INFY", "16", "1,610.10", "16,101.00")], None, None, None, "INR", {})
    (row,) = v.rows
    assert any(i.level == "warn" and "16,101" in i.message for i in row.issues)
    assert {q["field"] for q in v.questions} == {"quantity", "current_price", "value"}


def test_verify_derives_prices_from_totals():
    v = verify([_h("HDFC", "12", None, "₹19,321.20", invested="18,000", buy_price=None)], None, None, None, "INR", {})
    (row,) = v.rows
    assert row.current_price == Decimal("1610.100000")
    assert row.buy_price == Decimal("1500.000000")
    assert set(row.derived) == {"current_price", "buy_price"}


def test_verify_total_mismatch_and_other_checks():
    prev = {"INFY": {"quantity": "1"}, "WIPRO": {"quantity": "5"}}
    v = verify(
        [_h("INFY", "10", "100", "1,000"), _h("INFY", "1", "5", "5"), _h("", "1", "1", "1")],
        "5,000",
        None,
        "USD",
        "INR",
        prev,
    )
    kinds = {c.kind: c for c in v.checks}
    assert kinds["total"].status == "warn" and v.totals_question
    assert kinds["currency"].status == "warn"
    assert "WIPRO" in kinds["missing"].message
    messages = [i.message for r in v.rows for i in r.issues]
    assert any("appears twice" in m for m in messages)
    assert any("Needs a symbol" in m for m in messages)
    assert any("was 1 in the last snapshot" in m for m in messages)


# ── the chain, through the API ───────────────────────────────────────────────


def _reply(name: str, args: dict, cost: float = 0.01) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "model": "test/model",
            "choices": [{"finish_reason": "stop", "message": {"role": "assistant", "content": json.dumps(args)}}],
            "usage": {"cost": cost},
        },
    )


def _step(body: dict) -> str:
    return body["response_format"]["json_schema"]["name"]


class Script:
    """Scripted OpenRouter: answers by the forced tool's name, and records each call."""

    def __init__(self, organiser_holdings: list[dict], recheck: dict | None = None, total: str | None = None):
        self.organiser_holdings = organiser_holdings
        self.recheck_args = recheck
        self.total = total
        self.calls: list[dict] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        name = _step(body)
        self.calls.append(body)
        if name == "record_screen":
            return _reply(
                "record_screen",
                {
                    "is_holdings_screen": True,
                    "currency_symbols": ["$"],
                    "column_headings": ["Symbol", "Qty", "Price", "Value"],
                    "rows": [{"label": "AAPL", "values": [{"label": "Qty", "text": "10"}], "partial": False}],
                    "totals": [],
                },
            )
        if name == "propose_holdings":
            return _reply(
                "propose_holdings",
                {"holdings": self.organiser_holdings, "portfolio_value": self.total, "currency": "USD", "as_of": "2024-06-28", "notes": []},
            )
        if name == "report_recheck":
            return _reply("report_recheck", self.recheck_args or {"answers": [], "missing_holdings": []})
        return httpx.Response(400, json={"error": {"message": "unexpected tool"}})


@pytest.fixture
def scripted():
    def install(script: Script):
        app.dependency_overrides[get_llm] = lambda: OpenRouter(transport=httpx.MockTransport(script), api_key="test")
        return script

    yield install
    app.dependency_overrides.pop(get_llm, None)


def _upload(api: Api, portfolio_id: str, count: int = 1, as_of: str = "2024-06-30", data: bytes | None = None):
    files = [("files", (f"shot{i}.png", data or _png(900, 1600), "image/png")) for i in range(count)]
    res = api.client.post(f"/api/portfolios/{portfolio_id}/snapshots/screenshot", files=files, data={"as_of": as_of}, headers=api.headers())
    return res, [json.loads(line) for line in res.text.splitlines() if line.strip()]


def test_chain_reads_checks_rechecks_and_returns_a_proposal(api: Api, scripted):
    port = api.portfolio(name="Fidelity", currency="USD")
    api.snapshot(port["id"], "2024-05-31", [("AAPL", 8, 190, "stock"), ("BND", 5, 70, "bond")])
    script = scripted(
        Script(
            organiser_holdings=[
                {
                    "symbol": "AAPL",
                    "symbol_basis": "previous",
                    "asset_class": "stock",
                    "quantity": "10",
                    "current_price": "$210.00",
                    "value": "$2,100.00",
                    "sources": ["s1r1"],
                },
                # Misread quantity (18 for 13): the recheck corrects it.
                {
                    "symbol": "vti",
                    "symbol_basis": "shown",
                    "asset_class": "etf",
                    "quantity": "18",
                    "current_price": "250",
                    "value": "3,250",
                    "sources": ["s2r1"],
                },
            ],
            recheck={"answers": [{"id": "h2", "field": "quantity", "text": "13", "found": True}], "missing_holdings": []},
            total="$5,350.00",
        )
    )
    res, events = _upload(api, port["id"], count=2)
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/x-ndjson")
    stages = [e["stage"] for e in events if e["type"] == "stage"]
    assert stages == ["reading", "read", "organising", "checking", "rechecking"]
    result = events[-1]["result"]
    assert [r["symbol"] for r in result["rows"]] == ["AAPL", "VTI"]
    vti = result["rows"][1]
    assert vti["quantity"] == "13" and vti["rechecked"] == ["quantity"]
    assert [c["status"] for c in result["checks"] if c["kind"] == "total"] == ["ok"]
    assert "BND" in next(c["message"] for c in result["checks"] if c["kind"] == "missing")
    assert result["as_of_seen"] == "2024-06-28"
    assert result["cost_usd"] == pytest.approx(0.04)  # 2 reads + organise + recheck
    assert "corrected" in result["recheck"]

    # Two screenshots were read in parallel; the organiser saw the previous holdings; images went to the readers.
    tools = [_step(c) for c in script.calls]
    assert tools.count("record_screen") == 2 and tools[2:] == ["propose_holdings", "report_recheck"]
    organiser_prompt = script.calls[2]["messages"][1]["content"]
    assert "BND" in organiser_prompt and "data:image" not in organiser_prompt
    reader_content = script.calls[0]["messages"][1]["content"]
    assert any(part.get("type") == "image_url" for part in reader_content)

    # Nothing was saved.
    assert len(api.get(f"/api/portfolios/{port['id']}/snapshots").json()) == 1


def test_chain_skips_recheck_when_everything_adds_up(api: Api, scripted):
    port = api.portfolio()
    script = scripted(
        Script(
            [
                {
                    "symbol": "AAPL",
                    "symbol_basis": "shown",
                    "asset_class": "stock",
                    "quantity": "10",
                    "current_price": "210",
                    "value": "2,100",
                    "sources": ["s1r1"],
                }
            ]
        )
    )
    _, events = _upload(api, port["id"])
    assert events[-1]["type"] == "result"
    assert "report_recheck" not in [_step(c) for c in script.calls]
    assert events[-1]["result"]["recheck"] is None


def test_upload_limits_and_errors(api: Api, other_api: Api, scripted):
    port = api.portfolio()
    scripted(Script([]))
    res, _ = _upload(api, port["id"], count=5)
    assert res.status_code == 422 and "At most 4" in res.json()["detail"]
    res, _ = _upload(api, port["id"], data=b"%PDF-1.4 not an image")
    assert res.status_code == 422 and "Screenshot 1" in res.json()["detail"]
    res, _ = _upload(other_api, port["id"])
    assert res.status_code == 404


def test_upload_without_a_key_says_what_is_missing(api: Api):
    port = api.portfolio()
    app.dependency_overrides[get_llm] = lambda: OpenRouter(api_key="")
    try:
        res, _ = _upload(api, port["id"])
    finally:
        app.dependency_overrides.pop(get_llm, None)
    assert res.status_code == 503 and "OPENROUTER_API_KEY" in res.json()["detail"]


def test_model_errors_come_back_as_an_error_event(api: Api):
    port = api.portfolio()
    app.dependency_overrides[get_llm] = lambda: OpenRouter(transport=httpx.MockTransport(lambda r: httpx.Response(402, json={})), api_key="k")
    try:
        res, events = _upload(api, port["id"])
    finally:
        app.dependency_overrides.pop(get_llm, None)
    assert res.status_code == 200
    assert events[-1] == {"type": "error", "message": "The OpenRouter account is out of credits."}


def test_steps_ask_for_strict_json():
    from services.screenshot.agents import ORGANISER_TOOL
    from services.screenshot.openrouter import strict_schema

    s = strict_schema(ORGANISER_TOOL["function"]["parameters"])
    holding = s["properties"]["holdings"]["items"]
    assert s["additionalProperties"] is False and set(s["required"]) == set(s["properties"])
    assert holding["additionalProperties"] is False and "buy_price" in holding["required"]
    assert "buy_price" not in ORGANISER_TOOL["function"]["parameters"]["properties"]["holdings"]["items"]["required"]  # original untouched


def test_verify_treats_printed_quantities_as_exact():
    # 12 × 418.30 = 5,019.60; a misprinted 5,109.60 must not hide behind "12 might be 11.5-12.5".
    v = verify([_h("MSFT", "12", "$418.30", "$5,109.60")], None, None, None, "USD", {})
    assert any(i.level == "warn" for i in v.rows[0].issues)


def test_messages_group_digits_like_the_app():
    from services.screenshot.verify import _fmt

    assert _fmt(Decimal("332564.24"), "INR") == "3,32,564.24"
    assert _fmt(Decimal("12345678"), "INR") == "1,23,45,678"
    assert _fmt(Decimal("201031.38"), "USD") == "201,031.38"
    assert _fmt(Decimal("-5019.60"), "USD") == "-5,019.6"
    v = verify([_h("INFY", "10", "1,610.10", "16,101")], "₹3,32,564.24", None, None, "INR", {})
    assert "3,32,564.24" in v.checks[0].message


# ── output budget ────────────────────────────────────────────────────────────

_TOOL = {"type": "function", "function": {"name": "t", "description": "d", "parameters": {"type": "object", "properties": {"a": {"type": "string"}}}}}


def _cut_off() -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"finish_reason": "length", "message": {"content": '{"a": "trunc'}}], "usage": {"cost": 0.02}})


def test_a_cut_off_reply_is_retried_with_the_full_budget():
    budgets = []

    def handler(request: httpx.Request) -> httpx.Response:
        budgets.append(json.loads(request.content)["max_tokens"])
        return _cut_off() if len(budgets) == 1 else _reply("t", {"a": "ok"}, cost=0.05)

    llm = OpenRouter(transport=httpx.MockTransport(handler), api_key="k", model="m")
    result = asyncio.run(llm.tool_call("sys", "hi", _TOOL))
    assert result.args == {"a": "ok"}
    assert budgets[1] == MAX_BUDGET and budgets[0] < MAX_BUDGET
    assert result.cost == pytest.approx(0.07)  # both attempts are billed


def test_a_reply_cut_off_at_the_full_budget_says_to_split():
    llm = OpenRouter(transport=httpx.MockTransport(lambda r: _cut_off()), api_key="k", model="m")
    with pytest.raises(LLMError, match="Split them"):
        asyncio.run(llm.tool_call("sys", "hi", _TOOL))
