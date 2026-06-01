"""GitIdentity table.

Follows ``references/17-db-schema.md`` §2.5.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, LargeBinary, String, Uuid
from sqlmodel import Field

from app.models.base import BaseModel

CredentialType = Literal["pat", "oauth", "ssh_key", "app"]
Provider = Literal["github", "gitlab", "gitea", "generic"]


class GitIdentity(BaseModel, table=True):
    """A bound Git credential for a platform user."""

    __tablename__ = "git_identities"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True),
    )
    user_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    provider: str = Field(
        max_length=30,
        sa_column=Column(String(30), nullable=False),
    )
    git_username: str | None = Field(
        default=None,
        max_length=200,
        sa_column=Column(String(200), nullable=True),
    )
    git_email: str | None = Field(
        default=None,
        max_length=200,
        sa_column=Column(String(200), nullable=True),
    )
    credential_type: str = Field(
        max_length=20,
        sa_column=Column(String(20), nullable=False),
    )
    encrypted_credential: bytes = Field(
        sa_column=Column(LargeBinary, nullable=False),
    )
    key_id: str = Field(
        max_length=50,
        sa_column=Column(String(50), nullable=False),
    )
    allowed_repositories: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False, default=list),
    )
    expires_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime, nullable=True),
    )
    revoked_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime, nullable=True),
    )
    last_used_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime, nullable=False, default=datetime.utcnow),
    )

    __table_args__ = (Index("idx_git_identities_user", "user_id", "revoked_at"),)
