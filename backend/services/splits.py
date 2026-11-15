"""Which bucket split applies to an account on a given day.

Rules (see models/bucket.py):
- the split in force on day D is the live one with the latest `effective_from` <= D;
- the first split (`effective_from` NULL) covers everything before the next one;
- with no NULL split, the earliest split still extends backwards, so an
  account that has ever been split is never "Unassigned" in its own history.
An account with no live split at all is Unassigned.
"""

import uuid
from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from models import AccountSplit, AccountSplitLine

HUNDRED = Decimal(100)


@dataclass(frozen=True)
class SplitVersion:
    effective_from: date | None
    recorded: datetime
    lines: tuple[tuple[uuid.UUID, Decimal], ...]  # (bucket_id, percent)
    ref: AccountSplit | None = None


class SplitTimeline:
    def __init__(self, versions: list[SplitVersion]):
        self.versions = sorted(versions, key=lambda v: (v.effective_from or date.min, v.recorded))
        self._keys = [v.effective_from or date.min for v in self.versions]

    def __bool__(self) -> bool:
        return bool(self.versions)

    def at(self, day: date) -> SplitVersion | None:
        if not self.versions:
            return None
        i = bisect_right(self._keys, day)
        return self.versions[i - 1] if i else self.versions[0]

    def until(self, version: SplitVersion) -> date | None:
        """The day before the next version starts (None = still in force)."""
        i = self.versions.index(version)
        if i + 1 < len(self.versions):
            nxt = self.versions[i + 1].effective_from
            return date.fromordinal(nxt.toordinal() - 1) if nxt else None
        return None


def _version(split: AccountSplit) -> SplitVersion:
    lines = tuple((line.bucket_id, line.percent) for line in sorted(split.lines, key=lambda x: x.position))
    return SplitVersion(split.effective_from, split.created_at, lines, split)


def load_splits(db: Session, account_ids: list[uuid.UUID]) -> dict[uuid.UUID, SplitTimeline]:
    """Split timelines for the given accounts (empty timeline = Unassigned)."""
    grouped: dict[uuid.UUID, list[SplitVersion]] = defaultdict(list)
    if account_ids:
        stmt = (
            select(AccountSplit)
            .where(AccountSplit.account_id.in_(account_ids))
            .options(selectinload(AccountSplit.lines).selectinload(AccountSplitLine.bucket))
        )
        for split in db.scalars(stmt):
            grouped[split.account_id].append(_version(split))
    return {aid: SplitTimeline(grouped.get(aid, [])) for aid in account_ids}
