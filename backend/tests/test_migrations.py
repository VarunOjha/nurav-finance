"""Migrations keep data: 0002 (buckets) leaves tags alone; 0003 moves targets into milestones and back."""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from alembic import command
from alembic.config import Config
from database import engine
from tests.conftest import BACKEND


def _cfg() -> Config:
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    return cfg


def test_0002_keeps_tags_and_seeds_starter_buckets():
    cfg = _cfg()
    command.downgrade(cfg, "0001")
    try:
        uid, tid, gone = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO users (id, first_name, last_name, email, password_hash, created_at, updated_at, deleted_at) VALUES"
                    " (:u, 'A', 'B', 'a@x.com', 'h', now(), now(), NULL), (:g, 'C', 'D', 'c@x.com', 'h', now(), now(), now())"
                ),
                {"u": uid, "g": gone},
            )
            conn.execute(
                text("INSERT INTO tags (id, user_id, name, created_at, updated_at) VALUES (:t, :u, 'salary', now(), now())"), {"t": tid, "u": uid}
            )

        command.upgrade(cfg, "head")
        with engine.connect() as conn:
            names = conn.execute(text("SELECT name FROM buckets WHERE user_id = :u ORDER BY position"), {"u": uid}).scalars().all()
            assert names == ["Growth", "Emergency fund", "Extra cash"]
            assert conn.execute(text("SELECT count(*) FROM buckets WHERE user_id = :g"), {"g": gone}).scalar_one() == 0
            assert conn.execute(text("SELECT name FROM tags WHERE id = :t"), {"t": tid}).scalar_one() == "salary"

        command.downgrade(cfg, "0001")
        with engine.connect() as conn:
            assert conn.execute(text("SELECT to_regclass('buckets')")).scalar_one() is None
            assert conn.execute(text("SELECT name FROM tags WHERE id = :t"), {"t": tid}).scalar_one() == "salary"
    finally:
        command.upgrade(cfg, "head")


def test_0003_moves_targets_into_milestones_and_back():
    cfg = _cfg()
    command.downgrade(cfg, "0002")
    try:
        uid, wid, bid, other = uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        t1, t2, t3, gone = uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO users (id, first_name, last_name, email, password_hash, created_at, updated_at)"
                    " VALUES (:u, 'A', 'B', 'm@x.com', 'h', now(), now())"
                ),
                {"u": uid},
            )
            conn.execute(
                text("INSERT INTO workspaces (id, user_id, name, created_at, updated_at) VALUES (:w, :u, 'Personal', now(), now())"),
                {"w": wid, "u": uid},
            )
            for b, name, pos in ((bid, "Growth", 0), (other, "Rivian", 1)):
                conn.execute(
                    text("INSERT INTO buckets (id, user_id, name, color, position, created_at, updated_at) VALUES (:b, :u, :n, 0, :p, now(), now())"),
                    {"b": b, "u": uid, "n": name, "p": pos},
                )
            insert = text(
                "INSERT INTO bucket_targets (id, workspace_id, bucket_id, currency, amount, target_date, start_date, expected_return,"
                " created_at, updated_at, deleted_at)"
                " VALUES (:id, :w, :b, 'USD', :a, :d, '2026-11-07', :r, now(), now(), :del)"
            )
            conn.execute(insert, {"id": t1, "w": wid, "b": bid, "a": 1000000, "d": "2029-12-31", "r": 8, "del": None})
            conn.execute(insert, {"id": t2, "w": wid, "b": other, "a": 90000, "d": "2029-12-31", "r": None, "del": None})
            conn.execute(insert, {"id": t3, "w": wid, "b": bid, "a": 50, "d": "2029-06-30", "r": None, "del": None})  # same year, other date
            conn.execute(insert, {"id": gone, "w": wid, "b": bid, "a": 7, "d": "2028-01-01", "r": None, "del": "2026-01-01"})

        command.upgrade(cfg, "head")
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT t.id, m.name, m.target_date::text, m.start_date::text, t.amount, t.expected_return FROM bucket_targets t"
                    " LEFT JOIN milestones m ON m.id = t.milestone_id WHERE t.workspace_id = :w"
                ),
                {"w": wid},
            ).all()
            got = {r[0]: (r[1], r[2], r[3], float(r[4]), r[5] and float(r[5])) for r in rows}
            assert got[t3] == ("2029", "2029-06-30", "2026-11-07", 50.0, None)  # earlier date gets the plain year
            assert got[t1] == ("2029 (Dec 31)", "2029-12-31", "2026-11-07", 1000000.0, 8.0)
            assert got[t2][0] == "2029 (Dec 31)"  # same date → same milestone
            assert got[gone][0] is None  # deleted targets are left alone
            assert conn.execute(text("SELECT count(*) FROM milestones WHERE workspace_id = :w"), {"w": wid}).scalar_one() == 2

        command.downgrade(cfg, "0002")
        with engine.connect() as conn:
            assert conn.execute(text("SELECT to_regclass('milestones')")).scalar_one() is None
            back = conn.execute(
                text("SELECT id, target_date::text, amount FROM bucket_targets WHERE workspace_id = :w AND deleted_at IS NULL"), {"w": wid}
            ).all()
            assert sorted((r[1], float(r[2])) for r in back) == [("2029-06-30", 50.0), ("2029-12-31", 90000.0), ("2029-12-31", 1000000.0)]
    finally:
        command.upgrade(cfg, "head")


