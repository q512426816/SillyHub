"""custom_skills 改 per-user 归属 (custom-skill-per-user, task-02)

将 ``custom_skills`` 从「平台级全局共享」改为「per-user 独立资产」的 DB 层迁移。

变更 2026-07-31-custom-skill-per-user / task-02。依据 design.md：
- D-001: 复用 ``created_by`` 作 per-user 归属键（不新加 owner_user_id）。
- D-002@v2: ``name`` 从全局 UNIQUE 改 ``(created_by, name)`` 联合唯一。
- D-005: 现有全局数据清空重置（项目未上线，开发数据可清）。
- D-010 废弃: 平台级共享 → per-user 隔离。

来源迁移: ``20260707_custom_skills``（原 ``ix_custom_skills_name`` unique index +
``created_by`` nullable + FK ondelete=SET NULL）。

迁移顺序（R2 / gap#1 / gap#2，不可调换）：
1. ``DELETE FROM custom_skills`` 清空——必须先清，否则历史 NULL / 重复 name 行
   会阻塞后续 ``created_by NOT NULL`` 与联合唯一约束。
2. drop 旧 ``ix_custom_skills_name`` unique index（原迁移用 ``create_index(unique=True)``,
   gap#1: 按 index 名 drop，不要瞎猜 constraint 名）。
3. ``created_by`` 改 NOT NULL（gap#2: 清空后才能 ALTER）。
4. FK ``custom_skills.created_by`` ondelete ``SET NULL`` → ``CASCADE``
   （D-001 强归属：用户注销级联删其技能）。
5. 加联合唯一 ``uq_custom_skills_created_by_name`` (created_by, name)
   （名字与 task-01 model 的 UniqueConstraint 对齐）。

downgrade 只回滚结构（约束/列可逆），**已清空的行数据不可恢复**（gap#4）——
docstring 此处声明，downgrade 返回空表。

测试不在 SQLite 上跑 alembic（root conftest 用 ``BaseModel.metadata.create_all`` 建表），
本迁移仅在生产 PG 上执行，故用 PG 原生 ``alter_column`` / ``drop_constraint`` /
``create_foreign_key``，不包 ``batch_alter_table``。

Revision ID: 202607311500
Revises: 202608310900
Create Date: 2026-07-31

author: qinyi
created_at: 2026-07-31 22:51:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "202607311500"
down_revision = "202608310900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. D-005: 清空现有全局自定义技能数据（项目未上线，开发数据可清）。
    #    必须先清空：历史 NULL / 重复 name 行会阻塞 created_by NOT NULL 与联合唯一。
    op.execute("DELETE FROM custom_skills")

    # 2. gap#1: drop 旧 name 全局唯一 index。
    #    原迁移 20260707_custom_skills.py 用 op.create_index(unique=True)，
    #    故此处按 index 名 drop（非 constraint）。
    op.drop_index("ix_custom_skills_name", table_name="custom_skills")

    # 3. gap#2: created_by nullable → NOT NULL（清空后无 NULL 行，ALTER 安全）。
    op.alter_column(
        "custom_skills",
        "created_by",
        existing_type=sa.Uuid(as_uuid=True),
        nullable=False,
    )

    # 4. D-001: FK ondelete SET NULL → CASCADE（强归属：用户注销级联删其技能）。
    #    PG 自动生成的 FK 名为 custom_skills_created_by_fkey（DB 实测确认）。
    op.drop_constraint(
        "custom_skills_created_by_fkey",
        "custom_skills",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "custom_skills_created_by_fkey",
        "custom_skills",
        "users",
        ["created_by"],
        ["id"],
        ondelete="CASCADE",
    )

    # 5. D-002@v2: per-user 联合唯一 (created_by, name)。
    #    名字与 task-01 model 的 UniqueConstraint(name=...) 对齐，防代码↔迁移漂移。
    op.create_index(
        "uq_custom_skills_created_by_name",
        "custom_skills",
        ["created_by", "name"],
        unique=True,
    )


def downgrade() -> None:
    """结构回滚（gap#4: 已清空的行数据不可恢复，downgrade 后表仍为空）。

    回滚顺序与 upgrade 相反：删联合唯一 → FK 改回 SET NULL → created_by nullable
    → 重建 ix_custom_skills_name 全局唯一 index。DELETE 清空的数据不恢复
    （开发环境数据，已在 upgrade 中声明丢弃）。
    """
    # 1. 删 per-user 联合唯一 index。
    op.drop_index(
        "uq_custom_skills_created_by_name",
        table_name="custom_skills",
    )

    # 2. FK ondelete CASCADE → SET NULL（恢复原 20260707_custom_skills 语义）。
    op.drop_constraint(
        "custom_skills_created_by_fkey",
        "custom_skills",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "custom_skills_created_by_fkey",
        "custom_skills",
        "users",
        ["created_by"],
        ["id"],
        ondelete="SET NULL",
    )

    # 3. created_by NOT NULL → nullable（恢复审计字段语义）。
    op.alter_column(
        "custom_skills",
        "created_by",
        existing_type=sa.Uuid(as_uuid=True),
        nullable=True,
    )

    # 4. 重建旧 name 全局唯一 index（恢复 D-002 全局唯一）。
    op.create_index(
        "ix_custom_skills_name",
        "custom_skills",
        ["name"],
        unique=True,
    )
