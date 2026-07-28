"""ppm_project_workspace association table

Revision ID: 202607281500
Revises: 202607271700
Create Date: 2026-07-28 15:00:00.000000

Change ``2026-07-28-ppm-project-link-workspace`` task-02 / FR-01 / FR-07 / R1：
新建 PPM 项目 ↔ 工作区 多对多关联表 ``ppm_project_workspace``。镜像 task-01 模型
定义(``workspace/model.py`` 的 ``PpmProjectWorkspace``),仿 ``task_workspaces`` /
``agent_run_workspaces`` 既有 M:N 关联表模式。

- 复合主键 ``(ppm_project_id, workspace_id)`` 天然防重复绑定(无需额外唯一索引);
- 双向 ``ON DELETE CASCADE``:删 PPM 项目 / 硬删工作区时关联记录同步清理,与现有
  PPM 强 FK 引用(``PpmProjectMember``/``PpmProjectStakeholder``)行为一致(R3);
- 索引 ``ix_ppm_project_workspace_workspace`` 对齐 ``TaskWorkspace`` 的工作区维度
  查询索引(``list_by_workspace`` 走 leading workspace_id)。

零破坏:仅新建表,不改 PPM 现有表 / 工作区现有关联表。

down_revision 接 ``202607271700``(``alembic heads`` 实测当前单 head,auth-refresh
task-03 已确认);游离 ``202608010900`` 不在 head 链(pre-existing 仓库卫生问题,
非本变更引入),接续不受影响(migration-chain-fragmentation-pattern 记忆)。部署
前需再次 ``alembic heads`` 校验单头——SQLite 单测抓不到 PG 多 head 崩溃。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607281500"
down_revision: str | None = "202607271700"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ppm_project_workspace",
        sa.Column(
            "ppm_project_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("ppm_project_maintenance.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("ppm_project_id", "workspace_id"),
    )
    op.create_index(
        "ix_ppm_project_workspace_workspace",
        "ppm_project_workspace",
        ["workspace_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_ppm_project_workspace_workspace",
        table_name="ppm_project_workspace",
    )
    op.drop_table("ppm_project_workspace")
