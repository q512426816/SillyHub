"""create ppm project subdomain tables

Revision ID: 202607200900
Revises: 202607041000
Create Date: 2026-07-20 09:00:00.000000

pm 项目管理子域 4 张表 (change 2026-06-20-ppm-module-migration task-03 /
design §8):
- ppm_project_maintenance    项目维护
- ppm_customer_maintenance   客户维护
- ppm_project_member         项目成员 (user_id FK→users.id)
- ppm_project_stakeholder    项目干系人 (pm_project_id FK→ppm_project_maintenance.id)

平台级:无 workspace_id (D-001@v1)。字段对齐源 DO (ProjectMaintenanceDO /
CustomerMaintenanceDO / ProjectMemberDO / ProjectStakeholderDO),Java 驼峰
转蛇形;源 Long 主键 → UUID 主键;源 String userId → UUID FK。

downgrade 反序 drop。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202607200900"
down_revision: str | None = "202607041000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- ppm_project_maintenance ---
    op.create_table(
        "ppm_project_maintenance",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("create_name", sa.String(100), nullable=True),
        sa.Column("company_name", sa.String(255), nullable=True),
        sa.Column("project_name", sa.String(255), nullable=True),
        sa.Column("project_code", sa.String(100), nullable=False),
        sa.Column("project_status", sa.String(50), nullable=True),
        sa.Column("project_type", sa.String(50), nullable=True),
        sa.Column("project_effective_start_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("project_effective_end_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("project_maintenance_end_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("updated_by", sa.Uuid(as_uuid=True), nullable=True),
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
        "ix_ppm_project_maintenance_status",
        "ppm_project_maintenance",
        ["project_status"],
    )
    op.create_index(
        "ux_ppm_project_maintenance_code",
        "ppm_project_maintenance",
        ["project_code"],
        unique=True,
    )

    # --- ppm_customer_maintenance ---
    op.create_table(
        "ppm_customer_maintenance",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("create_name", sa.String(100), nullable=True),
        sa.Column("company_name", sa.String(255), nullable=True),
        sa.Column("contact", sa.String(100), nullable=True),
        sa.Column("phone_no", sa.String(50), nullable=True),
        sa.Column("dept_name", sa.String(150), nullable=True),
        sa.Column("level", sa.String(50), nullable=True),
        sa.Column("created_by", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("updated_by", sa.Uuid(as_uuid=True), nullable=True),
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
        "ix_ppm_customer_maintenance_level",
        "ppm_customer_maintenance",
        ["level"],
    )

    # --- ppm_project_member ---
    op.create_table(
        "ppm_project_member",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("create_name", sa.String(100), nullable=True),
        sa.Column(
            "pm_project_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("ppm_project_maintenance.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_name", sa.String(100), nullable=True),
        sa.Column("depart_id", sa.String(64), nullable=True),
        sa.Column("phone", sa.String(50), nullable=True),
        sa.Column("role_id", sa.String(64), nullable=True),
        sa.Column("role_name", sa.String(100), nullable=True),
        sa.Column("depart_name", sa.String(150), nullable=True),
        sa.Column("created_by", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("updated_by", sa.Uuid(as_uuid=True), nullable=True),
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
        "ix_ppm_project_member_project",
        "ppm_project_member",
        ["pm_project_id"],
    )
    op.create_index(
        "ux_ppm_project_member_project_user",
        "ppm_project_member",
        ["pm_project_id", "user_id"],
        unique=True,
    )

    # --- ppm_project_stakeholder ---
    op.create_table(
        "ppm_project_stakeholder",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("stakeholder", sa.String(100), nullable=True),
        sa.Column("stakeholder_role", sa.String(100), nullable=True),
        sa.Column("phone", sa.String(50), nullable=True),
        sa.Column(
            "pm_project_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("ppm_project_maintenance.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("create_name", sa.String(100), nullable=True),
        sa.Column("created_by", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("updated_by", sa.Uuid(as_uuid=True), nullable=True),
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
        "ix_ppm_project_stakeholder_project",
        "ppm_project_stakeholder",
        ["pm_project_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_ppm_project_stakeholder_project", table_name="ppm_project_stakeholder")
    op.drop_table("ppm_project_stakeholder")

    op.drop_index("ux_ppm_project_member_project_user", table_name="ppm_project_member")
    op.drop_index("ix_ppm_project_member_project", table_name="ppm_project_member")
    op.drop_table("ppm_project_member")

    op.drop_index("ix_ppm_customer_maintenance_level", table_name="ppm_customer_maintenance")
    op.drop_table("ppm_customer_maintenance")

    op.drop_index("ux_ppm_project_maintenance_code", table_name="ppm_project_maintenance")
    op.drop_index("ix_ppm_project_maintenance_status", table_name="ppm_project_maintenance")
    op.drop_table("ppm_project_maintenance")
