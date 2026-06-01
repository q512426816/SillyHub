"""Pydantic schemas for ToolPolicy CRUD API."""

from __future__ import annotations

import datetime
import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator

ALL_TOOL_TYPES: frozenset[str] = frozenset(
    {
        "file_read",
        "file_write",
        "file_list",
        "file_search",
        "shell_exec",
        "run_tests",
        "http_get",
    }
)


class ToolPolicyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    allowed_tools: list[str] = Field(default_factory=lambda: sorted(ALL_TOOL_TYPES))
    blocked_commands: list[str] = Field(default_factory=list)
    allowed_paths: list[str] = Field(default_factory=lambda: ["."])
    allowed_domains: list[str] = Field(default_factory=list)
    max_timeout: int = Field(default=30, ge=1, le=600)
    max_output_size: int = Field(default=64000, ge=1024, le=1_000_000)

    @field_validator("allowed_tools")
    @classmethod
    def _validate_allowed_tools(cls, v: list[str]) -> list[str]:
        unknown = set(v) - ALL_TOOL_TYPES
        if unknown:
            raise ValueError(
                f"Unknown tool types: {sorted(unknown)}, allowed: {sorted(ALL_TOOL_TYPES)}"
            )
        return v


class ToolPolicyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    allowed_tools: list[str] | None = Field(default=None)
    blocked_commands: list[str] | None = Field(default=None)
    allowed_paths: list[str] | None = Field(default=None)
    allowed_domains: list[str] | None = Field(default=None)
    max_timeout: int | None = Field(default=None, ge=1, le=600)
    max_output_size: int | None = Field(default=None, ge=1024, le=1_000_000)

    @field_validator("allowed_tools")
    @classmethod
    def _validate_allowed_tools(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        unknown = set(v) - ALL_TOOL_TYPES
        if unknown:
            raise ValueError(
                f"Unknown tool types: {sorted(unknown)}, allowed: {sorted(ALL_TOOL_TYPES)}"
            )
        return v


class ToolPolicyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    allowed_tools: list[str]
    blocked_commands: list[str]
    allowed_paths: list[str]
    allowed_domains: list[str]
    max_timeout: int
    max_output_size: int
    created_at: datetime.datetime
    updated_at: datetime.datetime
