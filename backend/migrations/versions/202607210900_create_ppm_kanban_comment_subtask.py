"""create ppm_kanban_comment + ppm_kanban_subtask (D-011)

task-01 / change 2026-06-21-ppm-full-alignment design §8。

两张平台级新表(源无独立表,为对齐源看板 TaskDetailDrawer 的评论/子任务/
附件功能新建):
- ppm_kanban_comment   任务评论(task_id 软关联 ppm_plan_task.id)
- ppm_kanban_subtask   任务子任务勾选(task_id 软关联 ppm_plan_task.id)

平台级:无 workspace_id (D-001@v1)。UUID 主键;file_urls 复用
PlanTask.file_urls JSON,不在此 migration 涉及。

down_revision = 1e69522e288c (当前 head,orchestration + ppm merge)。
downgrade 反序 drop。

Revision ID: 202607210900
Revises: 1e69522e288c
Create Date: 2026-07-21 09:00:00.000000
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607210900"
down_revision: str | None = "1e69522e288c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- ppm_kanban_comment ---
    op.create_table(
        "ppm_kanban_comment",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("task_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("user_name", sa.String(100), nullable=True),
        sa.Column("content", sa.String(2000), nullable=False),
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
    op.create_index("ix_ppm_kanban_comment_task", "ppm_kanban_comment", ["task_id"])

    # --- ppm_kanban_subtask ---
    op.create_table(
        "ppm_kanban_subtask",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("task_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column(
            "done",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "sort_order",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
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
    op.create_index("ix_ppm_kanban_subtask_task", "ppm_kanban_subtask", ["task_id"])


def downgrade() -> None:
    op.drop_index("ix_ppm_kanban_subtask_task", table_name="ppm_kanban_subtask")
    op.drop_table("ppm_kanban_subtask")
    op.drop_index("ix_ppm_kanban_comment_task", table_name="ppm_kanban_comment")
    op.drop_table("ppm_kanban_comment")
