"""Milestones: how far each bucket is from its target in each milestone, and what it takes.

A milestone ("2030") has one date and one measure-from date and holds bucket
targets (balances to reach, per bucket + currency). Every target is measured
on its own (a row); a milestone rolls its rows up (totals and monthly need per
currency), and the bucket view lines up one bucket's targets across milestones.

All maths is per workspace, per bucket, per currency (no FX). A bucket's value
on a day comes from services/analytics (account values shared out by the split
in force that day).

Definitions (shown in the UI next to each number):
- months left   = days to the target date / average month length
- need (flat)   = gap / months left
- need (return) = the monthly addition that, together with today's value
                  compounding at the expected annual return, reaches the
                  amount on the date (0 when growth alone gets there)
- needed path   = from the bucket's value on the measure-from date to the
                  amount on the milestone date: a straight line, or the compounding path
                  with a level monthly addition when a return is set
- standing      = today's value vs the required path, within 1% of the amount
- pace          = average change per month over the last 3/6/12 months
                  (market moves included); projections use the 6-month pace
                  (falling back to 3, then 12)
- return projection = today's value compounding at the expected return with
                  no new money
"""

import math
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Bucket, BucketTarget, Milestone, Workspace
from services.analytics import Item, _sum, load_items, pace
from services.holdings import ZERO, q
from services.ledger import add_months, month_end, month_key, months_between

MONTH_DAYS = 365.25 / 12
TOLERANCE = Decimal("0.01")
MAX_MONTHS = 1200  # projections further out than 100 years are "never"


def _months(a: date, b: date) -> float:
    return (b - a).days / MONTH_DAYS


def _dec(x: float) -> Decimal:
    return q(Decimal(str(round(x, 4))))


def _rate(expected_return: Decimal | None) -> float | None:
    """Monthly rate equivalent to an annual return in percent."""
    if expected_return is None:
        return None
    return (1 + float(expected_return) / 100) ** (1 / 12) - 1


def need_with_return(current: Decimal, amount: Decimal, months: float, i: float) -> Decimal:
    """Level monthly addition reaching `amount` in `months` with growth `i` per month."""
    grown = float(current) * (1 + i) ** months
    if abs(i) < 1e-12:
        pmt = (float(amount) - grown) / months
    else:
        pmt = (float(amount) - grown) * i / ((1 + i) ** months - 1)
    return _dec(max(pmt, 0.0))


def path_value(base: Decimal, amount: Decimal, total: float, t: float, i: float | None) -> Decimal:
    """Value on the required path `t` months after its start (`total` months long)."""
    t = min(max(t, 0.0), total)
    if total <= 0:
        return amount
    if i is None or abs(i) < 1e-12:
        return _dec(float(base) + (float(amount) - float(base)) * t / total)
    growth_total = (1 + i) ** total
    pmt = (float(amount) - float(base) * growth_total) * i / (growth_total - 1)
    growth_t = (1 + i) ** t
    return _dec(float(base) * growth_t + pmt * (growth_t - 1) / i)


def _add_months(day: date, months: float) -> date | None:
    if months > MAX_MONTHS:
        return None
    return day + timedelta(days=round(months * MONTH_DAYS))


def projected_pace_date(current: Decimal, amount: Decimal, monthly: Decimal | None, today: date) -> date | None:
    if current >= amount:
        return today
    if monthly is None or monthly <= 0:
        return None
    return _add_months(today, float((amount - current) / monthly))


def projected_return_date(current: Decimal, amount: Decimal, i: float | None, today: date) -> date | None:
    if current >= amount:
        return today
    if i is None or i <= 0 or current <= 0:
        return None
    return _add_months(today, math.log(float(amount) / float(current)) / math.log(1 + i))


@dataclass(frozen=True)
class Goal:
    """What the chart and the maths need from a target: amount, dates, return."""

    amount: Decimal
    target_date: date
    start_date: date
    expected_return: Decimal | None


class BucketSeries:
    """One bucket's money in one currency over time (computed once, shared by its rows)."""

    def __init__(self, items: list[Item], bucket_id: uuid.UUID, currency: str, today: date):
        self.bucket_id = bucket_id
        self.subset = [i for i in items if i.currency == currency]
        self.current = self.value(today)
        self.paces = {k: pace(self.subset, bucket_id, today, k) for k in (3, 6, 12)}
        # Projections use the 6-month pace, falling back to 3, then 12.
        self.monthly = next((self.paces[k] for k in (6, 3, 12) if self.paces[k] is not None), None)

    def value(self, day: date, present: bool = False) -> Decimal | None:
        """Bucket value on `day`; 0 when it holds nothing (None instead with `present`)."""
        total = _sum([i.bucket_value(self.bucket_id, day) for i in self.subset])
        return total if present or total is not None else ZERO


