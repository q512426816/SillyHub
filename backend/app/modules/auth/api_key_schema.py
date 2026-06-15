"""Pydantic DTOs for the API Key endpoints.

Plaintext is *only* returned by ``ApiKeyCreated`` immediately after
creation. ``ApiKeyRead`` (used for list endpoints) never contains the
plaintext or the hash.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ApiKeyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    expires_at: datetime | None = Field(default=None)


class ApiKeyRead(BaseModel):
    """List-row shape — safe to return on every GET."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    key_prefix: str
    last_used_at: datetime | None
    expires_at: datetime | None
    created_at: datetime
    revoked_at: datetime | None


class ApiKeyCreated(ApiKeyRead):
    """Returned once on POST 201. Carries the full plaintext key."""

    plaintext: str


class ApiKeyListResponse(BaseModel):
    items: list[ApiKeyRead]
