"""add platform_agent_logs table

Revision ID: 20260823090000
Revises: 20260822090000
Create Date: 2026-08-23 09:00:00

Change 2026-08-23-platform-agent-log-ingest task-01 / design §3.1 / §3.3 / D-002 / D-003：
建 CLI 推送的 agent 会话日志元信息表 ``platform_agent_logs``，承接 CLI ``sillyspec run``
入口探测本地 harness 会话日志后的 best-effort POST /api/agent-logs（协议
``docs/platform-agent-log-protocol.md``，只含路径与元信息、不含日志内容）。

- 18 业务列 + 审计两列：``id`` UUID PK；``workspace_id`` FK→workspaces(id) ON DELETE
  CASCADE NOT NULL（只由 shpsync_ token 派生，D-004@v1 通道，无 shk_live_ 过渡期
  NULL 场景）；``log_path`` varchar(1024)（CLI 上报原样，Windows 盘符/反斜杠，NFR-02）；
  ``harness`` varchar(32) NOT NULL；``format``/``session_id``/``originator``/
  ``detected_via``/``agent_cwd``/``size_bytes``(BigInteger)/``mtime_ms``(Float)/
  ``first_seen_at``·``last_seen_at``·``pushed_at`` varchar(64)/``invocations``(Integer)/
  ``last_command`` varchar(255)/``scan_run_id`` varchar(128) 均可空；``exists``
  Boolean NOT NULL（ORM 侧 Python default True）。
- 只存结构化列、不存 payload JSON（D-002：协议明言「整行存 entries 元信息」，本表无
  派生逻辑、展示字段固定；CLI schema 升版未知字段由 Pydantic ``extra=ignore`` 静默
  丢弃不 422，字段演进靠 schema 升版加列）。
- 时间字段存 CLI ISO 8601 UTC 原文 String(64)（D-003，对齐 ``last_pushed_at`` 先例：
  CLI 恒发 UTC Z 格式 → 字符串字典序 = 时间序，``last_seen_at`` 直接作排序键，免
  时区/精度转换）。
- ``created_at`` / ``updated_at`` timestamptz server_default now()（服务端审计字段，
  非 CLI 时间）。
- ``(workspace_id, log_path)`` 复合唯一约束支撑幂等 upsert（CLI 重跑整行覆盖，
  D-005）——UniqueConstraint 而非复合 PK（quicklog 先例口径：SQLite/PostgreSQL 对齐，
  先例 20260810150000 / 20260817010000）。
- create_table 与 ORM 完全对称、dialect 无关（sa.Uuid/sa.String/sa.Boolean/
  sa.BigInteger/sa.Float 均跨 SQLite 测试库与 PostgreSQL 生产）。
- 无额外普通索引：查询路径是 (workspace_id, log_path) 唯一约束命中 + 单 workspace
  内按 ``last_seen_at`` 排序（条目量级 = 每 workspace 活跃日志文件数，CLI 侧 ≤10 条
  留底上限，内存排序完成；有量级需要再补）。
- ORM 见 app/modules/platform_sync/model.py AgentSessionLogORM。

down_revision 接 ``20260822090000``（mission_session_id，当前单头，无撞号）。

本项目未上线，无需历史数据回填（CLAUDE.md 规则 11 / design §3.3）。

author: qinyi
created_at: 2026-08-23 09:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260823090000"
down_revision: str | None = "20260822090000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── design §3.1 / D-002 / D-003: agent 会话日志元信息表 ──
    op.create_table(
        "platform_agent_logs",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("log_path", sa.String(length=1024), nullable=False),
        sa.Column("harness", sa.String(length=32), nullable=False),
        sa.Column("format", sa.String(length=64), nullable=True),
        sa.Column("session_id", sa.String(length=128), nullable=True),
        sa.Column("originator", sa.String(length=128), nullable=True),
        sa.Column("detected_via", sa.String(length=64), nullable=True),
        sa.Column("agent_cwd", sa.String(length=1024), nullable=True),
        sa.Column("exists", sa.Boolean(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("mtime_ms", sa.Float(), nullable=True),
        sa.Column("first_seen_at", sa.String(length=64), nullable=True),
        sa.Column("last_seen_at", sa.String(length=64), nullable=True),
        sa.Column("invocations", sa.Integer(), nullable=True),
        sa.Column("last_command", sa.String(length=255), nullable=True),
        sa.Column("scan_run_id", sa.String(length=128), nullable=True),
        sa.Column("pushed_at", sa.String(length=64), nullable=True),
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
            "workspace_id",
            "log_path",
            name="uq_platform_agent_logs_workspace_path",
        ),
    )


def downgrade() -> None:
    """结构反向回滚（与 upgrade 完全对称可逆）。"""
    op.drop_table("platform_agent_logs")
