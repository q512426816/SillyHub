"""Release DTOs."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel as PydanticModel


class ReleaseCreate(PydanticModel):
    version: str
    title: str | None = None
    target_environment: str = "staging"
    change_ids: list[uuid.UUID] = []
    deploy_policy: dict | None = None


class ReleaseResponse(PydanticModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    version: str
    title: str | None
    status: str
    target_environment: str
    change_ids: list[uuid.UUID]
    creator_id: uuid.UUID
    deployed_at: datetime | None
    rolled_back_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ReleaseApprovalCreate(PydanticModel):
    verdict: str  # "approve" or "reject"
    comment: str | None = None


class ReleaseApprovalResponse(PydanticModel):
    id: uuid.UUID
    release_id: uuid.UUID
    approver_id: uuid.UUID
    verdict: str
    comment: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
