"""Point-in-time maths over append-only, possibly backdated records.

Rule used everywhere: the value of an account on day D is the entry with the
latest `as_of` <= D; among entries sharing that `as_of`, the one recorded last
(`created_at`) wins. Month-end values apply the rule at the month's last day.
Nothing is precomputed, so a backdated entry reflows every later month the
next time anything is read.
"""

import calendar
from bisect import bisect_right
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Generic, TypeVar

T = TypeVar("T")


def month_start(d: date) -> date:
    return d.replace(day=1)


def month_end(d: date) -> date:
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


def add_months(d: date, n: int) -> date:
    idx = d.year * 12 + (d.month - 1) + n
    return date(idx // 12, idx % 12 + 1, 1)


def months_between(first: date, last: date) -> list[date]:
    """First-of-month dates from first's month to last's month inclusive."""
    out: list[date] = []
    cur, stop = month_start(first), month_start(last)
    while cur <= stop:
        out.append(cur)
        cur = add_months(cur, 1)
    return out


def month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


@dataclass(frozen=True)
class Point(Generic[T]):
    as_of: date
    recorded: datetime
    value: T
    ref: Any = field(default=None, compare=False)  # source row, for callers that need it


class Timeline(Generic[T]):
    """Sorted points for one account/portfolio with O(log n) as-of lookups."""

    def __init__(self, points: Iterable[Point[T]]):
        self.points: list[Point[T]] = sorted(points, key=lambda p: (p.as_of, p.recorded))
        self._keys = [p.as_of for p in self.points]

    def __bool__(self) -> bool:
        return bool(self.points)

    def at(self, day: date) -> Point[T] | None:
        """Effective point on `day` (latest as_of <= day, last recorded wins)."""
        i = bisect_right(self._keys, day)
        return self.points[i - 1] if i else None

    def latest(self) -> Point[T] | None:
        return self.points[-1] if self.points else None

    def before(self, point: Point[T]) -> Point[T] | None:
        """Effective point strictly before `point`'s as_of date."""
        i = bisect_right(self._keys, point.as_of)
        # Skip every point on the same date; the previous date's last one wins.
        j = i - 1
        while j >= 0 and self.points[j].as_of == point.as_of:
            j -= 1
        return self.points[j] if j >= 0 else None

    def first_day(self) -> date | None:
        return self.points[0].as_of if self.points else None


def effective_ids(points: Sequence[Point[T]], key) -> set:
    """Ids of points that are effective for their date (last recorded per as_of)."""
    winner: dict[date, Point[T]] = {}
    for p in points:
        cur = winner.get(p.as_of)
        if cur is None or p.recorded >= cur.recorded:
            winner[p.as_of] = p
    return {key(p) for p in winner.values()}


def value_on(timeline: Timeline[Decimal], day: date, closed_on: date | None) -> Decimal | None:
    """Carried-forward value on `day`; None before the first record.

    A closed account/portfolio contributes nothing after its closing date —
    its history up to then is kept.
    """
    if closed_on is not None and day > closed_on:
        return None
    point = timeline.at(day)
    return point.value if point else None