def _bucket_ref(bucket: Bucket) -> dict:
    return {"id": bucket.id, "name": bucket.name, "color": bucket.color}


def measure(series: BucketSeries, target: BucketTarget, milestone: Milestone, bucket: Bucket, today: date) -> dict:
    """One bucket target of one milestone: status, progress, needs, standing, chart."""
    goal = Goal(target.amount, milestone.target_date, milestone.start_date, target.expected_return)
    current = series.current
    i = _rate(goal.expected_return)
    passed = goal.target_date < today
    on_date = series.value(goal.target_date) if passed else None
    if passed:
        status = "achieved" if on_date >= goal.amount else "missed"
    else:
        status = "achieved" if current >= goal.amount else "open"
    months_left = None if passed else max(_months(today, goal.target_date), 0.0)
    reached = on_date if passed else current
    row = {
        "id": target.id,
        "milestone_id": milestone.id,
        "milestone_name": milestone.name,
        "target_date": goal.target_date,
        "start_date": goal.start_date,
        "bucket": _bucket_ref(bucket),
        "currency": target.currency,
        "amount": goal.amount,
        "expected_return": goal.expected_return,
        "status": status,
        "current": q(current),
        "progress_pct": q(reached / goal.amount * 100) if goal.amount else ZERO,
        "gap": q(max(goal.amount - current, ZERO)),
        "months_left": _dec(months_left) if months_left is not None else None,
        "need_flat": None,
        "need_with_return": None,
        "required_now": None,
        "standing": None,
        "projected_pace_date": None,
        "projected_return_date": None,
        "value_on_date": q(on_date) if on_date is not None else None,
        "pace_3m": series.paces[3],
        "pace_6m": series.paces[6],
        "pace_12m": series.paces[12],
    }
    if status == "open":
        span = max(months_left, 1.0)  # under a month left: the whole gap is due now
        row["need_flat"] = q(row["gap"] / Decimal(str(span)))
        if i is not None:
            row["need_with_return"] = need_with_return(current, goal.amount, span, i)
        row["projected_pace_date"] = projected_pace_date(current, goal.amount, series.monthly, today)
        row["projected_return_date"] = projected_return_date(current, goal.amount, i, today)
        if goal.start_date <= today:
            base = series.value(goal.start_date)
            required = path_value(base, goal.amount, _months(goal.start_date, goal.target_date), _months(goal.start_date, today), i)
            row["required_now"] = required
            diff = current - required
            row["standing"] = "on_track" if abs(diff) <= goal.amount * TOLERANCE else ("ahead" if diff > 0 else "behind")
    row["trajectory"] = trajectory(series.value, current, series.monthly, goal if status == "open" else None, [goal], today)
    return row


def _need(r: dict) -> Decimal:
    return r["need_with_return"] if r["need_with_return"] is not None else r["need_flat"]


def totals(past: bool, rows: list[dict]) -> list[dict]:
    """Per currency: sum of values vs sum of targets, and the monthly need over open rows."""
    by_currency: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_currency[r["currency"]].append(r)
    out = []
    for currency, group in sorted(by_currency.items()):
        current = sum(((r["value_on_date"] if past else r["current"]) or ZERO for r in group), ZERO)
        amount = sum((r["amount"] for r in group), ZERO)
        open_rows = [r for r in group if r["status"] == "open"]
        out.append(
            {
                "currency": currency,
                "current": q(current),
                "amount": q(amount),
                "progress_pct": q(current / amount * 100) if amount else ZERO,
                "need": q(sum((_need(r) for r in open_rows), ZERO)) if open_rows else None,
                "need_flat": q(sum((r["need_flat"] for r in open_rows), ZERO)) if open_rows else None,
            }
        )
    return out


def trajectory(value, current: Decimal, monthly: Decimal | None, active: Goal | None, targets: list[Goal], today: date) -> dict:
    """Month-by-month lines: last year of actuals through the last goal; the needed path leads to `active`."""
    first = min([add_months(today, -12), *(t.start_date for t in targets)])
    last = max([today, *(t.target_date for t in targets)])
    months = months_between(first, last)
    i = _rate(active.expected_return) if active else None
    ceiling = max((t.amount for t in targets), default=ZERO)
    base = value(active.start_date) if active else ZERO

    actual, required, by_pace, by_return = [], [], [], []
    for m in months:
        day = month_end(m)
        future = m > today.replace(day=1)
        seen = None if future else value(min(day, today), present=True)
        actual.append(q(seen) if seen is not None else None)
        if active and active.start_date <= day and m <= active.target_date.replace(day=1):
            span = _months(active.start_date, active.target_date)
            # The current month's point is today (as for actual), so both lines start together.
            point = max(active.start_date, min(day, today)) if not future else day
            elapsed = _months(active.start_date, min(point, active.target_date))
            required.append(path_value(base, active.amount, span, elapsed, i))
        else:
            required.append(None)
        t = _months(today, day) if future else 0.0
        if m < today.replace(day=1) or active is None:
            by_pace.append(None)
            by_return.append(None)
            continue
        # Each projection stops at the first month it reaches the last milestone.
        p = current + monthly * Decimal(str(t)) if monthly is not None else None
        by_pace.append(q(p) if p is not None and not (by_pace and by_pace[-1] is not None and by_pace[-1] >= ceiling) else None)
        g = _dec(float(current) * (1 + i) ** t) if i is not None else None
        by_return.append(g if g is not None and not (by_return and by_return[-1] is not None and by_return[-1] >= ceiling) else None)
    # Drop the leading months before the bucket had any money and before any path starts.
    lead = 0
    while lead < len(months) - 1 and actual[lead] is None and required[lead] is None:
        lead += 1
    months, actual, required, by_pace, by_return = (x[lead:] for x in (months, actual, required, by_pace, by_return))
    return {
        "months": [month_key(m) for m in months],
        "actual": actual,
        "required": required,
        "projection_pace": by_pace,
        "projection_return": by_return,
    }


