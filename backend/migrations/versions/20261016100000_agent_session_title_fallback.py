"""agent_sessions 加 title_fallback 列 + 存量回填（2026-10-16-backend-mem-polling task-08）。

背景：会话列表 ``GET /api/daemon/sessions`` 对 agent_run_logs 做窗口函数派生
标题（生产实测 1.4s，随日志量线性）。本迁移把派生结果持久化为
``agent_sessions.title_fallback``（String(64)，首条 user_input 前 64 字符源、
消费侧 [:30]），列表路径改读列（漏网会话由路由惰性回写自愈）。

回填口径与 router 现查询逐字一致（session_crud.py:336-365）：按会话取
``channel='user_input'`` 中 ``(timestamp asc, id asc)`` 首条的
``substr(content_redacted, 1, 64)``；零 user_input 会话回写哨兵空串（防每轮
列表重查）。窗口函数 UPDATE...FROM 在 PG 与 SQLite（≥3.33）双方言均可用。
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20261016100000"
down_revision: str | Sequence[str] | None = "20261016010000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 模块级常量供迁移本体与单测共用（测试在 SQLite 建元数据后直接执行验证双方言）。
BACKFILL_SQL = """
UPDATE agent_sessions AS s
SET title_fallback = t.content
FROM (
    SELECT agent_sessions.id AS sid,
           SUBSTR(agent_run_logs.content_redacted, 1, 64) AS content,
           ROW_NUMBER() OVER (
               PARTITION BY agent_sessions.id
               ORDER BY agent_run_logs.timestamp ASC, agent_run_logs.id ASC
           ) AS rn
    FROM agent_sessions
    JOIN agent_runs ON agent_runs.agent_session_id = agent_sessions.id
    JOIN agent_run_logs
        ON agent_run_logs.run_id = agent_runs.id
       AND agent_run_logs.channel = 'user_input'
) AS t
WHERE s.id = t.sid AND t.rn = 1 AND s.title_fallback IS NULL
"""

SENTINEL_SQL = """
UPDATE agent_sessions SET title_fallback = '' WHERE title_fallback IS NULL
"""


def upgrade() -> None:
    op.add_column(
        "agent_sessions",
        sa_column_nullable_string64(),
    )
    op.execute(BACKFILL_SQL)
    op.execute(SENTINEL_SQL)


def downgrade() -> None:
    op.drop_column("agent_sessions", "title_fallback")


def sa_column_nullable_string64():
    import sqlalchemy as sa

    return sa.Column("title_fallback", sa.String(64), nullable=True)
