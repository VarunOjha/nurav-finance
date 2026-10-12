"""The vault must feed Settings and win over local env vars for the keys it serves."""

import pytest

import config
import nurav_creds


def test_vault_values_override_env(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "from-env")
    monkeypatch.setattr(nurav_creds, "is_configured", lambda: True)
    monkeypatch.setattr(
        nurav_creds,
        "get_secrets",
        lambda force_refresh=False: {
            "DATABASE_URL": "postgresql://vault/db",
            "JWT_SECRET": "v" * 40,
            "ACCOUNT_NUMBER_KEY": "k",
        },
    )
    s = config.Settings()
    assert s.database_url == "postgresql://vault/db"
    assert s.jwt_secret == "v" * 40
    config._validate(s)  # complete vault map passes


def test_missing_vault_key_fails_fast(monkeypatch):
    monkeypatch.setattr(nurav_creds, "is_configured", lambda: True)
    monkeypatch.setattr(nurav_creds, "get_secrets", lambda force_refresh=False: {"DATABASE_URL": "x", "JWT_SECRET": "v" * 40})
    with pytest.raises(config.ConfigError, match="ACCOUNT_NUMBER_KEY"):
        config._validate(config.Settings())


def test_short_jwt_secret_fails_fast(monkeypatch):
    monkeypatch.setattr(nurav_creds, "is_configured", lambda: True)
    monkeypatch.setattr(
        nurav_creds,
        "get_secrets",
        lambda force_refresh=False: {
            "DATABASE_URL": "x",
            "JWT_SECRET": "short",
            "ACCOUNT_NUMBER_KEY": "k",
        },
    )
    with pytest.raises(config.ConfigError, match="JWT_SECRET"):
        config._validate(config.Settings())