def metrics(db: Session, workspace: Workspace, today: date | None = None) -> dict:
    today = today or date.today()
    milestones = list(db.scalars(select(Milestone).where(Milestone.workspace_id == workspace.id)))
    if not milestones:
        return {"milestones": [], "buckets": []}
    # Targets on archived buckets stay in the milestone (editor) but leave the numbers.
    targets = list(
        db.scalars(
            select(BucketTarget)
            .join(Bucket, Bucket.id == BucketTarget.bucket_id)
            .where(BucketTarget.milestone_id.in_([m.id for m in milestones]), Bucket.archived_at.is_(None))
        )
    )
    buckets = {b.id: b for b in db.scalars(select(Bucket).where(Bucket.id.in_({t.bucket_id for t in targets})))} if targets else {}
    items = load_items(db, workspace) if targets else []
    series: dict[tuple[uuid.UUID, str], BucketSeries] = {}
    by_milestone: dict[uuid.UUID, list[dict]] = defaultdict(list)
    by_bucket: dict[tuple[uuid.UUID, str], list[tuple[dict, Goal]]] = defaultdict(list)
    milestone_of = {m.id: m for m in milestones}

    def order(r: dict) -> tuple:
        b = buckets[r["bucket"]["id"]]
        return (b.position, b.name.lower(), r["currency"])

    for t in targets:
        key = (t.bucket_id, t.currency)
        if key not in series:
            series[key] = BucketSeries(items, t.bucket_id, t.currency, today)
        m = milestone_of[t.milestone_id]
        row = measure(series[key], t, m, buckets[t.bucket_id], today)
        by_milestone[m.id].append(row)
        by_bucket[key].append((row, Goal(t.amount, m.target_date, m.start_date, t.expected_return)))

    views = []
    for m in milestones:
        rows = sorted(by_milestone[m.id], key=order)
        past = m.target_date < today
        views.append(
            {
                "id": m.id,
                "name": m.name,
                "target_date": m.target_date,
                "start_date": m.start_date,
                "note": m.note,
                "past": past,
                "months_left": None if past else _dec(max(_months(today, m.target_date), 0.0)),
                "totals": totals(past, rows),
                "rows": rows,
            }
        )
    upcoming = sorted((v for v in views if not v["past"]), key=lambda v: (v["target_date"], v["name"].lower()))
    done = sorted((v for v in views if v["past"]), key=lambda v: (v["target_date"], v["name"].lower()), reverse=True)

    bucket_views = []
    for (bucket_id, currency), pairs in by_bucket.items():
        pairs.sort(key=lambda p: (p[1].target_date, p[1].amount))
        s = series[(bucket_id, currency)]
        nxt = next(((row, goal) for row, goal in pairs if row["status"] == "open"), None)
        bucket_views.append(
            {
                "bucket": _bucket_ref(buckets[bucket_id]),
                "currency": currency,
                "current": q(s.current),
                "pace_3m": s.paces[3],
                "pace_6m": s.paces[6],
                "pace_12m": s.paces[12],
                "next_row_id": nxt[0]["id"] if nxt else None,
                "marks": [
                    {
                        "row_id": row["id"],
                        "milestone_id": row["milestone_id"],
                        "name": row["milestone_name"],
                        "target_date": goal.target_date,
                        "amount": goal.amount,
                        "status": row["status"],
                    }
                    for row, goal in pairs
                ],
                "trajectory": trajectory(s.value, s.current, s.monthly, nxt[1] if nxt else None, [g for _, g in pairs], today),
            }
        )
    bucket_views.sort(key=lambda v: (buckets[v["bucket"]["id"]].position, v["bucket"]["name"].lower(), v["currency"]))
    return {"milestones": upcoming + done, "buckets": bucket_views}
