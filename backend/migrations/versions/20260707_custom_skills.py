"""custom skills

Revision ID: 20260707_custom_skills
Revises: 20260706_component_readonly
Create Date: 2026-07-07

平台级自定义技能表（变更 2026-07-07-skills-mcp-management-ui，task-01）。

- D-001: 单文件 DB model —— 本变更只新增这一张表。
- D-002: ``name`` DB 层 UNIQUE（下述 unique index）+ 长度 40；字符集 [a-z0-9-] 2-40
  的校验由业务层 service 负责（task-02），DB 不参与字符集校验。
- D-010: 平台级共享 —— 无 ``workspace_id`` 列，所有工作区可见同一份 skill 库。
- ``created_by`` 引用 ``users.id``，``ondelete=SET NULL``（用户删除后 skill 保留）。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260707_custom_skills"
down_revision = "20260706_component_readonly"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "custom_skills",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(40), nullable=False),
        sa.Column("description", sa.String(200), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column(
            "created_by",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    # D-002: name 唯一约束（DB 层强制，字符集校验留业务层）。
    op.create_index(
        "ix_custom_skills_name",
        "custom_skills",
        ["name"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_custom_skills_name", table_name="custom_skills")
    op.drop_table("custom_skills")
