"""add perf indexes for high-frequency query paths

Revision ID: 202607250100
Revises: 202607231200
Create Date: 2026-07-25 00:00:00

Wave B（性能，2026-07-24 代码健壮性优化）：补 3 个高频查询缺失的非唯一 btree 索引，
零数据改动。与模型 ``__table_args__`` 同步（create_all / fresh DB 也生效）。详见
docs/code-quality-hardening-2026-07-24.md。

- ``agent_run_workspaces.agent_run_id``：patch apply / 工作区对话列表 / run→workspace 反查（10+ 调用点）
- ``ppm_plan_task.ps_plan_node_detail_id``：详情页加载保存 / 导入提交 / 任务级联（7+ 调用点）
- ``daemon_task_leases (runtime_id, status, created_at)``：get_pending_leases 高频轮询覆盖索引（避免回表+排序）
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "202607250100"
down_revision = "202607231200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_agent_run_workspaces_agent_run_id",
        "agent_run_workspaces",
        ["agent_run_id"],
    )
    op.create_index(
        "ix_ppm_plan_task_detail",
        "ppm_plan_task",
        ["ps_plan_node_detail_id"],
    )
    op.create_index(
        "idx_daemon_task_leases_runtime_status_created",
        "daemon_task_leases",
        ["runtime_id", "status", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_daemon_task_leases_runtime_status_created",
        table_name="daemon_task_leases",
    )
    op.drop_index(
        "ix_ppm_plan_task_detail",
        table_name="ppm_plan_task",
    )
    op.drop_index(
        "ix_agent_run_workspaces_agent_run_id",
        table_name="agent_run_workspaces",
    )
