import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, EmailStr, Field

from schemas.common import ORMModel

Gender = Literal["female", "male", "non_binary", "prefer_not_to_say"]

EARLIEST_BIRTH_YEAR = 1900


def _birth_date(value: date | None) -> date | None:
    if value is None:
        return None
    if value > date.today():
        raise ValueError("Date of birth cannot be in the future")
    if value.year < EARLIEST_BIRTH_YEAR:
        raise ValueError(f"Date of birth must be in {EARLIEST_BIRTH_YEAR} or later")
    return value


BirthDate = Annotated[date | None, AfterValidator(_birth_date)]


class RegisterRequest(BaseModel):
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    date_of_birth: BirthDate = None
    gender: Gender | None = None
    email: EmailStr
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


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
