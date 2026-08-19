"""Cross-workspace mission fields (project_id, scope_workspace_ids, target_workspace_id)

Revision ID: 20260819100000
Revises: 20260818150000
Create Date: 2026-08-19 10:00:00

Change 2026-08-19-cross-workspace-team-mission task-01（design §4.1）：
1. agent_missions 表加 project_id(uuid FK ppm_project_maintenance ON DELETE SET NULL)；
2. agent_missions 表加 scope_workspace_ids(JSON NULL，存 uuid-hex 列表)；
3. agent_runs 表加 target_workspace_id(uuid FK workspaces ON DELETE SET NULL)。

约束（design §4.1 / task-01 acceptance）：
- workspace_id 保持 NOT NULL 不动（语义收窄为 anchor）；
- project_id 允许 NULL（单 ws mission 不强制挂项目）；
- scope_workspace_ids NULL 缺省等同于单 workspace；
- target_workspace_id NULL 缺省 = anchor（零回归）。

downgrade：drop 三列（未上线无存量数据迁移）。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "20260819100000"
down_revision: str | None = "20260818150000"
branch_labels: str | list[str] | None = None
depends_on: str | list[str] | None = None


def upgrade() -> None:
    # agent_missions.project_id：项目关联（跨 ws mission 必填，单 ws 可空）
    op.add_column(
        "agent_missions",
        sa.Column(
            "project_id",
            sa.Uuid(),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_agent_missions_project_id",
        "agent_missions",
        "ppm_project_maintenance",
        ["project_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # agent_missions.scope_workspace_ids：派发范围快照（JSON NULL，存 uuid-hex 列表）
    op.add_column(
        "agent_missions",
        sa.Column("scope_workspace_ids", sa.JSON(), nullable=True),
    )

    # agent_runs.target_workspace_id：worker 落地工作区（NULL = anchor 零回归）
    op.add_column(
        "agent_runs",
        sa.Column(
            "target_workspace_id",
            sa.Uuid(),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_agent_runs_target_workspace_id",
        "agent_runs",
        "workspaces",
        ["target_workspace_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_agent_runs_target_workspace_id", "agent_runs", type_="foreignkey")
    op.drop_column("agent_runs", "target_workspace_id")

    op.drop_column("agent_missions", "scope_workspace_ids")

    op.drop_constraint("fk_agent_missions_project_id", "agent_missions", type_="foreignkey")
    op.drop_column("agent_missions", "project_id")
