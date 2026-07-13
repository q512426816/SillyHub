"""20260713_fix_session_zombie

Revision ID: 20260713_fix_session_zombie
Revises: 20260712_team_orch
Create Date: 2026-07-13

历史交互式 ``agent_sessions.status='pending'`` 僵尸会话一次性清理（D-004@v1，
变更 2026-07-13-fix-interactive-session-zombie / task-02 / Wave3）。

背景：close_interactive_run / cancel_lease 原不回写 session 终态（design §1.2
病灶 B/C），致本机 PG 实测 7 个 pending 僵尸——背后 run 终态 3 completed /
3 failed / 1 killed，无一在跑。本迁移按 D-004@v1 映射规则把这批存量一次性收口：

  run.status='completed' → session.status='ended'   ended_at=run.finished_at
  run.status='killed'    → session.status='ended'   （D-003 kill=正常终止）
  run.status='failed'    → session.status='failed'  ended_at=run.finished_at
  无关联 run / run 仍 running/pending（孤儿） → session.status='ended'  ended_at=now()

仅处理 ``status='pending' AND deleted_at IS NULL``（active/reconnecting/ended/
failed 及已软删行不动，D-005 幂等守卫的迁移侧等价）。

纯 data migration（D-002@v1 零结构变更：无 add_column/drop_column/create_index）。
downgrade 不可逆：pending→ended/failed 是基于 run 终态的一次性映射，原 pending
已无法区分"真在跑"还是"僵尸"（本项目允许重置数据，CLAUDE.md 规则 11）。

注：revision id ≤32 字符（alembic_version.version_num varchar(32)）。

author: qinyi
created_at: 2026-07-13
"""

from __future__ import annotations

from typing import Sequence

from alembic import op

revision: str = "20260713_fix_session_zombie"
down_revision: str | None = "20260712_team_orch"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 3 条 UPDATE 顺序执行；全部 WHERE s.status='pending' AND s.deleted_at IS NULL
    # （仅清活跃僵尸，不动 active/reconnecting/ended/failed 及已软删行）。
    #
    # PG raw SQL（``UPDATE ... FROM ...`` + ``NOW()``）。测试侧用 SQLite 兼容的
    # 等价子查询验证映射（见 tests/test_session_zombie_migration.py）。

    # 1. completed / killed → ended（D-003 kill 对齐，ended_at=run.finished_at）
    op.execute(
        """
        UPDATE agent_sessions s
        SET status = 'ended',
            ended_at = COALESCE(r.finished_at, NOW())
        FROM agent_runs r
        WHERE r.agent_session_id = s.id
          AND r.status IN ('completed', 'killed')
          AND s.status = 'pending'
          AND s.deleted_at IS NULL
        """
    )

    # 2. failed → failed（ended_at=run.finished_at）
    op.execute(
        """
        UPDATE agent_sessions s
        SET status = 'failed',
            ended_at = COALESCE(r.finished_at, NOW())
        FROM agent_runs r
        WHERE r.agent_session_id = s.id
          AND r.status = 'failed'
          AND s.status = 'pending'
          AND s.deleted_at IS NULL
        """
    )

    # 3. 孤儿（无关联终态 run：无 run 或 run 仍 running/pending）→ ended，now()
    op.execute(
        """
        UPDATE agent_sessions s
        SET status = 'ended',
            ended_at = NOW()
        WHERE s.status = 'pending'
          AND s.deleted_at IS NULL
          AND NOT EXISTS (
                SELECT 1 FROM agent_runs r
                WHERE r.agent_session_id = s.id
                  AND r.status IN ('completed', 'killed', 'failed')
          )
        """
    )


def downgrade() -> None:
    # 不可逆：pending → ended/failed 是基于 run 终态的一次性映射，原 pending 已无法
    # 区分"真在跑"还是"僵尸"（本项目允许重置数据，CLAUDE.md 规则 11）。不写回滚 SQL。
    raise NotImplementedError("fix_session_zombie is an irreversible data migration (D-004@v1)")
