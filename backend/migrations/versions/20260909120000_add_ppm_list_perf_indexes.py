"""PPM 列表查询性能索引批次（ql-20260909-010-a318）

Revision ID: 20260909120000
Revises: 20260908160000
Create Date: 2026-09-09 12:00:00

2026-09-09 全仓性能排查发现的三类 PPM 列表索引缺陷，本迁移一次补齐：

1. ``ppm_problem_list.now_handle_user`` trgm GIN +
   ``data_scope.problem_scope_clause`` 同步改写为裸列 4 分支 LIKE（另见
   app 改动）。原实现对 ``concat(',', coalesce(col,''), ',')`` 表达式做
   ``%,uid,%``——表达式 LIKE 不可走列索引，OR 中存在不可索引分支导致
   非超管问题列表（list + workbench defect_count + 待办）全表顺序扫描 ×2
   （count + 取页）。
2. PPM 各列表 keyword 搜索列全是 ``ilike '%kw%'`` 前导通配，此前全仓仅
   ``agent_run_logs.content_redacted`` 有 trgm 索引（20260825150000 先例）。
   本迁移补齐五张表的搜索列：problem 6 列 / problem_change 4 列 /
   project_maintenance 2 列 / ps_project_plan 2 列 / plan_task 1 列。
3. ``ppm_problem_list.audit_user_id`` btree：202607222330（Wave 1）当时以
   "表基本为空" 跳过，该列现已是 problem_scope_clause 的 OR 分支之一，
   理由过时，补齐（model ``__table_args__`` 双写同步，保持代码↔迁移一致）。
4. ``git_operation_logs(user_id, timestamp)`` 复合：列表端点固定
   ``WHERE user_id=? ORDER BY timestamp DESC`` 分页，但既有索引只有
   ``(lease_id,timestamp)`` / ``(workspace_id,timestamp)``；该审计表每次
   git 操作插一行且无 retention，随历史线性恶化（时间炸弹型）。

trgm 索引不进 SQLModel model 定义（``gin_trgm_ops`` 破坏 SQLite create_all，
同 20260825150000 口径）；audit_user_id btree 进 model 双写（同 Wave 1 口径）；
git_operation_logs 复合索引不进 model（该模块既有索引均在迁移侧）。
仅 PostgreSQL 执行（方言守卫），SQLite 测试环境直接跳过。索引不用
CONCURRENTLY（alembic 迁移跑在事务里；表数据量可接受短锁，同既有口径）。
pg_trgm 扩展幂等 IF NOT EXISTS；downgrade 对称 drop，扩展不卸载（同
20260825150000：卸载属 DBA 级决策）。
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260909120000"
down_revision = "20260908160000"
branch_labels = None
depends_on = None

# 表 → 搜索/过滤列（前导通配 ilike/like 的列表热路径列）。
_TRGM_INDEXES: dict[str, list[str]] = {
    "ppm_problem_list": [
        "project_name",
        "model_name",
        "pro_desc",
        "func_name",
        "duty_user_name",
        "find_by",
        # data_scope 处置人分支（裸列 4 分支 LIKE 可走 trgm）
        "now_handle_user",
    ],
    "ppm_problem_change": [
        "project_name",
        "model_name",
        "pro_desc",
        "change_reason",
    ],
    "ppm_project_maintenance": [
        "project_name",
        "project_code",
    ],
    "ppm_ps_project_plan": [
        "contract_name",
        "company_name",
    ],
    "ppm_plan_task": [
        "work_partner",
    ],
}


def _trgm_index_name(table: str, column: str) -> str:
    return f"ix_{table}_{column}_trgm"


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    for table, columns in _TRGM_INDEXES.items():
        for column in columns:
            name = _trgm_index_name(table, column)
            op.execute(
                f"CREATE INDEX IF NOT EXISTS {name} ON {table} USING gin ({column} gin_trgm_ops)"
            )
    # problem_scope_clause 验证人分支（Wave 1 跳过理由已过时）
    op.create_index("ix_ppm_problem_list_audit_user", "ppm_problem_list", ["audit_user_id"])
    # git 操作审计列表（user_id 固定过滤 + timestamp 排序）
    op.create_index(
        "ix_git_operation_logs_user_ts",
        "git_operation_logs",
        ["user_id", "timestamp"],
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.drop_index("ix_git_operation_logs_user_ts", table_name="git_operation_logs")
    op.drop_index("ix_ppm_problem_list_audit_user", table_name="ppm_problem_list")
    for table, columns in _TRGM_INDEXES.items():
        for column in reversed(columns):
            op.execute(f"DROP INDEX IF EXISTS {_trgm_index_name(table, column)}")
