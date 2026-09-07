"""agent_session_task 会话任务状态持久化表（任务执行面板）

Revision ID: 20260905004300
Revises: 20260904223000
Create Date: 2026-09-05 00:43:00

2026-09-04-session-task-execution-panel task-01（FR-05 / D-006@v1）：
建新表 ``agent_session_task``（模型：app/modules/daemon/model.py
``AgentSessionTask``）——agent 任务粒度状态（SSE ``agent_task_status``
事件契约）的服务端持久化，刷新/切会话不丢。列与模型逐列对齐（防
autogenerate 漂移，20260902010000 先例口径）：

* ``session_id`` FK agent_sessions.id **ondelete CASCADE**——随会话删除
  级联清理；
* ``run_id`` NOT NULL **无 FK 硬约束**——事件必填字段随事件入库，但避免与
  agent_runs 删除链耦合（design §数据模型），仅建索引支撑后续按 run 分组
  增强；
* ``uq_agent_session_task_session_task``：UNIQUE(session_id, task_id)——
  upsert 定位键（同会话同 task 一行；刻意不做逐事件流水表，upsert 单行
  控写放大，R-03）；
* ``idx_agent_session_task_session_id`` / ``idx_agent_session_task_run_id``
  单列索引；
* NOT NULL 布尔列不设 server_default（默认在 ORM Python 侧，建表与模型
  声明逐列一致，20260902010000 先例）；created_at/updated_at 走
  sa.func.now()（双方言安全）。

写入/查询链路在 task-03（upsert 服务）与 task-02（快照端点）；本迁移
纯建表，无数据回填（新表零存量）。

down_revision 原写 20260904223000（提交者本地执行时 heads），但该文件
未随 d4fdcc7a 入库（git 全历史查无）——部署侧 alembic KeyError crash-loop
实证。接仓库真实链尾 20260903170000（群聊归档）；DB 当前恰停在该版本，
upgrade 链恢复后正常执行本迁移。downgrade 对称删索引+删表。

author: qinyi
created_at: 2026-09-05 00:43:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260905004300"
down_revision: str | None = "20260903170000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_session_task",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "session_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("run_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("task_id", sa.String(length=255), nullable=False),
        sa.Column("task_name", sa.String(length=512), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("last_tool_name", sa.String(length=255), nullable=True),
        sa.Column("tool_use_id", sa.String(length=255), nullable=True),
        sa.Column("elapsed_ms", sa.Integer(), nullable=True),
        sa.Column("total_tokens", sa.Integer(), nullable=True),
        sa.Column("tool_uses", sa.Integer(), nullable=True),
        sa.Column("is_async", sa.Boolean(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.UniqueConstraint(
            "session_id",
            "task_id",
            name="uq_agent_session_task_session_task",
        ),
    )
    op.create_index(
        "idx_agent_session_task_session_id",
        "agent_session_task",
        ["session_id"],
        unique=False,
    )
    op.create_index(
        "idx_agent_session_task_run_id",
        "agent_session_task",
        ["run_id"],
        unique=False,
    )


def downgrade() -> None:
    # 与 upgrade 对称反序：先删索引再删表。
    op.drop_index("idx_agent_session_task_run_id", table_name="agent_session_task")
    op.drop_index("idx_agent_session_task_session_id", table_name="agent_session_task")
    op.drop_table("agent_session_task")
