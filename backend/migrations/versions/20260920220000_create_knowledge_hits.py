"""create knowledge_hits table

Revision ID: 20260920220000
Revises: 20260918150000
Create Date: 2026-09-20 22:20:00.000000

Change ``2026-09-20-knowledge-effect-panel`` task-01 / Wave 1 / D-007@v1：建
``knowledge_hits`` 知识命中遥测表（列与 ``app/modules/knowledge/hits.py::
KnowledgeHit`` 一一对应）——daemon 把各端本地
``.sillyspec/.runtime/knowledge-hits.jsonl`` 增量上行落库，行 sha256 幂等
去重（多用户单工作区零重复）。

- ``uq_knowledge_hits_ws_hash``：(workspace_id, line_hash) 唯一索引——并发
  竞态数据库级幂等兜底（R-02），先查后插主路径循 ``20260918150000`` 幂等
  范式（避开 PG/SQLite 的 ON CONFLICT 方言分叉）。
- ``ix_knowledge_hits_ws_time``：(workspace_id, occurred_at) 支撑覆盖率趋势
  /死条目 90 天窗口查询。
- ``daemon_local_id``：body 显式携带的 daemon 实例 id，原样落库**不 FK**
  （数据层留归属，design 非目标「按人视图」后续用）。
- ``received_at`` 无 server_default：默认值由 ORM 层 default_factory 供
  （迁移列保持与模型一致的可空性即可，避免 PG now()/SQLite 方言分叉）。

纯建表零数据依赖（对既有读路径零耦合，回退=隐藏前端入口即可，design
兼容策略）。down_revision 接 ``20260918150000``（写码时 ``alembic heads``
实测唯一 head），单 head 接续避免多 head 分叉
（migration-chain-fragmentation-pattern）。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260920220000"
down_revision: str | None = "20260918150000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "knowledge_hits",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("line_hash", sa.String(length=64), nullable=False),
        sa.Column("daemon_local_id", sa.String(length=64), nullable=True),
        sa.Column("type", sa.String(length=32), nullable=False),
        sa.Column("change_name", sa.String(length=255), nullable=True),
        sa.Column("query_text", sa.Text(), nullable=True),
        sa.Column("matched_anchors", sa.JSON(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "uq_knowledge_hits_ws_hash",
        "knowledge_hits",
        ["workspace_id", "line_hash"],
        unique=True,
    )
    op.create_index(
        "ix_knowledge_hits_ws_time",
        "knowledge_hits",
        ["workspace_id", "occurred_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_knowledge_hits_ws_time", table_name="knowledge_hits")
    op.drop_index("uq_knowledge_hits_ws_hash", table_name="knowledge_hits")
    op.drop_table("knowledge_hits")
