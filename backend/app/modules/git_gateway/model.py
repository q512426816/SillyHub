"""GitOperationLog table.

Records every git operation executed through the gateway for audit.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, Uuid
from sqlmodel import Field

from app.models.base import BaseModel


class GitOperationLog(BaseModel, table=True):
    """Audit log for git operations executed inside a worktree lease."""

    __tablename__ = "git_operation_logs"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    lease_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("worktree_leases.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    user_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    operation: str = Field(
        max_length=50,
        sa_column=Column(String(50), nullable=False),
    )
    args_json: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    result_code: int = Field(
        sa_column=Column(Integer, nullable=False),
    )
    redacted_output: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    timestamp: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime, nullable=False, default=datetime.utcnow),
    )

    __table_args__ = (
        Index("ix_git_op_lease", "lease_id", "timestamp"),
        Index("ix_git_op_workspace", "workspace_id", "timestamp"),
    )
