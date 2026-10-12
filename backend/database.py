"""Engine, session factory and the global soft-delete filter.

Soft deletes: every model that mixes in `SoftDeleteMixin` gets a `deleted_at`
column. The `do_orm_execute` hook below adds `deleted_at IS NULL` for every
such entity to every ORM SELECT — including relationship and column loads that
those queries trigger — so no endpoint has to remember to filter. Deleted rows
are invisible everywhere: lists, counts, sums, analytics, uniqueness checks.

The only way to see deleted rows is an explicit opt-out:
    db.execute(stmt.execution_options(include_deleted=True))
which nothing in the app does today.
"""

from datetime import UTC, datetime

from sqlalchemy import DateTime, create_engine, event
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    ORMExecuteState,
    Session,
    mapped_column,
    sessionmaker,
    with_loader_criteria,
)

from config import settings


def utcnow() -> datetime:
    return datetime.now(UTC)


engine = create_engine(settings.database_url, pool_pre_ping=True)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


class SoftDeleteMixin:
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None, index=True)

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None


@event.listens_for(Session, "do_orm_execute")
def _exclude_soft_deleted(state: ORMExecuteState) -> None:
    if not state.is_select or state.execution_options.get("include_deleted", False):
        return
    # Applied to relationship loads too (not only top-level queries): objects
    # created in this session never carried the option, so their lazy loads
    # must be filtered here as well.
    state.statement = state.statement.options(
        with_loader_criteria(
            SoftDeleteMixin,
            lambda cls: cls.deleted_at.is_(None),
            include_aliases=True,
        )
    )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
