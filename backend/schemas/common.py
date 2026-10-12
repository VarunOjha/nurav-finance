from datetime import date, timedelta
from decimal import Decimal
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

CurrencyCode = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]
CountryCode = Annotated[str, StringConstraints(pattern=r"^[A-Z]{2}$")]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
OptText = Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=2000)]
Money = Annotated[Decimal, Field(max_digits=20, decimal_places=4)]


def latest_allowed_date() -> date:
    """Newest `as_of` accepted for balances/snapshots.

    "Today" is ambiguous across time zones (the server runs in UTC), so one day
    of slack keeps a late-evening entry in UTC+ zones from being rejected as
    "in the future". Anything beyond that is a typo.
    """
    return date.today() + timedelta(days=1)


def _not_future(value: date) -> date:
    if value > latest_allowed_date():
        raise ValueError("Date cannot be in the future")
    return value


AsOfDate = Annotated[date, AfterValidator(_not_future)]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)
