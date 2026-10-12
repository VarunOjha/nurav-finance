"""Test harness: a real Postgres (docker-compose.test.yml), never the vault.

The schema is built by running the Alembic migrations, so the tests also
prove the migrations match the models. Every test starts from empty tables.
"""

import os

# Must be set before config.py is imported anywhere.
os.environ.pop("NURAV_CREDS_ENDPOINT", None)
os.environ.pop("NURAV_CREDS_TOKEN", None)
os.environ["ENV_FILE"] = os.devnull
os.environ.setdefault("DATABASE_URL", "postgresql://postgres:postgres@localhost:55439/nurav_finance_test")
os.environ["JWT_SECRET"] = "test-secret-" + "x" * 40
from cryptography.fernet import Fernet  # noqa: E402

os.environ["ACCOUNT_NUMBER_KEY"] = Fernet.generate_key().decode()

import pathlib  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from database import Base, engine  # noqa: E402
from main import app  # noqa: E402

BACKEND = pathlib.Path(__file__).resolve().parent.parent


@pytest.fixture(scope="session", autouse=True)
def _schema():
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
def _clean_tables():
    yield
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} CASCADE"))


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


_counter = {"n": 0}


def register(client: TestClient, **overrides) -> dict:
    _counter["n"] += 1
    body = {
        "first_name": "Test",
        "last_name": "User",
        "email": f"user{_counter['n']}@example.com",
        "password": "secret1",
        **overrides,
    }
    res = client.post("/api/auth/register", json=body)
    assert res.status_code == 201, res.text
    return res.json()


class Api:
    """Signed-in client bound to one tenant (DEFAULT_SELF unless switched)."""

    def __init__(self, client: TestClient, token: str):
        self.client = client
        self.token = token
        self.tenant_id = self.tenants()[0]["id"]

    def headers(self, tenant_id: str | None = None) -> dict:
        return {"Authorization": f"Bearer {self.token}", "X-Tenant-Id": tenant_id or self.tenant_id}

    def get(self, url, **kw):
        return self.client.get(url, headers=self.headers(kw.pop("tenant_id", None)), **kw)

    def post(self, url, json=None, **kw):
        return self.client.post(url, json=json, headers=self.headers(kw.pop("tenant_id", None)), **kw)

    def patch(self, url, json=None, **kw):
        return self.client.patch(url, json=json, headers=self.headers(kw.pop("tenant_id", None)), **kw)

    def delete(self, url, **kw):
        return self.client.delete(url, headers=self.headers(kw.pop("tenant_id", None)), **kw)

    def tenants(self) -> list[dict]:
        res = self.client.get("/api/tenants", headers={"Authorization": f"Bearer {self.token}"})
        assert res.status_code == 200, res.text
        return res.json()

    def tags(self) -> dict[str, str]:
        return {t["name"]: t["id"] for t in self.get("/api/tags").json()}

    def account(self, **overrides) -> dict:
        body = {"name": "Checking", "account_type": "checking", "currency": "USD", **overrides}
        res = self.post("/api/accounts", json=body)
        assert res.status_code == 201, res.text
        return res.json()

    def balance(self, account_id: str, amount: str, as_of: str) -> dict:
        res = self.post(f"/api/accounts/{account_id}/balances", json={"amount": amount, "as_of": as_of})
        assert res.status_code == 201, res.text
        return res.json()

    def portfolio(self, **overrides) -> dict:
        body = {"name": "Brokerage", "currency": "USD", **overrides}
        res = self.post("/api/portfolios", json=body)
        assert res.status_code == 201, res.text
        return res.json()

    def snapshot(self, portfolio_id: str, as_of: str, holdings: list[tuple]) -> dict:
        body = {
            "as_of": as_of,
            "holdings": [{"symbol": s, "quantity": str(qty), "price": str(price), "asset_class": cls} for s, qty, price, cls in holdings],
        }
        res = self.post(f"/api/portfolios/{portfolio_id}/snapshots", json=body)
        assert res.status_code == 201, res.text
        return res.json()


@pytest.fixture
def api(client) -> Api:
    return Api(client, register(client)["access_token"])


@pytest.fixture
def other_api(client) -> Api:
    return Api(client, register(client)["access_token"])
