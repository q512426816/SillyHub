"""create workspace_linked_repos / paths / sync_states（2026-10-10-workspec-maintenance task-01）

关联仓三表：共享登记 + 成员级本机路径（D-007）+ daemon 双落盘状态（REST 回报 upsert）。
- 唯一约束：``(workspace_id, name)`` / ``(linked_repo_id, user_id)`` /
  ``(linked_repo_id, machine_id, layer)``；machine_id → daemon_instances.id
  （daemon 上报的 daemon_local_id，对齐 machines.py {instance_id}）。
- 级联：paths / sync_states 随 linked_repo 行删除 CASCADE（proposal 成功标准 5）。

Revision ID: 20261010190000
Revises: 20261008100000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261010190000"
down_revision = "20261008100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspace_linked_repos",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "workspace_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("repo_url", sa.String(500), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("rel_path", sa.String(500), nullable=True),
        sa.Column(
            "created_by",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("workspace_id", "name", name="ux_linked_repos_ws_name"),
    )
    op.create_index("ix_linked_repos_workspace", "workspace_linked_repos", ["workspace_id"])

    op.create_table(
        "workspace_linked_repo_paths",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "linked_repo_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspace_linked_repos.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("root_path", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("linked_repo_id", "user_id", name="ux_linked_repo_paths_repo_user"),
    )
    op.create_index("ix_linked_repo_paths_user", "workspace_linked_repo_paths", ["user_id"])

    op.create_table(
        "workspace_linked_repo_sync_states",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "linked_repo_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("workspace_linked_repos.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "machine_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("daemon_instances.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("layer", sa.String(32), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "linked_repo_id", "machine_id", "layer", name="ux_linked_repo_sync_rml"
        ),
    )
    op.create_index(
        "ix_linked_repo_sync_repo", "workspace_linked_repo_sync_states", ["linked_repo_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_linked_repo_sync_repo", table_name="workspace_linked_repo_sync_states")
    op.drop_table("workspace_linked_repo_sync_states")
    op.drop_index("ix_linked_repo_paths_user", table_name="workspace_linked_repo_paths")
    op.drop_table("workspace_linked_repo_paths")
    op.drop_index("ix_linked_repos_workspace", table_name="workspace_linked_repos")
    op.drop_table("workspace_linked_repos")
