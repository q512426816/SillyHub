"""20260712_team_orch

Revision ID: 20260712_team_orch
Revises: 20260711_softdel_agses
Create Date: 2026-07-12 13:55:00.000000

为 team 主 agent 动态编排（2026-07-12-team-main-agent-orchestration / task-02）
新增 3 列：
- ``agent_missions.worker_preset`` JSON：用户预设 worker 列表（D-002@v2）
- ``agent_missions.main_agent_config`` JSON：主 agent 配置（D-003@v2）
- ``agent_runs.worktree_branch`` String(128)：per-worker 独立 worktree 分支名（D-005@v2）

三列均 nullable 默认 NULL，兼容老 mission/run 行（brownfield，mode=single 零回归）。
worker_preset 每条 {agent_type, model, objective, role}；main_agent_config
{agent_type, provider, model}——内部 schema 由应用层约束，DB 层只承载 JSON 容器。

upgrade()：add_column（3 列）。downgrade()：drop_column（对称反转）。

注：revision id ≤32 字符（alembic_version.version_num varchar(32)）。

author: qinyi
created_at: 2026-07-12 13:55:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260712_team_orch"
down_revision: str | None = "20260711_softdel_agses"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agent_missions",
        sa.Column("worker_preset", sa.JSON(), nullable=True),
    )
    op.add_column(
        "agent_missions",
        sa.Column("main_agent_config", sa.JSON(), nullable=True),
    )
    op.add_column(
        "agent_runs",
        sa.Column("worktree_branch", sa.String(length=128), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_runs", "worktree_branch")
    op.drop_column("agent_missions", "main_agent_config")
    op.drop_column("agent_missions", "worker_preset")
