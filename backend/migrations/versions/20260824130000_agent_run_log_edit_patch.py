"""agent run log edit_patch column

Revision ID: 20260824130000
Revises: 20260824120000
Create Date: 2026-08-24 13:00:00

ql-20260824-020：会话进度视图 Edit 工具卡展开区显示文件内真实行号——

- ``agent_run_logs`` 加 ``edit_patch`` Text NULL：SDK tool_use_result.structuredPatch
  的 JSON 串（hunks 含 oldStart/newStart 真实文件行号 + lines ' '/'-'/'+' 前缀），
  由 _extract_sdk_messages 在 tool_result 展开时注入 flat record，submit_messages
  落库本列。NULL = 非 Edit 结果 / 旧数据 / 无 patch。
- 无索引（不按本列查询，仅随行读出）。
- batch_alter_table 兼容 SQLite/PostgreSQL。

down_revision 接 ``20260824120000``（agent_session_archive，并行变更
2026-08-24-platform-session-feedback-fix 的迁移；本 quick 与其串行链接避免多头）。

author: qinyi
created_at: 2026-08-24 13:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260824130000"
down_revision: str | None = "20260824120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("agent_run_logs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("edit_patch", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("agent_run_logs", schema=None) as batch_op:
        batch_op.drop_column("edit_patch")
