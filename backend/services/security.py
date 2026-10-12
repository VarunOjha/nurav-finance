"""Password hashing and JWT access tokens (same scheme as Nurav Docs)."""

import uuid
from datetime import UTC, datetime, timedelta

from jose import JWTError, jwt
from passlib.context import CryptContext

from config import settings

ALGORITHM = "HS256"
MIN_PASSWORD_LENGTH = 6
# bcrypt only hashes the first 72 bytes; longer inputs are rejected rather than
# silently truncated.
BCRYPT_MAX_BYTES = 72

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd_context.verify(plain, hashed)


def password_problem(password: str) -> str | None:
    """Return a user-facing error if the password is unacceptable, else None."""
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Password must be at least {MIN_PASSWORD_LENGTH} characters"
    if len(password.encode("utf-8")) > BCRYPT_MAX_BYTES:
        return f"Password must be at most {BCRYPT_MAX_BYTES} bytes"
    return None


def _signing_key() -> str:
    if not settings.jwt_secret:
        raise RuntimeError("JWT_SECRET is not configured (see .env.reference).")
    return settings.jwt_secret


def create_access_token(user_id: uuid.UUID) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, _signing_key(), algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, _signing_key(), algorithms=[ALGORITHM])
    except JWTError:
        return None
