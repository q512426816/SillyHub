"""agent_runs.change_id 外键 SET NULL + turn_count 保守对账

Revision ID: 20261022100000
Revises: a05c84259_merge
Create Date: 2026-10-22 10:00:00

Change 2026-10-22-change-delete-session-history-fix（FR-02 / FR-04）。

历史事故（2026-10-22 生产会话 bbdbecc9）：reparse 判定 change 目录消失后物理
删除 ``changes`` 行，``agent_runs.change_id`` 的 ``ON DELETE CASCADE`` 把锚定在
这些变更上的 13 轮会话 run 及其 ``agent_run_logs`` 级联物理删除；``turn_count``
只在 inject 时自增、不回退，左栏显示 59 轮与会话内 46 轮不一致。

本迁移做两件事：

1. 把 ``agent_runs.change_id`` 外键从 ``CASCADE`` 改为 ``SET NULL``——轮级打锚
   是「用量归属」语义，不是生命周期从属；change 物理删除只清锚点，不动会话
   历史（与 ``AgentSession.change_id`` 既有 SET NULL 语义对齐）。
2. 保守对账 ``agent_sessions.turn_count``：只在**虚高**时下调，且 expected 只
   统计存在 ``channel='user_input'`` 日志的 run（纯配置切换轮不落 user_input、
   不计数；中途 steering 多条 user_input 挂同一 run，按 run 去重）。``turn_count
   <= expected`` 的行一律不动——保留 ``origin='tool_report'`` 会话的
   ``turn_count=0`` replay/未续聊语义。

downgrade 恢复 CASCADE；对账为单向数据修复，不回滚（需要历史值时从迁移前备份
恢复）。

author: zcode-agent
created_at: 2026-10-22 10:00:00
"""

from __future__ import annotations

from typing import Sequence

from alembic import op

revision: str = "20261022100000"
down_revision: str | None = "a05c84259_merge"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_FK_NAME = "agent_runs_change_id_fkey"

# 保守对账：仅下调虚高；expected = 有 user_input 日志的 run 数（按 run 去重）。
_RECONCILE_TURN_COUNT_SQL = """
UPDATE agent_sessions AS s
SET turn_count = sub.expected
FROM (
    SELECT r.agent_session_id AS sid, count(*) AS expected
    FROM agent_runs AS r
    WHERE r.agent_session_id IS NOT NULL
      AND EXISTS (
          SELECT 1
          FROM agent_run_logs AS l
          WHERE l.run_id = r.id
            AND l.channel = 'user_input'
      )
    GROUP BY r.agent_session_id
) AS sub
WHERE s.id = sub.sid
  AND s.turn_count > sub.expected
"""


def upgrade() -> None:
    op.drop_constraint(_FK_NAME, "agent_runs", type_="foreignkey")
    op.create_foreign_key(
        _FK_NAME,
        "agent_runs",
        "changes",
        ["change_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.execute(_RECONCILE_TURN_COUNT_SQL)


def downgrade() -> None:
    op.drop_constraint(_FK_NAME, "agent_runs", type_="foreignkey")
    op.create_foreign_key(
        _FK_NAME,
        "agent_runs",
        "changes",
        ["change_id"],
        ["id"],
        ondelete="CASCADE",
    )
