"""platform_agent_logs liveness 状态四列（agent 会话活性状态推导）

Revision ID: 20260907141041
Revises: 20260905004300
Create Date: 2026-09-07 14:10:41

2026-09-07-agent-liveness-states task-07（design §5.3 / FR-03 / D-003@v1）：
``platform_agent_logs`` 加 daemon liveness 推导状态四列——``state``
（String(16)，五态 working/blocked/idle/ended/unknown）/ ``state_derived_at``
/ ``state_evidence``（String(200) 短摘要）/ ``last_event_at``（前端静默
时长数据源）。列与 ``AgentSessionLogORM`` 逐列对齐（防 autogenerate 漂移）。

四列全 nullable、**不回填存量行**（对齐 20260823120000 agent_session_id
先例 R-03 口径）：旧行 state NULL 由 GET 响应层归一 ``unknown``（schema
validator，design §5.3）。时间两列用 ``DateTime(timezone=True)`` 而非既有
CLI ISO 原文 String 先例——states 端点上报的是 Pydantic datetime 结构化
值（design §7 接口定义），无字典序比较需求。

写入端点（POST /agent-logs/states 批量 upsert-create）与 agent_blocked
通知属 task-08/09，本迁移纯加列。``(workspace_id, log_path)`` 唯一键与
既有列语义不动。

down_revision 接执行时唯一 head 20260905004300（alembic heads 实测单
head，R-02 防并行撞 head）。downgrade 对称反序 drop 四列。

author: qinyi
created_at: 2026-09-07 14:10:41
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260907141041"
down_revision: str | None = "20260905004300"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "platform_agent_logs",
        sa.Column("state", sa.String(length=16), nullable=True),
    )
    op.add_column(
        "platform_agent_logs",
        sa.Column("state_derived_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "platform_agent_logs",
        sa.Column("state_evidence", sa.String(length=200), nullable=True),
    )
    op.add_column(
        "platform_agent_logs",
        sa.Column("last_event_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    # 与 upgrade 对称反序 drop 四列。
    op.drop_column("platform_agent_logs", "last_event_at")
    op.drop_column("platform_agent_logs", "state_evidence")
    op.drop_column("platform_agent_logs", "state_derived_at")
    op.drop_column("platform_agent_logs", "state")
