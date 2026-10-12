"""Application configuration: nurav-creds vault first, environment second.

Credentials live in the nurav-creds vault and are fetched once at boot by
`NuravCredsSettingsSource` (see backend/nurav_creds.py). The local environment
carries only the two bootstrap variables (NURAV_CREDS_ENDPOINT/_TOKEN) plus
non-secret knobs. For keys the vault serves, its values take precedence over
env vars and the env file. When the bootstrap variables are absent (unit tests,
bare local tooling), the vault source is dormant and plain env vars are used.

In the container the bootstrap vars arrive via `env_file: .env` in
docker-compose.yml. ENV_FILE only matters for bare local runs.
"""

import logging
import os

from pydantic import Field
from pydantic_settings import (
    BaseSettings,
    EnvSettingsSource,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
)

import nurav_creds

_logger = logging.getLogger("config")

# Vault keys the app cannot run without. Checked against the vault MAP (not the
# populated field) so an absent key is caught instead of masked by a default.
REQUIRED_VAULT_KEYS = ("DATABASE_URL", "JWT_SECRET", "ACCOUNT_NUMBER_KEY")
MIN_JWT_SECRET_LENGTH = 32


class NuravCredsSettingsSource(EnvSettingsSource):
    """Feeds Settings from the nurav-creds vault map.

    Subclassing EnvSettingsSource reuses its alias/case-insensitivity handling —
    the vault map is treated as an alternate environment. Dormant (empty map)
    when NURAV_CREDS_ENDPOINT is not set; otherwise a vault failure raises
    CredsError and aborts startup (fail fast, no silent local fallback).
    """

    def _load_env_vars(self) -> dict[str, str]:
        if not nurav_creds.is_configured():
            return {}
        return {key.lower(): value for key, value in nurav_creds.get_secrets().items()}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=os.environ.get("ENV_FILE", "../.env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    database_url: str = Field(
        default="postgresql://postgres:postgres@localhost:5432/nurav_finance",
        description="Full Postgres connection string (Neon in normal use).",
    )
    jwt_secret: str = Field(default="")
    jwt_expire_minutes: int = Field(default=720)
    account_number_key: str = Field(default="")

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        # Vault sits directly below explicit constructor kwargs: for the keys it
        # serves, it beats env vars and .env — no local override of a secret.
        return (
            init_settings,
            NuravCredsSettingsSource(settings_cls),
            env_settings,
            dotenv_settings,
            file_secret_settings,
        )


class ConfigError(RuntimeError):
    """Raised at startup when config is incomplete or unsafe.

    Messages never contain secret values — safe to log, like CredsError.
    """


def _validate(s: Settings) -> None:
    """Fail-fast checks, run once right after Settings() is built.

    Raised from a plain function rather than a pydantic validator on purpose:
    a ValidationError's repr would dump the settings dict, secrets included.
    Only enforced when the vault is active, so tests and tooling stay usable.
    """
    if not nurav_creds.is_configured():
        return
    vault = nurav_creds.get_secrets()
    missing = [k for k in REQUIRED_VAULT_KEYS if not vault.get(k, "").strip()]
    if missing:
        raise ConfigError(
            f"nurav-creds is missing required keys: {', '.join(missing)}. "
            "Add them to the 'nurav-finance' vault app (see .env.reference) and restart."
        )
    if len(s.jwt_secret) < MIN_JWT_SECRET_LENGTH:
        raise ConfigError(f"JWT_SECRET must be a random value of at least {MIN_JWT_SECRET_LENGTH} characters.")


# Singleton
settings = Settings()
_validate(settings)
