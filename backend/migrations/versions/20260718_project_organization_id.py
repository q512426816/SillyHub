"""PpmProjectMaintenance +organization_id (project-plan-data-scope, D-007@v1).

Revision ID: 20260718_project_org_id
Revises: 20260717_psn_tmpl_fields
Create Date: 2026-07-18

变更 2026-07-18-project-plan-data-scope / task-01。

项目挂部门 (design.md §4):
- ``ppm_project_maintenance`` ADD ``organization_id`` UUID (nullable, FK→organizations.id)
  —— 数据权限范围过滤键。部门经理(DEPTBOSS) 按 UserOrganization 部门+子树过滤。
- CREATE INDEX ``ix_ppm_project_maintenance_org`` ON (organization_id)。
- 数据初始化: 现有项目全刷到「项目二部」
  (organizations.code='dept_103', id=9f968a5f-a9ef-55ae-9488-bdc20205d210)。

项目未上线 (CLAUDE.md 规则 11 允许重置),UPDATE 写死项目二部 UUID (DB 实测稳定值)。
UUID 字符串字面量 PG(uuid 列自动转型) / SQLite(SQLAlchemy Uuid 以 str(uuid) 带连字符存储) 两端兼容。

author: qinyi
created_at: 2026-07-18 17:30:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# 项目二部 organization_id (organizations.code='dept_103', DB 实测稳定值)
_PROJECT_TWO_DEPT_ID = "9f968a5f-a9ef-55ae-9488-bdc20205d210"

# revision identifiers, used by Alembic.
revision = "20260718_project_org_id"
down_revision = "20260717_psn_tmpl_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. ppm_project_maintenance + organization_id (nullable, FK→organizations.id)
    op.add_column(
        "ppm_project_maintenance",
        sa.Column("organization_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_ppm_project_maintenance_org",
        "ppm_project_maintenance",
        "organizations",
        ["organization_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # 2. organization_id 过滤索引 (部门经理范围过滤命中)
    op.create_index(
        "ix_ppm_project_maintenance_org",
        "ppm_project_maintenance",
        ["organization_id"],
    )

    # 3. 数据初始化: 现有项目全挂「项目二部」(dept_103)
    # bindparam 显式 type_=Uuid,避免 PG 把字符串参数当 VARCHAR 拒绝 uuid 列
    # (DatatypeMismatchError);SQLite 端 Uuid 适配为字符串存储。
    op.execute(
        sa.text(
            "UPDATE ppm_project_maintenance "
            "SET organization_id = :org_id "
            "WHERE organization_id IS NULL"
        ).bindparams(sa.bindparam("org_id", value=_PROJECT_TWO_DEPT_ID, type_=sa.Uuid()))
    )


def downgrade() -> None:
    op.drop_index(
        "ix_ppm_project_maintenance_org",
        table_name="ppm_project_maintenance",
    )
    op.drop_constraint(
        "fk_ppm_project_maintenance_org",
        "ppm_project_maintenance",
        type_="foreignkey",
    )
    op.drop_column("ppm_project_maintenance", "organization_id")
