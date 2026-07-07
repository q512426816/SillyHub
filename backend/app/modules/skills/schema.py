"""Pydantic schemas for the CustomSkill admin CRUD API.

Change: 2026-07-07-skills-mcp-management-ui (task-02)

设计决策:
- D-002: ``name`` 字符集 ``[a-z0-9-]{2,40}`` 校验在 service 层（业务规则，
  非 DB 约束），schema 只声明类型 + 长度提示，字符集/前缀校验放 service
  以便返回统一 422 错误码（``validation_error``）。
- list 不返回 ``content``（SKILL.md 正文可能很长）；detail 单独返回完整 content。
- list 提供 ``content_preview``（前 N 字符）便于前端列表展示，避免 N+1 详情请求。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CustomSkillCreate(BaseModel):
    """创建请求体。"""

    name: str = Field(..., description="skill 唯一标识，[a-z0-9-]{2,40}，禁 sillyspec- 前缀")
    description: str = Field(..., min_length=1, max_length=200, description="一句话描述")
    content: str = Field(
        ..., min_length=1, description="SKILL.md 正文（YAML frontmatter 由业务层组装）"
    )


class CustomSkillUpdate(BaseModel):
    """更新请求体（部分更新，所有字段可选）。"""

    name: str | None = Field(None, description="同 create 规则")
    description: str | None = Field(None, min_length=1, max_length=200)
    content: str | None = Field(None, min_length=1)


class CustomSkillRead(BaseModel):
    """列表项（不含 content，含 preview）。"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str
    content_preview: str = Field(..., description="content 前 120 字符，供列表展示")
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime


class CustomSkillDetail(CustomSkillRead):
    """详情（含完整 content）。"""

    content: str


# list 返回的 preview 截断长度（task-02 蓝图：list 不返 content，提供 preview）。
CONTENT_PREVIEW_LENGTH = 120
