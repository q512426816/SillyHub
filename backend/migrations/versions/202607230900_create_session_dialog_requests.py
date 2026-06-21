"""create session_dialog_requests table

Extension of the daemon permission protocol to support AskUserQuestion-style
dialogs in addition to plain canUseTool approvals.

Why a new table:
- Ordinary canUseTool approvals are ephemeral — in-memory ``_permission_timers``
  + a 5min auto-deny enforcer are the source of truth, and the daemon-side
  fallback timer fail-closes. No DB row needed.
- AskUserQuestion-style requests, in contrast, may wait *indefinitely* for a
  human answer and must survive a frontend page refresh. They are therefore
  persisted here, keyed by the daemon-generated ``request_id`` (unique), and
  lifecycle-tracked via ``status`` (pending → answered | cancelled).

Schema mirrors ``PermissionRequestPayload`` (dialog_kind / dialog_payload) and
``PermissionResponsePayload`` (dialog_result → ``answer``). ``session_id`` and
``run_id`` are real FKs so a deleted session/run cascades; ``answered_by`` is
SET NULL on user delete (audit value).

Revision ID: 202607230900
Revises: 202607220900
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202607230900"
down_revision = "202607220900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "session_dialog_requests",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "session_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "run_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("request_id", sa.String(128), nullable=False, unique=True),
        sa.Column("tool_name", sa.String(128), nullable=False),
        sa.Column("dialog_kind", sa.String(64), nullable=True),
        sa.Column("dialog_payload", sa.JSON, nullable=True),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("answer", sa.JSON, nullable=True),
        sa.Column(
            "answered_by",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("answered_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "idx_session_dialog_requests_session_id",
        "session_dialog_requests",
        ["session_id"],
    )
    op.create_index(
        "idx_session_dialog_requests_run_id",
        "session_dialog_requests",
        ["run_id"],
    )
    op.create_index(
        "idx_session_dialog_requests_status",
        "session_dialog_requests",
        ["status"],
    )


def downgrade() -> None:
    op.drop_index("idx_session_dialog_requests_status", table_name="session_dialog_requests")
    op.drop_index("idx_session_dialog_requests_run_id", table_name="session_dialog_requests")
    op.drop_index("idx_session_dialog_requests_session_id", table_name="session_dialog_requests")
    op.drop_table("session_dialog_requests")
