"""add performance indexes for hot query paths

Revision ID: 202607222330
Revises: 20260722220000_add_file_urls

性能优化 Wave 1(系统性能审计 2026-07-22):补齐高频查询路径缺失索引。
全部为 ``create_index``(项目未上线、数据量小,无需 CONCURRENTLY;SQLite/PG 双方言通用)。
每个索引的 model ``__table_args__`` 同步声明,保持代码↔迁移一致。

补的索引(依据 = 审计确认的高频过滤点):
- ``ix_ppm_project_member_user``(user_id):``data_scope.manager_project_ids()``
  对 ``WHERE user_id=?`` 全表扫描——该查询被 task/problem/plan/project 数据范围
  + ``can_operate_problem`` 调用,即**每个 PPM 列表/操作请求都跑**。现有唯一索引
  ``ux_ppm_project_member_project_user`` leading 列是 ``pm_project_id``,
  user_id-only 查询用不上。(P0/P1,最高价值)
- ``ix_ppm_task_execute_exec_status``(execute_user_id, status):工作台「我的任务」
  热路径(``workbench/service``、``task/service`` 多处 WHERE execute_user_id=?),
  复合索引覆盖按执行人+状态过滤。(M2+M5)
- ``ix_agent_runs_status``(status):``status IN ('pending','running','interrupting')``
  的 reconcile/listing 查询(``agent/finalizer``、``change/dispatch``、
  ``daemon/router``);该表随 agent 执行无限增长。(M3)
- ``ix_agent_runs_created_at``(created_at):run 列表按时间排序。(M11)
- ``ix_agent_sessions_workspace``(workspace_id):change/workspace 维度 session listing
  (run_sync 注释自称 "workspace_id 兜底");model 注释写 "for change-scoped session
  listing" 却一直没建索引。(M4)
- ``ix_ppm_problem_list_created_by`` / ``ix_ppm_problem_list_duty_user``:
  ``data_scope.problem_scope_clause`` 的创建人/责任人 OR 分支。(M7)
- ``ix_ppm_ps_project_plan_created_by``:``data_scope.build_plan_scope_clause``
  创建人分支。(M9)

未加(审计 P3 或功能未启用,遵循 YAGNI):``ppm_task_execute.current_user_id``、
``ppm_problem_list.audit_user_id``、``audit_logs.actor_id``(审计功能 register_audit_hooks
是死代码未启用,表基本为空,启用时再补)。
"""

from __future__ import annotations

from alembic import op

revision = "202607222330"
down_revision = "20260722220000_add_file_urls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PPM 权限热路径(最高价值)
    op.create_index("ix_ppm_project_member_user", "ppm_project_member", ["user_id"])
    # PPM 任务执行:工作台「我的任务」+ 状态分组
    op.create_index(
        "ix_ppm_task_execute_exec_status",
        "ppm_task_execute",
        ["execute_user_id", "status"],
    )
    # agent 执行/调度 reconcile
    op.create_index("ix_agent_runs_status", "agent_runs", ["status"])
    op.create_index("ix_agent_runs_created_at", "agent_runs", ["created_at"])
    # change/workspace 维度 session listing
    op.create_index("ix_agent_sessions_workspace", "agent_sessions", ["workspace_id"])
    # PPM 问题清单数据范围 OR 分支
    op.create_index("ix_ppm_problem_list_created_by", "ppm_problem_list", ["created_by"])
    op.create_index("ix_ppm_problem_list_duty_user", "ppm_problem_list", ["duty_user_id"])
    # PPM 项目计划数据范围创建人分支
    op.create_index(
        "ix_ppm_ps_project_plan_created_by",
        "ppm_ps_project_plan",
        ["created_by"],
    )


def downgrade() -> None:
    # 反序 drop,与 upgrade 对称。
    op.drop_index("ix_ppm_ps_project_plan_created_by", table_name="ppm_ps_project_plan")
    op.drop_index("ix_ppm_problem_list_duty_user", table_name="ppm_problem_list")
    op.drop_index("ix_ppm_problem_list_created_by", table_name="ppm_problem_list")
    op.drop_index("ix_agent_sessions_workspace", table_name="agent_sessions")
    op.drop_index("ix_agent_runs_created_at", table_name="agent_runs")
    op.drop_index("ix_agent_runs_status", table_name="agent_runs")
    op.drop_index("ix_ppm_task_execute_exec_status", table_name="ppm_task_execute")
    op.drop_index("ix_ppm_project_member_user", table_name="ppm_project_member")
