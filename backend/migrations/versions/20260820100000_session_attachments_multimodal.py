"""session_attachments table + llm_providers.multimodal column

Revision ID: 20260820100000
Revises: 20260819100000
Create Date: 2026-08-20 10:00:00

Change 2026-08-20-session-multimodal-attachments task-01（design §4 / FR-1 / FR-3）：
1. 新建 session_attachments 表（会话附件元数据，对象本体在 MinIO 内容寻址）；
2. llm_providers 加 multimodal 三态列（auto/true/false，D-9 手动覆盖权威来源）。

约束（design §4 / §10 / D-5 / D-8 / D-9）：
- session_id 可空（NULL = 草稿未发送，不加非空约束，发送时回填）；
- FK SET NULL：会话硬删时附件行保留（D-8 生命周期独立于会话删除）；
- object_key 不 unique：同 sha256 复用对象，多行共享同一键（D-5）；
- 索引：(user_id, session_id) 归属+会话查询、(session_id) 历史回显；
- multimodal server_default='auto'：加列即把既有行回填 auto（启发式推断，零回归）。

列定义与 app/modules/session_attachment/model.py、
app/modules/llm_provider/model.py 逐字对齐（防漂移）；不 import app 模块。

downgrade：drop 列 + drop 表（未上线无存量数据迁移）。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "20260820100000"
down_revision: str | None = "20260819100000"
branch_labels: str | list[str] | None = None
depends_on: str | list[str] | None = None


def upgrade() -> None:
    op.create_table(
        "session_attachments",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # NULL = 草稿未发送（design §10）；SET NULL 保附件行（D-8）。
        sa.Column(
            "session_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("agent_sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("media_type", sa.String(128), nullable=False),
        sa.Column("bytes", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        # 不 unique：同 sha256 复用对象，多行共享同一键（D-5）。
        sa.Column("object_key", sa.String(255), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_session_attachments_user_session",
        "session_attachments",
        ["user_id", "session_id"],
    )
    op.create_index(
        "ix_session_attachments_session",
        "session_attachments",
        ["session_id"],
    )

    # server_default='auto'：存量行自动回填 auto（D-9 三态默认启发式推断）。
    op.add_column(
        "llm_providers",
        sa.Column(
            "multimodal",
            sa.String(8),
            nullable=False,
            server_default="auto",
        ),
    )


def downgrade() -> None:
    op.drop_column("llm_providers", "multimodal")

    op.drop_index("ix_session_attachments_session", table_name="session_attachments")
    op.drop_index("ix_session_attachments_user_session", table_name="session_attachments")
    op.drop_table("session_attachments")
