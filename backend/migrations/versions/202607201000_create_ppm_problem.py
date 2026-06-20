"""create ppm problem subdomain tables (6 tables)

task-05 / change 2026-06-20-ppm-module-migration design §8。

6 张平台级表:
- ppm_problem_list                  问题清单主 (4 节点审批流状态机驱动)
- ppm_problem_change                问题变更主 (resource_id 关联源问题)
- ppm_problem_list_process_task     问题清单在办任务 (审批流)
- ppm_problem_list_process_log      问题清单流程履历
- ppm_problem_change_process_task   问题变更在办任务
- ppm_problem_change_process_log    问题变更流程履历

平台级:无 workspace_id (D-001@v1)。字段对齐源 DO (ProblemListDO /
ProblemChangeDO / ProcessTaskDO / ProcessLogDO + 变更对应 DO),Java
驼峰转蛇形;源 Long 主键 → UUID 主键;源 fileUrl1-9 九字段 → 统一
file_urls JSON (D-007@v1)。

down_revision = 202607041200 (W1 merge head,单一 head)。
downgrade 反序 drop。

Revision ID: 202607201000
Revises: 202607041200
Create Date: 2026-07-20 10:00:00.000000
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607201000"
down_revision: str | None = "202607041200"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- ppm_problem_list ---
    op.create_table(
        "ppm_problem_list",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("project_id", sa.String(64), nullable=False),
        sa.Column("project_name", sa.String(255), nullable=True),
        sa.Column("module_id", sa.String(64), nullable=True),
        sa.Column("model_name", sa.String(255), nullable=True),
        sa.Column("pro_desc", sa.Text(), nullable=True),
        sa.Column("file_urls", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("func_name", sa.String(255), nullable=True),
        sa.Column("pro_type", sa.String(64), nullable=True),
        sa.Column("is_urgent", sa.String(8), nullable=True),
        sa.Column("find_by", sa.String(128), nullable=True),
        sa.Column("find_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pro_answer", sa.Text(), nullable=True),
        sa.Column("work_type", sa.String(64), nullable=True),
        sa.Column("duty_user_id", sa.String(64), nullable=True),
        sa.Column("duty_user_name", sa.String(128), nullable=True),
        sa.Column("plan_start_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("plan_end_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("real_end_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("audit_user_id", sa.String(64), nullable=True),
        sa.Column("audit_user_name", sa.String(128), nullable=True),
        sa.Column("audit_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("status", sa.String(8), nullable=False, server_default="1"),
        sa.Column("is_delay_plan", sa.String(8), nullable=True),
        sa.Column("work_load", sa.String(64), nullable=True),
        sa.Column("time_spent", sa.Numeric(10, 2), nullable=True),
        sa.Column("now_node", sa.Integer(), nullable=True),
        sa.Column("now_handle_user", sa.String(255), nullable=True),
        sa.Column("now_handle_user_name", sa.String(255), nullable=True),
        sa.Column("handle_info", sa.Text(), nullable=True),
        sa.Column("check_info", sa.Text(), nullable=True),
        sa.Column("check_result", sa.String(8), nullable=True),
        sa.Column("check_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_ppm_problem_list_project", "ppm_problem_list", ["project_id"])
    op.create_index("ix_ppm_problem_list_status", "ppm_problem_list", ["status"])
    op.create_index("ix_ppm_problem_list_now_node", "ppm_problem_list", ["now_node"])

    # --- ppm_problem_change ---
    op.create_table(
        "ppm_problem_change",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("resource_id", sa.String(64), nullable=False),
        sa.Column("project_id", sa.String(64), nullable=True),
        sa.Column("project_name", sa.String(255), nullable=True),
        sa.Column("model_name", sa.String(255), nullable=True),
        sa.Column("pro_desc", sa.Text(), nullable=True),
        sa.Column("func_name", sa.String(255), nullable=True),
        sa.Column("pro_type", sa.String(64), nullable=True),
        sa.Column("is_urgent", sa.String(8), nullable=True),
        sa.Column("find_by", sa.String(128), nullable=True),
        sa.Column("find_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pro_answer", sa.Text(), nullable=True),
        sa.Column("work_type", sa.String(64), nullable=True),
        sa.Column("duty_user_id", sa.String(64), nullable=True),
        sa.Column("duty_user_name", sa.String(128), nullable=True),
        sa.Column("plan_start_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("plan_end_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("audit_user_id", sa.String(64), nullable=True),
        sa.Column("audit_user_name", sa.String(128), nullable=True),
        sa.Column("audit_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("change_reason", sa.Text(), nullable=True),
        sa.Column("status", sa.String(8), nullable=False, server_default="1"),
        sa.Column("work_load", sa.String(64), nullable=True),
        sa.Column("is_delay_plan", sa.String(8), nullable=True),
        sa.Column("now_node", sa.Integer(), nullable=True),
        sa.Column("now_handle_user", sa.String(255), nullable=True),
        sa.Column("now_handle_user_name", sa.String(255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_ppm_problem_change_resource", "ppm_problem_change", ["resource_id"])
    op.create_index("ix_ppm_problem_change_status", "ppm_problem_change", ["status"])

    # --- ppm_problem_list_process_task ---
    op.create_table(
        "ppm_problem_list_process_task",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("business_id", sa.String(64), nullable=False),
        sa.Column("node_key", sa.String(32), nullable=True),
        sa.Column("node_name", sa.String(64), nullable=True),
        sa.Column("now_handle_user", sa.String(255), nullable=True),
        sa.Column("now_handle_user_name", sa.String(255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_ppm_problem_list_proc_task_biz",
        "ppm_problem_list_process_task",
        ["business_id", "node_key"],
    )

    # --- ppm_problem_list_process_log ---
    op.create_table(
        "ppm_problem_list_process_log",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("business_id", sa.String(64), nullable=False),
        sa.Column("node_key", sa.String(32), nullable=True),
        sa.Column("handle_user_id", sa.String(64), nullable=True),
        sa.Column("handle_user_name", sa.String(128), nullable=True),
        sa.Column("handle_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("handle_info", sa.Text(), nullable=True),
        sa.Column("next_user_id", sa.String(255), nullable=True),
        sa.Column("next_user_name", sa.String(255), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_ppm_problem_list_proc_log_biz",
        "ppm_problem_list_process_log",
        ["business_id", "node_key"],
    )

    # --- ppm_problem_change_process_task ---
    op.create_table(
        "ppm_problem_change_process_task",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("business_id", sa.String(64), nullable=False),
        sa.Column("node_key", sa.String(32), nullable=True),
        sa.Column("node_name", sa.String(64), nullable=True),
        sa.Column("now_handle_user", sa.String(255), nullable=True),
        sa.Column("now_handle_user_name", sa.String(255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_ppm_problem_change_proc_task_biz",
        "ppm_problem_change_process_task",
        ["business_id", "node_key"],
    )

    # --- ppm_problem_change_process_log ---
    op.create_table(
        "ppm_problem_change_process_log",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("business_id", sa.String(64), nullable=False),
        sa.Column("node_key", sa.String(32), nullable=True),
        sa.Column("handle_user_id", sa.String(64), nullable=True),
        sa.Column("handle_user_name", sa.String(128), nullable=True),
        sa.Column("handle_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("handle_info", sa.Text(), nullable=True),
        sa.Column("next_user_id", sa.String(255), nullable=True),
        sa.Column("next_user_name", sa.String(255), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_ppm_problem_change_proc_log_biz",
        "ppm_problem_change_process_log",
        ["business_id", "node_key"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_ppm_problem_change_proc_log_biz",
        table_name="ppm_problem_change_process_log",
    )
    op.drop_table("ppm_problem_change_process_log")
    op.drop_index(
        "ix_ppm_problem_change_proc_task_biz",
        table_name="ppm_problem_change_process_task",
    )
    op.drop_table("ppm_problem_change_process_task")
    op.drop_index(
        "ix_ppm_problem_list_proc_log_biz",
        table_name="ppm_problem_list_process_log",
    )
    op.drop_table("ppm_problem_list_process_log")
    op.drop_index(
        "ix_ppm_problem_list_proc_task_biz",
        table_name="ppm_problem_list_process_task",
    )
    op.drop_table("ppm_problem_list_process_task")
    op.drop_index("ix_ppm_problem_change_status", table_name="ppm_problem_change")
    op.drop_index("ix_ppm_problem_change_resource", table_name="ppm_problem_change")
    op.drop_table("ppm_problem_change")
    op.drop_index("ix_ppm_problem_list_now_node", table_name="ppm_problem_list")
    op.drop_index("ix_ppm_problem_list_status", table_name="ppm_problem_list")
    op.drop_index("ix_ppm_problem_list_project", table_name="ppm_problem_list")
    op.drop_table("ppm_problem_list")
