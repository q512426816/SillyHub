"""PlanNode +has_module / PlanNodeDetail +module_id (plan-node-module-restructure, D-001/D-002@v1).

Revision ID: 20260716_pn_has_module
Revises: 20260714_pnm_plan_type
Create Date: 2026-07-16

变更 2026-07-16-plan-node-module-restructure / task-01。

模板簇结构改造 (design.md §8):
- ``ppm_plan_node`` ADD ``has_module`` BOOLEAN NOT NULL DEFAULT FALSE
  —— 是否有模块子表 (新建时定,保存后不可改,D-001@v1)。
- ``ppm_plan_node_detail`` ADD ``module_id`` UUID (nullable)
  —— 有模块模板时,明细挂模块 (模板→模块→明细 三层,D-002@v1);
  无模块模板时为 null,明细挂 plan_node_id (二层)。不加 FK 约束,
  对齐本表既有 plan_node_id 无 FK 的风格。
- CREATE INDEX ``ix_ppm_plan_node_detail_module`` ON (module_id)
  —— module_id 查询频繁 (三层展开按模块拉明细)。

现有数据: 项目未上线 (CLAUDE.md 规则 11 允许重置),has_module 默认 false、
module_id 默认 null (现有明细视为挂模板),无需复杂回填。

author: WhaleFall
created_at: 2026-07-16
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260716_pn_has_module"
down_revision = "20260714_pnm_plan_type"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. ppm_plan_node + has_module (NOT NULL DEFAULT FALSE)
    op.add_column(
        "ppm_plan_node",
        sa.Column(
            "has_module",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    # 2. ppm_plan_node_detail + module_id (nullable)
    op.add_column(
        "ppm_plan_node_detail",
        sa.Column("module_id", sa.Uuid(), nullable=True),
    )

    # 3. module_id 查询索引
    op.create_index(
        "ix_ppm_plan_node_detail_module",
        "ppm_plan_node_detail",
        ["module_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_ppm_plan_node_detail_module",
        table_name="ppm_plan_node_detail",
    )
    op.drop_column("ppm_plan_node_detail", "module_id")
    op.drop_column("ppm_plan_node", "has_module")
