"""Import every model so Base.metadata is complete (Alembic, tests)."""

from models.account import Account, AccountLink, BalanceEntry
from models.bucket import AccountSplit, AccountSplitLine, Bucket, BucketTarget, Milestone
from models.estimator import WealthInquiry
from models.legacy_tags import AccountTag, PortfolioTag, Tag
from models.portfolio import Holding, Portfolio, Snapshot
from models.user import User
from models.workspace import Workspace

__all__ = [
    "Account",
    "AccountLink",
    "AccountSplit",
    "AccountSplitLine",
    "AccountTag",
    "BalanceEntry",
    "Bucket",
    "BucketTarget",
    "Milestone",
    "Holding",
    "Portfolio",
    "PortfolioTag",
    "Snapshot",
    "Tag",
    "WealthInquiry",
    "Workspace",
    "User",
]
