import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from app.schemas.base import ApiModel
from app.schemas.plan_data import PlanData

PlanName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
PlanSort = Literal["updatedAt", "-updatedAt", "createdAt", "-createdAt", "name", "-name"]


class PlanSummary(ApiModel):
    """A card on the home page: everything except the plan contents."""

    id: uuid.UUID
    name: str
    version: int
    vehicle_count: int
    body_count: int
    item_count: int
    created_at: datetime
    updated_at: datetime


class PlanOut(PlanSummary):
    data: PlanData


class PlanPage(ApiModel):
    items: list[PlanSummary]
    total: int
    limit: int
    offset: int


class PlanCreate(ApiModel):
    name: PlanName
    # Omitted: an empty plan with the default vehicle.
    data: PlanData | None = None


class PlanUpdate(ApiModel):
    # The version the client edited; a different current version means someone saved in between.
    version: Annotated[int, Field(ge=1)]
    name: PlanName | None = None
    data: PlanData | None = None


class PlanDuplicate(ApiModel):
    # Omitted: "<name> (копия)".
    name: PlanName | None = None
