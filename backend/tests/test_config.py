"""The vault must feed Settings and win over local env vars for the keys it serves."""

import pytest
from cryptography.fernet import Fernet

import config
import nurav_creds

FERNET_KEY = Fernet.generate_key().decode()


def test_vault_values_override_env(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "from-env")
    monkeypatch.setattr(nurav_creds, "is_configured", lambda: True)
    monkeypatch.setattr(
        nurav_creds,
        "get_secrets",
        lambda force_refresh=False: {
            "DATABASE_URL": "postgresql://vault/db",
            "JWT_SECRET": "v" * 40,
            "ACCOUNT_NUMBER_KEY": FERNET_KEY,
        },
    )
    s = config.Settings()
    assert s.database_url == "postgresql://vault/db"
    assert s.jwt_secret == "v" * 40
    config._validate(s)  # complete vault map passes


def test_missing_vault_key_fails_fast(monkeypatch):
    monkeypatch.setattr(nurav_creds, "is_configured", lambda: True)
    monkeypatch.setattr(nurav_creds, "get_secrets", lambda force_refresh=False: {"JWT_SECRET": "v" * 40})
    with pytest.raises(config.ConfigError, match="DATABASE_URL"):
        config._validate(config.Settings())


def test_app_secrets_may_come_from_env(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "e" * 40)
    monkeypatch.setenv("ACCOUNT_NUMBER_KEY", FERNET_KEY)
    monkeypatch.setattr(nurav_creds, "is_configured", lambda: True)
    monkeypatch.setattr(nurav_creds, "get_secrets", lambda force_refresh=False: {"DATABASE_URL": "postgresql://vault/db"})
    s = config.Settings()
    assert s.jwt_secret == "e" * 40
    config._validate(s)


def test_missing_app_secret_fails_fast(monkeypatch):
    monkeypatch.setenv("ACCOUNT_NUMBER_KEY", "")
    monkeypatch.setattr(nurav_creds, "is_configured", lambda: True)
    monkeypatch.setattr(nurav_creds, "get_secrets", lambda force_refresh=False: {"DATABASE_URL": "x", "JWT_SECRET": "v" * 40})
    with pytest.raises(config.ConfigError, match="ACCOUNT_NUMBER_KEY"):
        config._validate(config.Settings(_env_file=None))


def test_invalid_fernet_key_fails_fast(monkeypatch):
    monkeypatch.setattr(nurav_creds, "is_configured", lambda: True)
    monkeypatch.setattr(
        nurav_creds,
        "get_secrets",
        lambda force_refresh=False: {"DATABASE_URL": "x", "JWT_SECRET": "v" * 40, "ACCOUNT_NUMBER_KEY": "not-a-key"},
    )
    with pytest.raises(config.ConfigError, match="Fernet"):
        config._validate(config.Settings())


def test_short_jwt_secret_fails_fast(monkeypatch):
    monkeypatch.setattr(nurav_creds, "is_configured", lambda: True)
    monkeypatch.setattr(
        nurav_creds,
        "get_secrets",
        lambda force_refresh=False: {
            "DATABASE_URL": "x",
            "JWT_SECRET": "short",
            "ACCOUNT_NUMBER_KEY": FERNET_KEY,
        },
    )
    with pytest.raises(config.ConfigError, match="JWT_SECRET"):
        config._validate(config.Settings())
