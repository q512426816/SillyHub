"""Pydantic schemas for the skill_source admin CRUD + library/enable API（task-03）。

Change: 2026-09-11-skills-central-library (task-01 骨架 → task-03 填充)

设计决策:
- SourceCreate/SourceUpdate/SourceRead 照 skills/schema.py 先例（Create/Update
  校验长度，Read 含拉取器回写字段）；SSRF/权限校验不在 schema，在 service
  （返回领域错误码）。
- LibraryView/LibrarySkillItem（task-03 填充）：三源聚合技能项——skill_key 命名
  空间按来源区分：git = ``<source_id>:<目录名>``（恒含冒号），sillyspec/custom =
  tar 顶层目录名（恒不含冒号），enable 端点只接受带冒号的 git key。
- EnableOp：``POST /api/skills/{skill_key}/enable`` 请求体（enabled=False 等价
  DELETE）；DELETE 端点无体。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

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
    """启用/停用操作体（``POST /api/skills/{skill_key}/enable``，本人）。

    ``enabled=False`` 与 ``DELETE /api/skills/{skill_key}/enable`` 语义等价
    （删绑定）；DELETE 端点无请求体，直取 enabled=False。
    """

    enabled: bool = Field(..., description="True=启用进 bundle，False=停用")


class LibrarySkillItem(BaseModel):
    """技能库单项（三源聚合，task-03）。

    ``skill_key`` 命名空间：git = ``<source_id>:<目录名>``（含冒号，可 enable）；
    sillyspec/custom = tar 顶层目录名（不含冒号，恒启用不可 enable）。
    """

    skill_key: str = Field(
        ...,
        max_length=200,
        description="git 技能 <source_id>:<目录名>；sillyspec/custom 为目录名",
    )
    name: str = Field(..., description="技能名（git=目录名，与 bundle rel_path 顶层同口径）")
    description: str = Field("", description="SKILL.md frontmatter description（缺省空串）")
    source: Literal["sillyspec", "custom", "git"] = Field(
        ...,
        description="来源标记（与 bundle manifest files[].source 同口径）",
    )
    enabled: bool = Field(
        ...,
        description="我的启用态：git 技能默认 False（D-003，逐个启用进 bundle）；sillyspec/custom 恒 True",
    )
    source_id: uuid.UUID | None = Field(
        None,
        description="git 技能源 id（source=git 时非空，前端分组用）",
    )


class LibraryView(BaseModel):
    """技能库三源聚合视图（``GET /api/skills/library``，task-03）。"""

    sources: list[SourceRead] = Field(default_factory=list, description="已配置的 git 技能源")
    skills: list[LibrarySkillItem] = Field(
        default_factory=list,
        description="三源聚合技能项（sillyspec-* + 我的 CustomSkill + 启用源实时发现）",
    )
