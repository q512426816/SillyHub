"""create ppm plan subdomain tables (7 tables)

task-04 / change 2026-06-20-ppm-module-migration design §8。

7 张平台级表:
- ppm_plan_node                计划节点模板
- ppm_plan_node_detail         模板明细
- ppm_plan_node_module         模块
- ppm_ps_project_plan          ps 项目计划
- ppm_ps_plan_node             ps 里程碑
- ppm_ps_plan_node_detail      ps 里程碑明细 (核心简化表 + parent_id 版本链 + status)
- ppm_ps_plan_node_detail_process  流程履历

关键简化 (D-002@v1):ppm_ps_plan_node_detail 弃源 silly 的
_ps_plan_node_detail_node / _ps_plan_node_detail_variable 两表,
改为单表 + parent_id 版本链 + status 状态机。

Revision ID: 202607042000
Revises: 202607041000
Create Date: 2026-07-04 20:00:00.000000
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "202607042000"
down_revision: str | None = "202607041000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_UUID = "gen_random_uuid()"
_NOW = "now()"
_JSONB_DEFAULT = sa.text("'[]'::jsonb")


def _id_col() -> sa.Column:
    return sa.Column(
        "id",
        postgresql.UUID(as_uuid=True),
        nullable=False,
        server_default=sa.text(_UUID),
    )


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text(_NOW),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text(_NOW),
        ),
    ]


def upgrade() -> None:
    # ── 模板簇 ────────────────────────────────────────────────────────────
    op.create_table(
        "ppm_plan_node",
        _id_col(),
        sa.Column("overall_stage", sa.String(length=64), nullable=False),
        sa.Column("project_type", sa.String(length=64), nullable=True),
        sa.Column("no", sa.Integer(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "ppm_plan_node_detail",
        _id_col(),
        sa.Column("plan_node_id", sa.String(length=64), nullable=False),
        sa.Column("detailed_stage", sa.String(length=64), nullable=True),
        sa.Column("no", sa.String(length=32), nullable=True),
        sa.Column("task_theme", sa.String(length=255), nullable=True),
        sa.Column("task_description", sa.Text(), nullable=True),
        sa.Column("requirements", sa.Text(), nullable=True),
        sa.Column("role_name", sa.String(length=128), nullable=True),
        sa.Column("achievement", sa.Text(), nullable=True),
        sa.Column("overall_stage", sa.String(length=64), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_ppm_plan_node_detail_node",
        "ppm_plan_node_detail",
        ["plan_node_id", "no"],
    )

    op.create_table(
        "ppm_plan_node_module",
        _id_col(),
        sa.Column("plan_node_id", sa.String(length=64), nullable=False),
        sa.Column("module_name", sa.String(length=255), nullable=True),
        sa.Column("plan_workload", sa.String(length=64), nullable=True),
        sa.Column("plan_begin_time", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("plan_complete_time", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("duty_user_id", sa.String(length=64), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_ppm_plan_node_module_node",
        "ppm_plan_node_module",
        ["plan_node_id"],
    )

    # ── ps 计划簇 ─────────────────────────────────────────────────────────
    op.create_table(
        "ppm_ps_project_plan",
        _id_col(),
        sa.Column("project_id", sa.String(length=64), nullable=False),
        sa.Column("project_name", sa.String(length=255), nullable=True),
        sa.Column("project_manager_id", sa.String(length=64), nullable=True),
        sa.Column("project_manager_name", sa.String(length=128), nullable=True),
        sa.Column("project_start_time", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("project_plan_end_time", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("contract_sign_time", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("contract_name", sa.String(length=255), nullable=True),
        sa.Column("contract_amount", sa.String(length=64), nullable=True),
        sa.Column("profit_margin", sa.String(length=64), nullable=True),
        sa.Column("profit_amount", sa.String(length=64), nullable=True),
        sa.Column("module", sa.Text(), nullable=True),
        sa.Column("budget_amount", sa.String(length=64), nullable=True),
        sa.Column("budget_person_days", sa.String(length=64), nullable=True),
        sa.Column("actual_consumption_person_days", sa.String(length=64), nullable=True),
        sa.Column("remaining_available_person_days", sa.String(length=64), nullable=True),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="draft",
        ),
        sa.Column("adjustment_person_days", sa.String(length=64), nullable=True),
        sa.Column("total_cost", sa.String(length=64), nullable=True),
        sa.Column("labor_cost", sa.String(length=64), nullable=True),
        sa.Column("remaining_cost", sa.String(length=64), nullable=True),
        sa.Column("cost_adjustment", sa.String(length=64), nullable=True),
        sa.Column("company_name", sa.String(length=255), nullable=True),
        sa.Column("create_name", sa.String(length=128), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ppm_ps_project_plan_project", "ppm_ps_project_plan", ["project_id"])
    op.create_index("ix_ppm_ps_project_plan_status", "ppm_ps_project_plan", ["status"])

    op.create_table(
        "ppm_ps_plan_node",
        _id_col(),
        sa.Column("overall_stage", sa.String(length=64), nullable=True),
        sa.Column("no", sa.String(length=32), nullable=True),
        sa.Column("ps_project_plan_id", sa.String(length=64), nullable=False),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="draft",
        ),
        sa.Column("task_theme", sa.String(length=255), nullable=True),
        sa.Column("plan_workload", sa.String(length=64), nullable=True),
        sa.Column("plan_begin_time", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("plan_complete_time", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("duty_user_id", sa.String(length=64), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ppm_ps_plan_node_plan", "ppm_ps_plan_node", ["ps_project_plan_id"])

    # 核心表:里程碑明细 + parent_id 版本链 + status 状态机
    op.create_table(
        "ppm_ps_plan_node_detail",
        _id_col(),
        sa.Column("plan_node_id", sa.String(length=64), nullable=False),
        sa.Column("detailed_stage", sa.String(length=64), nullable=True),
        sa.Column("task_theme", sa.String(length=255), nullable=True),
        sa.Column("task_description", sa.Text(), nullable=True),
        sa.Column("requirements", sa.Text(), nullable=True),
        sa.Column("role_name", sa.String(length=128), nullable=True),
        sa.Column("achievement", sa.Text(), nullable=True),
        sa.Column("overall_stage", sa.String(length=64), nullable=True),
        sa.Column("plan_workload", sa.String(length=64), nullable=True),
        sa.Column("plan_begin_time", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("plan_complete_time", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("actual_begin_time", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("actual_complete_time", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("no", sa.String(length=32), nullable=True),
        sa.Column("execute_user_id", sa.String(length=64), nullable=True),
        sa.Column("module_id", sa.String(length=64), nullable=True),
        sa.Column("attach_group_id", sa.String(length=128), nullable=True),
        sa.Column(
            "file_urls",
            postgresql.JSONB(),
            nullable=False,
            server_default=_JSONB_DEFAULT,
        ),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="draft",
        ),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("audit_user_id", sa.String(length=64), nullable=True),
        sa.Column("audit_user_name", sa.String(length=128), nullable=True),
        sa.Column("approve_user_id", sa.String(length=64), nullable=True),
        sa.Column("approve_user_name", sa.String(length=128), nullable=True),
        sa.Column("change_reason", sa.Text(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["parent_id"], ["ppm_ps_plan_node_detail.id"], ondelete="SET NULL"),
    )
    op.create_index(
        "ix_ppm_ps_plan_node_detail_node",
        "ppm_ps_plan_node_detail",
        ["plan_node_id"],
    )
    op.create_index(
        "ix_ppm_ps_plan_node_detail_status",
        "ppm_ps_plan_node_detail",
        ["status"],
    )
    op.create_index(
        "ix_ppm_ps_plan_node_detail_parent",
        "ppm_ps_plan_node_detail",
        ["parent_id"],
    )

    op.create_table(
        "ppm_ps_plan_node_detail_process",
        _id_col(),
        sa.Column("business_id", sa.String(length=64), nullable=False),
        sa.Column("business_type", sa.String(length=64), nullable=False),
        sa.Column("node_key", sa.String(length=64), nullable=True),
        sa.Column("handle_user_id", sa.String(length=64), nullable=True),
        sa.Column("handle_user_name", sa.String(length=128), nullable=True),
        sa.Column("handle_date", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("handle_info", sa.Text(), nullable=True),
        sa.Column("next_user_id", sa.String(length=64), nullable=True),
        sa.Column("next_user_name", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text(_NOW),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_ppm_ps_plan_node_detail_proc_biz",
        "ppm_ps_plan_node_detail_process",
        ["business_id", "business_type"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_ppm_ps_plan_node_detail_proc_biz",
        table_name="ppm_ps_plan_node_detail_process",
    )
    op.drop_table("ppm_ps_plan_node_detail_process")
    op.drop_index("ix_ppm_ps_plan_node_detail_parent", table_name="ppm_ps_plan_node_detail")
    op.drop_index("ix_ppm_ps_plan_node_detail_status", table_name="ppm_ps_plan_node_detail")
    op.drop_index("ix_ppm_ps_plan_node_detail_node", table_name="ppm_ps_plan_node_detail")
    op.drop_table("ppm_ps_plan_node_detail")
    op.drop_index("ix_ppm_ps_plan_node_plan", table_name="ppm_ps_plan_node")
    op.drop_table("ppm_ps_plan_node")
    op.drop_index("ix_ppm_ps_project_plan_status", table_name="ppm_ps_project_plan")
    op.drop_index("ix_ppm_ps_project_plan_project", table_name="ppm_ps_project_plan")
    op.drop_table("ppm_ps_project_plan")
    op.drop_index("ix_ppm_plan_node_module_node", table_name="ppm_plan_node_module")
    op.drop_table("ppm_plan_node_module")
    op.drop_index("ix_ppm_plan_node_detail_node", table_name="ppm_plan_node_detail")
    op.drop_table("ppm_plan_node_detail")
    op.drop_table("ppm_plan_node")
