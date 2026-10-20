"""Wealth Agent: the parameters the agent drafts, and the API bodies.

`WealthParams` is the contract the model fills through the draft_parameters
tool (services/agent/prompt.py mirrors it as the tool's JSON schema). Pydantic
checks the shape; services/wealth/params.py checks it against the person's
real accounts.

A plan is one pot per currency (no conversion). A pot starts from what the
person holds in that currency today and has four numbers: target, time,
return and contribution. Exactly one is the unknown (`solve_for`). Segments
optionally split the starting money into parts with their own return and
their own final target (e.g. equities / savings / cash).
"""

import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from schemas.common import CurrencyCode

MAX_HORIZON = 60
MAX_POTS = 4
MAX_SEGMENTS = 6  # the chart palette has 8 slots
MAX_ONE_OFFS = 20

SolveFor = Literal["time", "amount", "rate", "contribution"]
Risk = Literal["cautious", "balanced", "growth"]
# Yearly return bands per risk appetite, in percent. Used only to warn about an
# assumption; never to choose a return for the person.
RISK_BANDS: dict[str, tuple[float, float]] = {"cautious": (3, 5), "balanced": (5, 7), "growth": (7, 9)}
DEFAULTABLE = Literal["inflation", "compounding", "rate_options", "target_basis", "risk_appetite"]

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)]
Alias = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
Rate = Annotated[float, Field(ge=-20, le=50)]


class _Strict(BaseModel):
    # A misspelt field is an error the model can fix, not a silent default.
    model_config = ConfigDict(extra="forbid")


class ContributionParams(_Strict):
    """Money added regularly. When solving for the contribution, `amount` is the unknown (0)."""

    amount: float = Field(default=0, ge=-1e12, le=1e12)
    per: Literal["month", "year"] = "month"
    years: int | None = Field(default=None, ge=1, le=MAX_HORIZON)  # None: the whole plan
    step_up: float = Field(default=0, ge=0, le=50)


class OneOffParams(_Strict):
    year: int = Field(ge=1, le=MAX_HORIZON)
    amount: float = Field(ge=-1e15, le=1e15)
    note: Note = ""


class SegmentParams(_Strict):
    name: Name
    share: float | None = Field(default=None, gt=0, le=100)  # percent of the pot's start
    amount: float | None = Field(default=None, ge=0, le=1e15)
    rate: Rate | None = None
    target: float | None = Field(default=None, gt=0, le=1e15)  # same basis as the pot's target
    contribution: ContributionParams | None = None


class PotParams(_Strict):
    currency: CurrencyCode
    solve_for: SolveFor
    start_override: float | None = Field(default=None, ge=0, le=1e15)
    exclude: list[Alias] = Field(default_factory=list, max_length=200)
    target: float | None = Field(default=None, gt=0, le=1e15)
    target_basis: Literal["today", "nominal"] = "today"
    horizon_years: int | None = Field(default=None, ge=1, le=MAX_HORIZON)
    horizon_age: int | None = Field(default=None, ge=1, le=120)
    rate: Rate | None = None
    rate_options: list[Rate] | None = Field(default=None, min_length=3, max_length=3)
    contribution: ContributionParams | None = None
    one_offs: list[OneOffParams] = Field(default_factory=list, max_length=MAX_ONE_OFFS)
    segments: list[SegmentParams] = Field(default_factory=list, max_length=MAX_SEGMENTS)
    monthly_spending: float | None = Field(default=None, gt=0, le=1e12)


class WealthParams(_Strict):
    title: Title
    pots: list[PotParams] = Field(min_length=1, max_length=MAX_POTS)
    inflation: float = Field(default=3, ge=0, le=25)
    compounding: Literal[12, 4, 1] = 12
    risk_appetite: Risk | None = None
    defaults: list[DEFAULTABLE] = Field(default_factory=list, max_length=5)


# ── API bodies ───────────────────────────────────────────────────────────────


class ToolCall(BaseModel):
    id: Annotated[str, StringConstraints(max_length=120)]
    type: Literal["function"] = "function"
    function: dict[str, Any]


class ChatMessage(BaseModel):
    """One message of the conversation the browser holds (OpenAI chat format, aliases only)."""

    model_config = ConfigDict(extra="ignore")
    role: Literal["user", "assistant", "tool"]
    content: Annotated[str, StringConstraints(max_length=60_000)] | None = None
    tool_calls: list[ToolCall] | None = Field(default=None, max_length=8)
    tool_call_id: Annotated[str, StringConstraints(max_length=120)] | None = None


class Prefs(BaseModel):
    """Start-screen choices. The person can change any of them in the chat."""

    solve_for: SolveFor | None = None
    horizon_years: int | None = Field(default=None, ge=1, le=MAX_HORIZON)
    horizon_age: int | None = Field(default=None, ge=1, le=120)
    risk_appetite: Risk | None = None


class TurnBody(BaseModel):
    messages: list[ChatMessage] = Field(default_factory=list, max_length=400)
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
    prefs: Prefs = Prefs()


class ApproveBody(BaseModel):
    messages: list[ChatMessage] = Field(default_factory=list, max_length=400)
    draft: dict[str, Any]
    prefs: Prefs = Prefs()


class TranscribeBody(BaseModel):
    # Base64 audio from the browser's MediaRecorder; ~2 minutes of opus is well under this.
    audio: Annotated[str, StringConstraints(min_length=16, max_length=8_000_000)]
    format: Literal["webm", "ogg", "mp4", "m4a", "wav", "mp3", "aac", "flac"] = "webm"


class Narrative(_Strict):
    """What write_report returns. Numbers appear only as figure tokens like {final_nominal}."""

    headline: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=400)]
    insights: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=400)]] = Field(min_length=1, max_length=5)
    watch_outs: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=400)]] = Field(
        default_factory=list, max_length=5
    )
    recommendations: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=400)]] = Field(min_length=1, max_length=5)
    glossary: list[dict[str, Annotated[str, StringConstraints(max_length=300)]]] = Field(default_factory=list, max_length=6)
    chat_summary: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=800)]
    follow_ups: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]] = Field(
        default_factory=list, max_length=3
    )


class PlanSave(BaseModel):
    name: Title
    draft: dict[str, Any]
    narrative: dict[str, Any] | None = None


class PlanRename(BaseModel):
    name: Title


class PotSummary(BaseModel):
    currency: str
    solve_for: SolveFor
    start: float
    answer: str


class PlanSummary(BaseModel):
    id: uuid.UUID
    name: str
    as_of: date
    created_at: datetime
    pots: list[PotSummary]


class Plan(BaseModel):
    id: uuid.UUID
    name: str
    as_of: date
    created_at: datetime
    model: str
    report: dict[str, Any]
