"""daemon_borrow_audit audit table

Revision ID: 202607251200
Revises: 202607251100
Create Date: 2026-07-25 12:00:00.000000

Change 2026-07-25-daemon-borrow-for-business task-02 / FR-07 / D-004@v1：
新建 daemon_borrow_audit 审计表，记录业务/管理人员每次借用开发人员 daemon。

D-004 仅审计不限额：usage_summary 暂存 token/turn 数等基础明细（nullable），
额度限额逻辑后续变更再补。

FK ondelete 语义（design §8）：
  - borrower_user_id / lender_user_id → users.id CASCADE
  - workspace_id → workspaces.id CASCADE
  - agent_run_id → agent_runs.id CASCADE
  - daemon_instance_id → daemon_instances.id RESTRICT（审计红线，被引用时
    禁止删 daemon 实例，保留审计链完整）

down_revision 接 202607251100（task-01，alembic heads 实测当前单 head），
单 head 接续避免多 head 分叉（见 migration-chain-fragmentation-pattern 记忆）。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607251200"
down_revision: str | None = "202607251100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "daemon_borrow_audit",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "borrower_user_id",
            sa.Uuid(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "lender_user_id",
            sa.Uuid(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "daemon_instance_id",
            sa.Uuid(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "agent_run_id",
            sa.Uuid(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "borrowed_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column("usage_summary", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(
            ["borrower_user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["lender_user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["daemon_instance_id"],
            ["daemon_instances.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["agent_run_id"],
            ["agent_runs.id"],
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_daemon_borrow_audit_borrower",
        "daemon_borrow_audit",
        ["borrower_user_id"],
    )
    op.create_index(
        "ix_daemon_borrow_audit_lender",
        "daemon_borrow_audit",
        ["lender_user_id"],
    )
    op.create_index(
        "ix_daemon_borrow_audit_daemon",
        "daemon_borrow_audit",
        ["daemon_instance_id"],
    )
    op.create_index(
        "ix_daemon_borrow_audit_workspace",
        "daemon_borrow_audit",
        ["workspace_id"],
    )
    op.create_index(
        "ix_daemon_borrow_audit_run",
        "daemon_borrow_audit",
        ["agent_run_id"],
    )
    op.create_index(
        "ix_daemon_borrow_audit_borrowed_at",
        "daemon_borrow_audit",
        ["borrowed_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_daemon_borrow_audit_borrowed_at", table_name="daemon_borrow_audit")
    op.drop_index("ix_daemon_borrow_audit_run", table_name="daemon_borrow_audit")
    op.drop_index("ix_daemon_borrow_audit_workspace", table_name="daemon_borrow_audit")
    op.drop_index("ix_daemon_borrow_audit_daemon", table_name="daemon_borrow_audit")
    op.drop_index("ix_daemon_borrow_audit_lender", table_name="daemon_borrow_audit")
    op.drop_index("ix_daemon_borrow_audit_borrower", table_name="daemon_borrow_audit")
    op.drop_table("daemon_borrow_audit")
