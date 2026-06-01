"""Pydantic schemas for tool gateway API."""

from __future__ import annotations

import datetime
import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ToolExecuteRequest(BaseModel):
    tool_type: Literal[
        "file_read", "file_write", "file_list", "file_search", "shell_exec", "run_tests", "http_get"
    ]
    params: dict[str, Any] = Field(default_factory=dict)


class ToolExecuteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tool_type: str
    result_code: int
    redacted_output: str | None = None
    timestamp: datetime.datetime
