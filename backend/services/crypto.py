"""Account-number encryption at rest (Fernet, key from the vault).

Only ciphertext and the last four digits are stored. The plaintext leaves the
server solely through the explicit "reveal" endpoint.
"""

from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from config import settings


class CryptoConfigError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    key = settings.account_number_key.strip()
    if not key:
        raise CryptoConfigError("ACCOUNT_NUMBER_KEY is not configured (see .env.reference).")
    try:
        return Fernet(key.encode())
    except ValueError as exc:  # never include the key in the message
        raise CryptoConfigError("ACCOUNT_NUMBER_KEY is not a valid Fernet key.") from exc


def encrypt_account_number(plain: str) -> tuple[str, str]:
    """Return (ciphertext, last4)."""
    cleaned = plain.strip()
    return _fernet().encrypt(cleaned.encode()).decode(), cleaned[-4:]


def decrypt_account_number(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise CryptoConfigError(
            "Stored account number cannot be decrypted — ACCOUNT_NUMBER_KEY differs from the key it was encrypted with."
        ) from exc
