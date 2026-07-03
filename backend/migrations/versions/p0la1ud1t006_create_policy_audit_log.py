"""create policy_audit_log table

Daemon filesystem-policy audit trail (D-006@v1). Daemon 侧 PolicyEngine 对每次
canWrite/canCreate/canDelete/canRename（D-008：canRead 不记）落一条审计，
批量回传 backend 后落入此表，供前端「写行为审计」页分页检索。

- ``runtime_id`` 真实 FK → daemon_runtimes.id（ondelete=CASCADE，随 runtime 物理删）
- ``workspace_id`` 从 runtime 反查写入（便于按 workspace 维度筛，design §7.4）
- ``id`` / FK 列一律 Uuid，与 DaemonRuntime / DaemonTaskLease 等现有风格一致
- 索引：(runtime_id, created_at DESC) 审计页热路径 + decision + workspace_id

Revision ID: p0la1ud1t006
Revises: 202607011300

Note: revision id 用字母助记而非日期型，因 ``202607020900`` 已被
``add_agent_run_model_fields`` 占用（design §6 建议的 ``20260702*`` 命名冲突）。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "p0la1ud1t006"
down_revision = "202607011300"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "policy_audit_log",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "runtime_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("daemon_runtimes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("decision", sa.String(16), nullable=False),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("tool", sa.String(128), nullable=False),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    # 审计页热路径：WHERE runtime_id=? ORDER BY created_at DESC
    op.create_index(
        "idx_policy_audit_log_runtime_created",
        "policy_audit_log",
        ["runtime_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "idx_policy_audit_log_decision",
        "policy_audit_log",
        ["decision"],
    )
    op.create_index(
        "idx_policy_audit_log_workspace_id",
        "policy_audit_log",
        ["workspace_id"],
    )


def downgrade() -> None:
    op.drop_index("idx_policy_audit_log_workspace_id", table_name="policy_audit_log")
    op.drop_index("idx_policy_audit_log_decision", table_name="policy_audit_log")
    op.drop_index("idx_policy_audit_log_runtime_created", table_name="policy_audit_log")
    op.drop_table("policy_audit_log")
