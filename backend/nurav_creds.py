"""Runtime credentials from nurav-creds, the self-hosted secrets vault.

The app keeps exactly two local environment variables:

    NURAV_CREDS_ENDPOINT  URL of the vault's secrets endpoint
    NURAV_CREDS_TOKEN     bearer token for this app+environment (rotate in the
                          portal's TOKENS tab; tokens are displayed exactly once)

Every other credential is fetched at runtime as a flat JSON map and cached
in-process for ~60 seconds. Config consumption happens through
``backend/config.py`` (a pydantic-settings source built on `get_secrets`);
call sites keep reading the ``settings`` singleton and never touch this
module directly.

Hard rules (see .env.reference for the full protocol):
- NEVER log, print, or persist fetched values. Log lines and error paths in
  this module only ever reference key counts, durations, and HTTP status
  codes — never values, never the token.
- Stdlib only — this module must be importable before any dependency wiring.

Observability: fetch outcomes are logged via the stdlib logger — key counts,
durations and HTTP status codes only.
"""
import json
import logging
import os
import threading
import time
import urllib.error
import urllib.request

logger = logging.getLogger("nurav_creds")

_CACHE_TTL_SECONDS = 60.0
# >=10s required: the first hit after idle may cold-start the backing store.
_REQUEST_TIMEOUT_SECONDS = 15.0
# The vault sits behind Cloudflare, whose WAF rejects the default
# "Python-urllib/x.y" User-Agent with 403 — identify ourselves explicitly.
_USER_AGENT = "nurav-finance-creds-client/1.0"

_lock = threading.Lock()
_cache: dict[str, str] | None = None
_fetched_at = 0.0


class CredsError(RuntimeError):
    """Raised when the vault is unreachable, rejects the token, or misbehaves.

    Messages are safe to log: they never contain secret values or the token.
    """


def _config() -> tuple[str, str]:
    """Read the two bootstrap variables, failing with actionable messages."""
    endpoint = os.environ.get("NURAV_CREDS_ENDPOINT", "").strip()
    token = os.environ.get("NURAV_CREDS_TOKEN", "").strip()
    if not endpoint:
        raise CredsError(
            "NURAV_CREDS_ENDPOINT is not set — add it to .env (see .env.reference)."
        )
    if not token:
        raise CredsError(
            "NURAV_CREDS_TOKEN is not set — rotate a token in the nurav-creds "
            "portal (TOKENS tab) and add it to .env."
        )
    return endpoint, token


def get_secrets(force_refresh: bool = False) -> dict[str, str]:
    """Fetch the decrypted credential map, cached in-process for 60s.

    Serves the previous (stale) map on transient network failure so a brief
    vault blip cannot take down a running app; a cold start with no cache
    fails fast with `CredsError` instead.
    """
    global _cache, _fetched_at
    with _lock:
        if (
            not force_refresh
            and _cache is not None
            and time.monotonic() - _fetched_at < _CACHE_TTL_SECONDS
        ):
            return _cache

        endpoint, token = _config()
        request = urllib.request.Request(
            endpoint,
            headers={"Authorization": f"Bearer {token}", "User-Agent": _USER_AGENT},
        )
        started = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=_REQUEST_TIMEOUT_SECONDS) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as exc:
            logger.error("nurav-creds fetch failed: HTTP %d", exc.code)
            if exc.code == 401:
                raise CredsError(
                    "nurav-creds token invalid or revoked — rotate it in the "
                    "portal (TOKENS tab) and update NURAV_CREDS_TOKEN in .env."
                ) from exc
            if exc.code == 403:
                raise CredsError(
                    "nurav-creds request forbidden (HTTP 403) — usually the "
                    "Cloudflare WAF blocking this client's User-Agent or IP; "
                    "check the edge rules for the vault hostname."
                ) from exc
            if exc.code == 429:
                retry_after = exc.headers.get("Retry-After", "60")
                raise CredsError(
                    f"nurav-creds rate limited, retry in {retry_after}s"
                ) from exc
            raise CredsError(f"nurav-creds fetch failed: HTTP {exc.code}") from exc
        except (OSError, json.JSONDecodeError) as exc:
            # exc carries no secret material here: the request/URL hold only
            # the endpoint, and no response body made it into the exception.
            if _cache is not None:
                logger.warning(
                    "nurav-creds fetch failed (%s: %s); serving stale map "
                    "(%d keys, age %.0fs)",
                    type(exc).__name__, exc, len(_cache),
                    time.monotonic() - _fetched_at,
                )
                return _cache  # serve stale on transient failure
            logger.error("nurav-creds unreachable with no cached map (%s)", exc)
            raise CredsError(f"nurav-creds unreachable: {exc}") from exc

        if not isinstance(payload, dict) or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in payload.items()
        ):
            logger.error("nurav-creds returned an unexpected payload shape")
            raise CredsError(
                "nurav-creds returned an unexpected payload shape "
                "(expected a flat JSON object of string values)."
            )

        _cache = payload
        _fetched_at = time.monotonic()
        logger.info(
            "nurav-creds: fetched %d keys in %.0fms",
            len(payload), (time.monotonic() - started) * 1000,
        )
        return _cache


def secret(key: str) -> str:
    """One credential; raises KeyError if the vault does not hold `key`."""
    return get_secrets()[key]


def is_configured() -> bool:
    """True when the vault bootstrap variable is present in the environment.

    Used by config.py to decide whether the vault settings source is active
    (the app container) or dormant (unit tests, bare local tooling).
    """
    return bool(os.environ.get("NURAV_CREDS_ENDPOINT", "").strip())
