"""PsPlanNode + template_plan_node_id / has_module (project-plan-init-from-template, D-005@v1).

Revision ID: 20260717_psn_tmpl_fields
Revises: 20260716_pn_has_module
Create Date: 2026-07-17

变更 2026-07-17-project-plan-init-from-template / task-01。

PsPlanNode 加 2 字段 (design §5.1/§8):
- ``template_plan_node_id`` UUID (nullable) —— 来源 PlanNode 模板 (新建项目计划时
  从模板生成里程碑写入;手动建为 null)。不加 FK,对齐本表既有列风格。
- ``has_module`` BOOLEAN NOT NULL DEFAULT FALSE —— 冗余自模板,milestone-details
  模块层判断用 (避免每次反查模板)。

现有数据: 项目未上线 (CLAUDE.md 规则 11),template_plan_node_id default null、
has_module default false (R-02 定案不回填,现有手动里程碑接受二级展示)。

author: WhaleFall
created_at: 2026-07-17
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260717_psn_tmpl_fields"
down_revision = "20260716_pn_has_module"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. template_plan_node_id (nullable, 来源模板)
    op.add_column(
        "ppm_ps_plan_node",
        sa.Column("template_plan_node_id", sa.Uuid(), nullable=True),
    )
    # 2. has_module (NOT NULL DEFAULT FALSE, 冗余自模板)
    op.add_column(
        "ppm_ps_plan_node",
        sa.Column(
            "has_module",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("ppm_ps_plan_node", "has_module")
    op.drop_column("ppm_ps_plan_node", "template_plan_node_id")