def test_0004_drops_empty_duplicate_portfolios_then_enforces_one_per_account():
    cfg = _cfg()
    command.downgrade(cfg, "0003")
    try:
        uid, wid, acc, lone = uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        empty, filled, solo = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO users (id, first_name, last_name, email, password_hash, created_at, updated_at)"
                    " VALUES (:u, 'A', 'B', 'p@x.com', 'h', now(), now())"
                ),
                {"u": uid},
            )
            conn.execute(
                text("INSERT INTO workspaces (id, user_id, name, created_at, updated_at) VALUES (:w, :u, 'P', now(), now())"), {"w": wid, "u": uid}
            )
            for a, name in ((acc, "Zerodha Brokerage"), (lone, "Groww")):
                conn.execute(
                    text(
                        "INSERT INTO accounts (id, workspace_id, name, account_type, currency, created_at, updated_at)"
                        " VALUES (:a, :w, :n, 'brokerage', 'INR', now(), now())"
                    ),
                    {"a": a, "w": wid, "n": name},
                )
            add = text(
                "INSERT INTO portfolios (id, workspace_id, name, currency, account_id, created_at, updated_at)"
                " VALUES (:id, :w, 'Zerodha', 'INR', :a, now() + make_interval(secs => :s), now())"
            )
            conn.execute(add, {"id": empty, "w": wid, "a": acc, "s": 0})  # first, never got holdings
            conn.execute(add, {"id": filled, "w": wid, "a": acc, "s": 1})
            conn.execute(add, {"id": solo, "w": wid, "a": lone, "s": 0})  # alone and empty: kept
            conn.execute(
                text("INSERT INTO snapshots (id, portfolio_id, as_of, created_at, updated_at) VALUES (:s, :p, '2026-11-07', now(), now())"),
                {"s": uuid.uuid4(), "p": filled},
            )

        command.upgrade(cfg, "head")
        with engine.connect() as conn:
            live = conn.execute(text("SELECT id FROM portfolios WHERE workspace_id = :w AND deleted_at IS NULL"), {"w": wid}).scalars().all()
            assert set(live) == {filled, solo}
            assert conn.execute(text("SELECT deleted_at IS NOT NULL FROM portfolios WHERE id = :p"), {"p": empty}).scalar_one()  # soft, row kept
        with engine.begin() as conn, pytest.raises(IntegrityError):
            conn.execute(
                text(
                    "INSERT INTO portfolios (id, workspace_id, name, currency, account_id, created_at, updated_at)"
                    " VALUES (:id, :w, 'Again', 'INR', :a, now(), now())"
                ),
                {"id": uuid.uuid4(), "w": wid, "a": acc},
            )
    finally:
        command.upgrade(cfg, "head")


def test_0007_adds_and_drops_only_the_inquiries_table():
    cfg = _cfg()
    command.downgrade(cfg, "0006")
    try:
        with engine.connect() as conn:
            assert conn.execute(text("SELECT to_regclass('wealth_inquiries')")).scalar_one() is None
        command.upgrade(cfg, "0007")
        with engine.connect() as conn:
            assert conn.execute(text("SELECT to_regclass('wealth_inquiries')")).scalar_one() == "wealth_inquiries"
    finally:
        command.upgrade(cfg, "head")
