"""skill_source 两表：skill_sources + user_skill_enables

Revision ID: 20260911100000
Revises: b299f3782f7a
Create Date: 2026-09-11 10:00:00

Change 2026-09-11-skills-central-library task-01（design「数据模型」节——字段
唯一权威，逐字段对照）单文件迁移：

1. ``skill_sources``——git 技能源（admin 配置）：url VARCHAR(500) 表级命名
   UNIQUE（``uq_skill_sources_url``）；branch VARCHAR(100)/subdir VARCHAR(200)
   NULL/enabled BOOL（三列默认值在 ORM Python 侧，不设 server_default——
   mcp_registry 20260910140000 先例：建表与模型声明逐列一致，防 autogenerate
   漂移）；last_commit VARCHAR(40) NULL/last_fetched_at NULL/last_error TEXT
   NULL 为 task-02 拉取器回写列，本卡只备列。
2. ``user_skill_enables``——按用户启用绑定（D-003）：user_id FK users ON
   DELETE CASCADE + UNIQUE(user_id, skill_key)（``uq_user_skill_enables_user_skill_key``）；
   skill_key 刻意不做 FK 到 skill_sources（源删除连带清理在 service 层按前缀
   匹配；悬空绑定保留，见 design 兼容策略）。

created_at 走 ``now()`` server_default（mcp_gateway/mcp_registry 先例），
updated_at 由 ORM 填充不设 server_default。无数据回填（新表零存量）。

down_revision 接执行时唯一 head b299f3782f7a（2026-09-11 ``alembic heads``
实测单 head，R-03）。downgrade 对称回落：先 enables（无 FK 依赖方向问题，
skill_key 为裸字符串列），再 sources（表级唯一约束随表删除）。

author: qinyi
created_at: 2026-09-11 10:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260911100000"
down_revision: str | None = "b299f3782f7a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── 1. skill_sources（模型 app/modules/skill_source/model.py）──
    op.create_table(
        "skill_sources",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("url", sa.String(length=500), nullable=False),
        sa.Column("branch", sa.String(length=100), nullable=False),
        sa.Column("subdir", sa.String(length=200), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("last_commit", sa.String(length=40), nullable=True),
        sa.Column("last_fetched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("url", name="uq_skill_sources_url"),
    )

    # ── 2. user_skill_enables（D-003 启用绑定；enable 端点归 task-03）──
    op.create_table(
        "user_skill_enables",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("skill_key", sa.String(length=200), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("user_id", "skill_key", name="uq_user_skill_enables_user_skill_key"),
    )


def downgrade() -> None:
    # 对称回落：先删 enables（skill_key 为裸字符串列，无 FK 依赖），再删 sources。
    op.drop_table("user_skill_enables")
    op.drop_table("skill_sources")
