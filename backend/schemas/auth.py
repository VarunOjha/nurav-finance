import re
import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, BeforeValidator, EmailStr, Field

from schemas.common import ORMModel

Gender = Literal["female", "male", "non_binary", "prefer_not_to_say"]

PHONE_CHARS = re.compile(r"^\+?[0-9\s().-]+$")
PHONE_MIN_DIGITS, PHONE_MAX_DIGITS = 7, 15  # E.164 tops out at 15 digits
EARLIEST_BIRTH_YEAR = 1900


def _phone(value: str | None) -> str | None:
    value = (value or "").strip()
    if not value:
        return None
    digits = sum(c.isdigit() for c in value)
    if len(value) > 32 or not PHONE_CHARS.match(value) or not PHONE_MIN_DIGITS <= digits <= PHONE_MAX_DIGITS:
        raise ValueError(f"Enter a valid phone number: {PHONE_MIN_DIGITS}-{PHONE_MAX_DIGITS} digits, optional + country code")
    return value


def _birth_date(value: date | None) -> date | None:
    if value is None:
        return None
    if value > date.today():
        raise ValueError("Date of birth cannot be in the future")
    if value.year < EARLIEST_BIRTH_YEAR:
        raise ValueError(f"Date of birth must be in {EARLIEST_BIRTH_YEAR} or later")
    return value


Phone = Annotated[str | None, BeforeValidator(_phone)]
BirthDate = Annotated[date | None, AfterValidator(_birth_date)]


class RegisterRequest(BaseModel):
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    date_of_birth: BirthDate = None
    gender: Gender | None = None
    email: EmailStr
    phone: Phone = None
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(ORMModel):
    id: uuid.UUID
    first_name: str
    last_name: str
    date_of_birth: date | None
    gender: str | None
    email: str
    phone: str | None
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class ProfileUpdate(BaseModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=80)
    last_name: str | None = Field(default=None, min_length=1, max_length=80)
    date_of_birth: BirthDate = None
    gender: Gender | None = None
    email: EmailStr | None = None
    phone: Phone = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
