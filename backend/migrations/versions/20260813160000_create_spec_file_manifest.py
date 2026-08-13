"""create spec_file_manifest table

Revision ID: 20260813160000
Revises: 20260811150000
Create Date: 2026-08-13 16:00:00

Change 2026-08-13-platform-managed-file-sync task-01 / design §6 §8 / D-011 / FR-03：
建独立增量清单表 ``spec_file_manifest``（不复用 scan_documents，scan_docs reparse 不碰
此表）——增量同步协议的唯一权威清单：

- ``path`` 相对 spec_root；``content_hash`` = SHA-256 hex；``version`` 文件级版本号
  （乐观锁基准，D-001/D-004，每次 apply op version+1）；``exists`` 软删语义
  （D-002/D-010，delete op 移备份区后 exists=false）；``updated_at`` UTC。
- 唯一索引 ux(workspace_id, path)（同 ws 同 path 重复插入 IntegrityError 拦截）；
  version 普通索引（按版本扫描）。

down_revision 接 ``20260811150000``（platform_sync_workspace，execute 实测当前 alembic
head）。dialect 无关 create_table / create_index，让 SQLite 测试库与 PostgreSQL 生产
对齐（precedent 20260811150000_platform_sync_workspace）。

本项目未上线，无需历史数据回填（CLAUDE.md 规则 7）。

author: qinyi
created_at: 2026-08-13 16:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260813160000"
down_revision: str | None = "20260811150000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── design §8 / D-011: spec_file_manifest 表 ──
    op.create_table(
        "spec_file_manifest",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("exists", sa.Boolean(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ux_spec_manifest_ws_path",
        "spec_file_manifest",
        ["workspace_id", "path"],
        unique=True,
    )
    op.create_index(
        "ix_spec_manifest_version",
        "spec_file_manifest",
        ["version"],
    )


def downgrade() -> None:
    """结构反向回滚（与 upgrade 相反顺序，完全对称可逆）。"""
    op.drop_index("ix_spec_manifest_version", table_name="spec_file_manifest")
    op.drop_index("ux_spec_manifest_ws_path", table_name="spec_file_manifest")
    op.drop_table("spec_file_manifest")
