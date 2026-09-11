"""agent 日志归属存量清理（纯数据迁移，零 schema 变更）

Revision ID: 20260912050000
Revises: 5e295549e20f
Create Date: 2026-09-12 05:00:00

Change 2026-09-11-agent-log-attribution-refactor task-05 / design §Phase 3 /
D-004@v2（用户裁决全清）：一次性清空错配时代的归属数据（ctx 错配 + hub 交叉
污染两份实证见 docs/sillyspec/agent-log-ctx-attribution-mismatch.md 与
agent-log-hub-attribution-cross-session-contamination.md），正确归属由 CLI
升级（Phase 1 own-only 推送）后重推重建（D-005@v1 不动表结构）：

1. ``UPDATE platform_agent_logs SET agent_session_id = NULL``——行保留
   （探测事实/invocations 计数不动），仅清归属列等重推；
2. ``UPDATE agent_sessions SET deleted_at = now() WHERE origin = 'tool_report'
   AND deleted_at IS NULL``——旧 ``{harness}|{ctx}`` 聚合键会话在新解析下
   永不再命中（新键值 ``{ctx}``），防僵尸；软删不硬删（R-07 可逆）；
3. ``DELETE FROM change_session_links``——全表清空：links 无来源列，错配
   时代的 hub 污染行与合法行不可区分，用户裁决全清（DG-04）；
4. ``DELETE FROM quicklog_session_links``——同上。

**执行时机（DG-03，与 backend 代码发布解耦）**：backend 代码先行发布（兼容
旧 CLI 全量推送）→ CLI 升级 → 本迁移作为一次性运维动作手动执行；迁移脚本
不随 backend 发布自动前滚。

downgrade no-op：归属/绑定数据可由 CLI 重推重建，反向回填无意义（D-004@v2
明示，no-op 是设计而非缺失）。

down_revision 接执行时唯一 head 5e295549e20f（2026-09-12 ``alembic heads``
实测单 head）。

author: qinyi
created_at: 2026-09-12 05:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260912050000"
down_revision: str | None = "5e295549e20f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── D-004@v2 ①：清归属列（行保留，重推重建归属）──
    op.execute(sa.text("UPDATE platform_agent_logs SET agent_session_id = NULL"))
    # ── D-004@v2 ②：旧 {harness}|{ctx} 聚合键 tool_report 会话软删防僵尸（R-07 可逆）──
    op.execute(
        sa.text(
            "UPDATE agent_sessions SET deleted_at = now() "
            "WHERE origin = 'tool_report' AND deleted_at IS NULL"
        )
    )
    # ── D-004@v2 ③④：两张 links 表全清（无来源列，污染行与合法行不可区分，DG-04）──
    op.execute(sa.text("DELETE FROM change_session_links"))
    op.execute(sa.text("DELETE FROM quicklog_session_links"))


def downgrade() -> None:
    # no-op（D-004@v2）：数据可由 CLI 重推重建，恢复错配时代的旧归属无意义。
    pass
