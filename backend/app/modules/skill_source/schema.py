"""Pydantic schemas for the skill_source admin CRUD API（+ task-03 骨架 DTO）。

Change: 2026-09-11-skills-central-library (task-01)

设计决策:
- SourceCreate/SourceUpdate/SourceRead 照 skills/schema.py 先例（Create/Update
  校验长度，Read 含拉取器回写字段）；SSRF/权限校验不在 schema，在 service
  （返回领域错误码）。
- LibraryView/EnableOp 为 task-03（绑定+收集）预留骨架——本卡只立契约名，
  字段由 task-03 按 design §接口定义（list_library 三源聚合+我的启用态 /
  toggle_enable(skill_key, user, enabled)）扩充。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SourceCreate(BaseModel):
    """创建请求体（url 经 SSRF 校验须公网，git 二进制探测在 service）。"""

    url: str = Field(
        ...,
        min_length=1,
        max_length=500,
        description="git 仓库 https 地址（私网/非法 scheme 会被 SSRF 校验拒绝）",
    )
    branch: str = Field("main", min_length=1, max_length=100, description="分支名，默认 main")
    subdir: str | None = Field(
        None,
        max_length=200,
        description="仓库内技能子目录（缺省 = 仓库根）",
    )


class SourceUpdate(BaseModel):
    """更新请求体（部分更新，所有字段可选）。"""

    url: str | None = Field(None, min_length=1, max_length=500, description="同 create 规则")
    branch: str | None = Field(None, min_length=1, max_length=100)
    subdir: str | None = Field(None, max_length=200)
    enabled: bool | None = Field(None, description="源级开关（停用不参与技能发现/收集）")


class SourceRead(BaseModel):
    """源详情（含 task-02 拉取器回写的 last_commit/last_fetched_at/last_error）。"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    url: str
    branch: str
    subdir: str | None
    enabled: bool
    last_commit: str | None
    last_fetched_at: datetime | None
    last_error: str | None
    created_at: datetime
    updated_at: datetime


class EnableOp(BaseModel):
    """启用/停用操作体（task-03 ``POST/DELETE /api/skills/{skill_key}/enable``）。"""

    enabled: bool = Field(..., description="True=启用进 bundle，False=停用")


class LibrarySkillItem(BaseModel):
    """技能库单项（骨架——task-03 填充来源类型/描述/我的启用态等字段）。"""

    skill_key: str = Field(
        ...,
        max_length=200,
        description="git 技能 <source_id>:<目录名>（sillyspec-*/CustomSkill 命名空间见 task-03）",
    )


class LibraryView(BaseModel):
    """技能库三源聚合视图（骨架——task-03 的 ``GET /api/skills/library`` 填充）。"""

    sources: list[SourceRead] = Field(default_factory=list, description="已配置的 git 技能源")
    skills: list[LibrarySkillItem] = Field(
        default_factory=list,
        description="三源聚合技能项（task-03 扩充字段与启用态）",
    )
