from typing import Annotated, Self

from pydantic import StringConstraints, model_validator

from app.schemas.auth import Email
from app.schemas.base import ApiModel
from app.tiers import Tier

LeadName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Phone = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^\+?[\d\s()\-]{5,40}$")]
Company = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
Message = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
Honeypot = Annotated[str, StringConstraints(max_length=200)]


class LeadIn(ApiModel):
    """A request from the landing page («Индивидуальный» tier, a demo) or from the account page."""

    name: LeadName
    email: Email | None = None
    phone: Phone | None = None
    company: Company | None = None
    message: Message | None = None
    tier: Tier | None = None
    # Honeypot: hidden from people, filled in by bots. Non-empty — the request is silently dropped.
    website: Honeypot | None = None

    @model_validator(mode="after")
    def _contact(self) -> Self:
        if not self.email and not self.phone:
            raise ValueError("Укажите email или телефон")
        return self
