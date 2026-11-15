"""Buckets (user-level), account splits and milestones with bucket targets (workspace-level)."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from schemas.common import CurrencyCode, ORMModel

# ── buckets ───────────────────────────────────────────────────────────────────


class BucketCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    description: str | None = Field(default=None, max_length=500)
    color: int | None = Field(default=None, ge=0, le=7)


class BucketUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    description: str | None = Field(default=None, max_length=500)
    color: int | None = Field(default=None, ge=0, le=7)


class BucketOrder(BaseModel):
    ids: list[uuid.UUID]


class BucketAccountRef(BaseModel):
    id: uuid.UUID
    name: str
    workspace_id: uuid.UUID
    workspace_name: str


class BucketOut(ORMModel):
    id: uuid.UUID
    name: str
    description: str | None
    color: int
    position: int
    archived: bool = False
    created_at: datetime
    # Accounts (in any workspace) whose split in force today uses this bucket.
    current_accounts: list[BucketAccountRef] = []
    # True once any split (past or present) or target has used it: it can then
    # only be archived, never deleted.
    used: bool = False
    milestone_count: int = 0  # live milestones with a target for it


# ── splits ────────────────────────────────────────────────────────────────────


class SplitLineIn(BaseModel):
    bucket_id: uuid.UUID
    percent: Decimal = Field(gt=0, le=100, max_digits=7, decimal_places=2)


class SplitCreate(BaseModel):
    """A new version of the account's split. Lines must add up to exactly 100.

    effective_from is ignored for an account's first split (it covers all
    history) and required for every later one. Saving a split on a date that
    already has one replaces it.
    """

    effective_from: date | None = None
    note: str | None = Field(default=None, max_length=500)
    lines: list[SplitLineIn] = Field(min_length=1)


class SplitLineOut(BaseModel):
    bucket_id: uuid.UUID
    name: str
    color: int
    archived: bool
    percent: Decimal
    value: Decimal | None = None  # today's money in this bucket (current split only)


class SplitOut(BaseModel):
    id: uuid.UUID
    effective_from: date | None  # None = first split, covers all earlier history
    covers_history: bool  # the earliest split: applies to every day before the next one
    until: date | None  # last day in force (None = in force now / still the latest)
    note: str | None
    recorded_at: datetime
    lines: list[SplitLineOut]


class AccountSplits(BaseModel):
    account_id: uuid.UUID
    currency: str
    # What the split shares out today: the account's balance, or its open
    # portfolios' holdings while it has any (see services/analytics.Item).
    value: Decimal | None
    current: SplitOut | None  # None = Unassigned
    history: list[SplitOut]  # newest first


class BucketShare(BaseModel):
    bucket_id: uuid.UUID
    name: str
    color: int
    percent: Decimal


# ── milestones ────────────────────────────────────────────────────────────────


class MilestoneLineIn(BaseModel):
    bucket_id: uuid.UUID
    currency: CurrencyCode
    amount: Decimal = Field(gt=0, max_digits=20, decimal_places=4)  # the balance to reach
    expected_return: Decimal | None = Field(default=None, ge=-50, le=100, max_digits=6, decimal_places=3)


class MilestoneIn(BaseModel):
    """The whole milestone, sent on create and on every save (lines are replaced)."""

    name: str = Field(min_length=1, max_length=80)
    target_date: date
    start_date: date | None = None  # default: today on create, unchanged on update
    note: str | None = Field(default=None, max_length=500)
    lines: list[MilestoneLineIn] = Field(min_length=1)


class MilestoneLineOut(BaseModel):
    id: uuid.UUID
    bucket_id: uuid.UUID
    bucket_name: str
    color: int
    archived: bool
    currency: str
    amount: Decimal
    expected_return: Decimal | None


class MilestoneOut(BaseModel):
    id: uuid.UUID
    name: str
    target_date: date
    start_date: date
    note: str | None
    created_at: datetime
    lines: list[MilestoneLineOut]


# ── metrics ───────────────────────────────────────────────────────────────────

Standing = Literal["ahead", "on_track", "behind"]
RowStatus = Literal["achieved", "missed", "open"]


class BucketRef(BaseModel):
    id: uuid.UUID
    name: str
    color: int


class Trajectory(BaseModel):
    months: list[str]  # YYYY-MM
    actual: list[Decimal | None]
    required: list[Decimal | None]  # needed path toward the goal the chart is about
    projection_pace: list[Decimal | None]
    projection_return: list[Decimal | None]


class TargetRow(BaseModel):
    """One bucket target of one milestone, measured."""

    id: uuid.UUID
    milestone_id: uuid.UUID
    milestone_name: str
    target_date: date
    start_date: date
    bucket: BucketRef
    currency: str
    amount: Decimal
    expected_return: Decimal | None
    status: RowStatus  # achieved: reached (or met on the date); missed: date passed short of it
    current: Decimal  # the bucket's value today
    progress_pct: Decimal  # current (or value on the date, once past) / amount
    gap: Decimal  # still to go today (0 once reached)
    months_left: Decimal | None  # None once the date has passed
    need_flat: Decimal | None  # gap / months left
    need_with_return: Decimal | None  # monthly addition needed if the bucket earns expected_return
    required_now: Decimal | None  # where the needed path says the bucket should be today
    standing: Standing | None  # open rows whose measure-from date has come
    projected_pace_date: date | None  # when the amount is reached at the 6-month pace
    projected_return_date: date | None  # …on growth alone at expected_return
    value_on_date: Decimal | None  # bucket value on the date, once it has passed
    pace_3m: Decimal | None
    pace_6m: Decimal | None
    pace_12m: Decimal | None
    trajectory: Trajectory


class CurrencyTotal(BaseModel):
    currency: str
    current: Decimal  # sum of the buckets' values (on the date, once past)
    amount: Decimal  # sum of the targets
    progress_pct: Decimal
    need: Decimal | None  # sum per month over open rows: with return where set, else flat
    need_flat: Decimal | None


class MilestoneView(BaseModel):
    id: uuid.UUID
    name: str
    target_date: date
    start_date: date
    note: str | None
    past: bool
    months_left: Decimal | None
    totals: list[CurrencyTotal]
    rows: list[TargetRow]


class BucketMark(BaseModel):
    row_id: uuid.UUID
    milestone_id: uuid.UUID
    name: str
    target_date: date
    amount: Decimal
    status: RowStatus


class BucketView(BaseModel):
    """One bucket + currency across every milestone it appears in."""

    bucket: BucketRef
    currency: str
    current: Decimal
    pace_3m: Decimal | None
    pace_6m: Decimal | None
    pace_12m: Decimal | None
    next_row_id: uuid.UUID | None  # the nearest open target
    marks: list[BucketMark]  # by date
    trajectory: Trajectory  # needed path toward the next open target; dots = marks


class Metrics(BaseModel):
    milestones: list[MilestoneView]  # upcoming by date, then past (latest first)
    buckets: list[BucketView]
