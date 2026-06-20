"""create ppm task tables (plan_task / task_execute / work_hour)

Revision ID: 202607041100
Revises: 202607041000
Create Date: 2026-07-04 11:00:00.000000

task-06:新建 ppm task 子域三张平台级表 (无 tenant_id,UUID 主键)。
- ``ppm_plan_task`` 任务计划 (含 kanban_order)
- ``ppm_task_execute`` 任务执行 (executePlan 联动 + 状态机 10/20/30/40/90)
- ``ppm_work_hour`` 工时 (源 TenantBaseDO.tenant_id 按 D-008@v1 丢弃)

字段对齐源 DO ``dal/dataobject/task{plan,execute}`` 与 ``workhour``。
TaskPlanDO 源 fileUrl1..fileUrl9 拆列在迁移后合并为单 JSON ``file_urls``。

设计依据:``design.md`` §7 (task 子域) + §8 (数据模型)。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607041100"
down_revision: str | None = "202607041000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- ppm_plan_task ---
    op.create_table(
        "ppm_plan_task",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("user_name", sa.String(length=100), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="未开始"),
        sa.Column("month", sa.String(length=20), nullable=True),
        sa.Column("week", sa.String(length=20), nullable=True),
        sa.Column("year", sa.String(length=10), nullable=True),
        sa.Column("week_day", sa.String(length=50), nullable=True),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("project_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("project_name", sa.String(length=200), nullable=True),
        sa.Column("module_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("module_name", sa.String(length=200), nullable=True),
        sa.Column("content", sa.String(length=2000), nullable=True),
        sa.Column("work_load", sa.String(length=50), nullable=True),
        sa.Column("add_work", sa.String(length=50), nullable=True),
        sa.Column("work_partner", sa.String(length=200), nullable=True),
        sa.Column("remarks", sa.String(length=1000), nullable=True),
        sa.Column("no", sa.Integer(), nullable=True),
        sa.Column("ps_plan_node_detail_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("actual_start_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actual_end_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("start_remark", sa.String(length=500), nullable=True),
        sa.Column("end_remark", sa.String(length=500), nullable=True),
        sa.Column("time_spent", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("plan_attach_group_id", sa.String(length=100), nullable=True),
        sa.Column("file_urls", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("kanban_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_ppm_plan_task_user_status", "ppm_plan_task", ["user_id", "status"])
    op.create_index("ix_ppm_plan_task_project", "ppm_plan_task", ["project_id"])

    # --- ppm_task_execute ---
    op.create_table(
        "ppm_task_execute",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("plan_task_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("problem_task_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("time_spent", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("actual_start_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actual_end_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("start_remark", sa.String(length=500), nullable=True),
        sa.Column("end_remark", sa.String(length=500), nullable=True),
        sa.Column("execute_info", sa.String(length=2000), nullable=True),
        sa.Column("attach_group_id", sa.String(length=100), nullable=True),
        sa.Column("execute_user_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("check_info", sa.String(length=2000), nullable=True),
        sa.Column("check_attach_group_id", sa.String(length=100), nullable=True),
        sa.Column("check_user_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("check_flag", sa.String(length=2), nullable=True),
        sa.Column("current_user_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(length=4), nullable=False, server_default="10"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_ppm_task_execute_plan", "ppm_task_execute", ["plan_task_id"])
    op.create_index("ix_ppm_task_execute_problem", "ppm_task_execute", ["problem_task_id"])

    # --- ppm_work_hour ---
    op.create_table(
        "ppm_work_hour",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("project_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("task_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("user_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("work_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("hours", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("description", sa.String(length=1000), nullable=True),
        sa.Column("type", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_ppm_work_hour_user_date", "ppm_work_hour", ["user_id", "work_date"])
    op.create_index("ix_ppm_work_hour_project", "ppm_work_hour", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_ppm_work_hour_project", table_name="ppm_work_hour")
    op.drop_index("ix_ppm_work_hour_user_date", table_name="ppm_work_hour")
    op.drop_table("ppm_work_hour")

    op.drop_index("ix_ppm_task_execute_problem", table_name="ppm_task_execute")
    op.drop_index("ix_ppm_task_execute_plan", table_name="ppm_task_execute")
    op.drop_table("ppm_task_execute")

    op.drop_index("ix_ppm_plan_task_project", table_name="ppm_plan_task")
    op.drop_index("ix_ppm_plan_task_user_status", table_name="ppm_plan_task")
    op.drop_table("ppm_plan_task")
