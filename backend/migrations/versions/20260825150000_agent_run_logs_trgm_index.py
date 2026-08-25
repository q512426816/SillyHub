"""agent_run_logs.content_redacted pg_trgm GIN 索引（会话搜索 q 加速）

Revision ID: 20260825150000
Revises: 20260824130000
Create Date: 2026-08-25 15:00:00

P2（2026-08-25 会话路径二审 #6）：``DaemonSessionService.list_agent_sessions``
的 ``q`` 过滤是 ``EXISTS(... AgentRunLog.content_redacted ILIKE '%q%')``——前导
通配吃掉 B-tree，大日志量用户的会话标题搜索退化为对 agent_run_logs 的顺序扫。
PG 侧启用 pg_trgm 扩展 + 建 GIN (gin_trgm_ops) 索引，让 ``ILIKE '%…%'`` 走
trigram 索引扫描。

- 仅 PostgreSQL 执行（``op.get_bind().dialect.name`` 守卫）；SQLite 测试环境
  直接跳过（索引**不**进 SQLModel model 定义——``gin_trgm_ops`` 会破坏 SQLite
  create_all，见 list_agent_sessions 的 ilike 查询注释）。
- pg_trgm 在 PG13+ 是 trusted extension，库 owner 即可 ``CREATE EXTENSION``，
  无需超级用户。
- 索引不使用 ``CONCURRENTLY``：alembic 迁移跑在事务里，CONCURRENTLY 不可用；
  表数据量可接受短锁（与既有 202607222330 等 perf index 迁移同口径）。
- downgrade 对称 drop index；**扩展不卸载**——同库其它对象可能已依赖 pg_trgm，
  卸载属 DBA 级决策，迁移不做破坏性 DROP EXTENSION。
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260825150000"
down_revision = "20260824130000"
branch_labels = None
depends_on = None

_INDEX_NAME = "ix_agent_run_logs_content_redacted_trgm"


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        f"CREATE INDEX IF NOT EXISTS {_INDEX_NAME} ON agent_run_logs "
        "USING gin (content_redacted gin_trgm_ops)"
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute(f"DROP INDEX IF EXISTS {_INDEX_NAME}")
