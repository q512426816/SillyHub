"""daemon_run_snapshots 侧表：1b 轮次文件变更 / 时序快照承载

Revision ID: 20261021120000
Revises: c3f8a1d6e2b4
Create Date: 2026-10-21 12:00:00

Change 2026-10-20-session-page-dsh-alignment task-08（FR-13 / FR-14 / FR-15 /
FR-16 / D-023@v1）：daemon 每轮结束上报的 ``TurnFileChangesSnapshot``（逐文件
+/−、status、归因、partial 降级）与 ``TurnTimingSnapshot``（attempt 区间 /
TTFT）落点。

- **只建侧表 + run_id 唯一索引**，不改 ``agent_runs`` 任何既有列：快照是可选
  观测面，老 daemon 不写；一行 = 一轮（``run_id`` FK ``agent_runs.id``
  ON DELETE CASCADE），``(run_id)`` 幂等覆盖写（重复上报等价最后一次）。
- ``file_changes`` / ``timing`` 为 JSON（``sa.JSON``，PG 即 JSON 非 JSONB）；
  ``collect_ms`` / ``status`` / ``reason`` / ``truncated`` 是快照头提升列；
  ``capability`` NOT NULL default ``'tool_only'``（daemon 未上报快照时显式
  降级，禁止把「字段缺失」透成「本轮无改动」——E6 / E8）。
- downgrade 对称删索引 + 删表。

author: qinyi
created_at: 2026-10-21 12:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261021120000"
down_revision: str | None = "c3f8a1d6e2b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "daemon_run_snapshots"
_RUN_ID_INDEX = "uq_daemon_run_snapshots_run_id"


def upgrade() -> None:
    op.create_table(
        _TABLE,
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "run_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("file_changes", sa.JSON(), nullable=True),
        sa.Column("timing", sa.JSON(), nullable=True),
        sa.Column("collect_ms", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(16), nullable=True),
        sa.Column("reason", sa.String(32), nullable=True),
        sa.Column(
            "truncated",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "capability",
            sa.String(16),
            nullable=False,
            server_default=sa.text("'tool_only'"),
        ),
        sa.Column("daemon_version", sa.String(50), nullable=True),
    )
    # 幂等键 / 读模型批量 IN 查询的唯一索引（不建其他索引——单 run 一行，
    # 查询形态只有 run_id 等值与 run_id IN 两种）。
    op.create_index(_RUN_ID_INDEX, _TABLE, ["run_id"], unique=True)


def downgrade() -> None:
    op.drop_index(_RUN_ID_INDEX, table_name=_TABLE)
    op.drop_table(_TABLE)
