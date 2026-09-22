"""add platform_change_events table

Revision ID: 20260923040000
Revises: 20260922194500
Create Date: 2026-09-23 04:00:00

Change 2026-09-23-change-events-channel task-01 / design §数据模型 / D-002@v1 /
D-003@v1 / D-004@v1：建 watcher 推送的变更事件 append-only 表
``platform_change_events``，承接 sillyspec CLI watcher 探测到变更事件后的批量
POST 上行（写入端点在 task-02）。事件是一次性写入的 append-only 观测数据
（design 生命周期契约节），无 update 语义，表零业务逻辑。

- 12 列：``id`` UUID PK；``workspace_id`` FK→workspaces(id) ON DELETE CASCADE
  NOT NULL（只由 shpsync_ token 派生，auth.py D-004@v1 通道，无 shk_live_
  过渡期 NULL 场景）；``change_name`` varchar(255) NOT NULL；``dedup_key``
  varchar(320) NOT NULL；``ts`` timestamptz NOT NULL（D-003：watcher epoch 毫秒
  经 schema 校验后 service 层归一为结构化 datetime，读路径按 ts 区间/排序）；
  ``kind`` varchar(64) NOT NULL；``stage`` varchar(64)/``detail`` varchar(2000)/
  ``rule`` varchar(128)/``severity`` varchar(32) 均可空；``provisional``
  Boolean NOT NULL（ORM 侧 Python default True，D-004 红线：落库恒 True，
  请求体携带值由 service 层丢弃）；``created_at`` timestamptz server_default
  now()（服务端接收审计字段，非事件时间）。
- ``uq_platform_change_events_dedup``：(workspace_id, change_name, dedup_key)
  唯一约束——幂等去重兜底（D-002：dedup_key 由 service 层归一，CLI 事件带 id
  优先用之，否则 ts|kind|stage 拼接；watcher 重跑/重推不产生重复行）。
- ``ix_platform_change_events_ws_change_ts``：(workspace_id, change_name, ts)
  普通索引——读路径主查询（单 workspace 单 change 按时间序/区间拉取）。
- create_table 与 ORM 完全对称、dialect 无关（sa.Uuid/sa.String/sa.Boolean/
  sa.DateTime 均跨 SQLite 测试库与 PostgreSQL 生产）。
- 无既有表结构变更（新表独立，append-only 无 schema 变更面）。
- ORM 见 app/modules/platform_sync/model.py PlatformChangeEventORM。

down_revision 接 ``20260922194500``（session_fork_columns；任务卡写码时点该迁移
经 merge 53a5c5c9d 已入链，``alembic heads`` 实测当前唯一 head，单 head 接续
避免多 head 分叉——migration-chain-fragmentation-pattern）。

本项目未上线，无需历史数据回填（CLAUDE.md 规则 11 / design §数据模型）。

author: qinyi
created_at: 2026-09-23 04:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260923040000"
down_revision: str | None = "20260922194500"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── design §数据模型 / D-002 / D-003 / D-004: watcher 事件 append-only 表 ──
    op.create_table(
        "platform_change_events",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("change_name", sa.String(length=255), nullable=False),
        sa.Column("dedup_key", sa.String(length=320), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("stage", sa.String(length=64), nullable=True),
        sa.Column("detail", sa.String(length=2000), nullable=True),
        sa.Column("rule", sa.String(length=128), nullable=True),
        sa.Column("severity", sa.String(length=32), nullable=True),
        sa.Column("provisional", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "workspace_id",
            "change_name",
            "dedup_key",
            name="uq_platform_change_events_dedup",
        ),
    )
    op.create_index(
        "ix_platform_change_events_ws_change_ts",
        "platform_change_events",
        ["workspace_id", "change_name", "ts"],
    )


def downgrade() -> None:
    """结构反向回滚（与 upgrade 完全对称可逆）。"""
    op.drop_index(
        "ix_platform_change_events_ws_change_ts",
        table_name="platform_change_events",
    )
    op.drop_table("platform_change_events")
