"""skill_sources + user_skill_enables 两表模型。

Change: 2026-09-11-skills-central-library (task-01)

设计决策（design §数据模型——字段唯一权威，逐字段对照）:
- D-002（平台共享源）: ``skill_sources`` 平台级 admin 配置表——url 全局
  UNIQUE（同一仓库配一份）；branch/subdir 支持一仓多技能子目录；
  last_commit/last_fetched_at/last_error 为 task-02 拉取器回写字段，本卡先备好。
- D-003（默认关启用）: ``user_skill_enables`` 按用户启用绑定——git 技能默认
  不进 bundle，用户逐个启用；UNIQUE(user_id, skill_key) 防重复启用。
- skill_key 编码 ``<source_id>:<技能目录名>``（String(200)）——刻意**不**做
  FK 到 skill_sources（源已删仍可保留悬空绑定，技能回来自动恢复，见 design
  兼容策略；源删除的连带清理在 service 层按前缀匹配完成）。
- user_id FK users ON DELETE CASCADE：用户注销级联删其启用绑定。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text, UniqueConstraint, Uuid
from sqlmodel import Field

from app.models.base import BaseModel


class SkillSource(BaseModel, table=True):
    """git 技能源（admin 配置，浅克隆进缓存根 ``skills_git_cache/<id>/``）。

    url 全局唯一（表级 named 约束，便于迁移对称回落）；branch/subdir 默认值
    在 Python 侧（ORM default），迁移列不带 server_default（mcp_registry
    task-01 先例：建表与模型声明逐列一致，防 autogenerate 漂移）。
    """

    __tablename__ = "skill_sources"
    __table_args__ = (UniqueConstraint("url", name="uq_skill_sources_url"),)

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    # git 仓库 https 地址；SSRF（assert_public_url）校验在 service 层（D-007）。
    url: str = Field(
        sa_column=Column(String(500), nullable=False),
    )
    branch: str = Field(
        default="main",
        sa_column=Column(String(100), nullable=False),
    )
    # 仓库内技能子目录（NULL = 仓库根即技能根）。
    subdir: str | None = Field(
        default=None,
        sa_column=Column(String(200), nullable=True),
    )
    # 源级开关：停用后不参与技能发现/收集（收集只遍历启用命中的目录，R-05）。
    enabled: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False),
    )
    # ── task-02 拉取器回写字段（本卡只建列，不做真实 clone/fetch）──
    last_commit: str | None = Field(
        default=None,
        sa_column=Column(String(40), nullable=True),
    )
    last_fetched_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    last_error: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class UserSkillEnable(BaseModel, table=True):
    """用户对某 git 技能的启用绑定（D-003：默认关，逐个启用进 bundle）。

    skill_key = ``<source_id>:<技能目录名>``；UNIQUE(user_id, skill_key) 防重复。
    本卡只建模型+迁移，enable 端点归 task-03。
    """

    __tablename__ = "user_skill_enables"
    __table_args__ = (
        UniqueConstraint("user_id", "skill_key", name="uq_user_skill_enables_user_skill_key"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    user_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    # <source_id>:<技能目录名>——见模块 docstring（刻意不做 FK，悬空绑定保留）。
    skill_key: str = Field(
        sa_column=Column(String(200), nullable=False),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
