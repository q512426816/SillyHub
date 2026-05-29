"""ToolOperationLog table.

Records every tool operation (file_read, file_write, file_list,
file_search, shell_exec) executed through the gateway for audit.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, Uuid
from sqlmodel import Field

from app.models.base import BaseModel


class ToolOperationLog(BaseModel, table=True):
    __tablename__ = "tool_operation_logs"

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
    tool_type: str = Field(
        max_length=30,
        sa_column=Column(String(30), nullable=False),
    )
    params_json: str | None = Field(
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
        Index("ix_tool_op_lease", "lease_id", "timestamp"),
        Index("ix_tool_op_workspace", "workspace_id", "timestamp"),
    )
