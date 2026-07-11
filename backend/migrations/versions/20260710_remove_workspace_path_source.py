"""20260710_rm_path_source

Revision ID: 20260710_rm_path_source
Revises: 7c77e09b84e1
Create Date: 2026-07-11 00:05:00.000000

移除 server-local 工作区模式连带的 ``workspaces.path_source`` +
``workspaces.daemon_runtime_id`` 两列，并显式清理非 CASCADE 的
``incidents`` 外键引用行（R-02 守卫）。

变更 change ``2026-07-10-remove-server-local-workspace-mode`` design §5
Phase 3 + §8 数据模型 + 决策 D-004（标准迁移保链）/ D-006（存量数据
删除）/ D-007 P0-3（FK 全表清理修正）。

upgrade() 三步法（顺序严格）：

1. ``DELETE FROM incidents WHERE workspace_id IN (SELECT id FROM
   workspaces WHERE path_source='server-local')`` ——
   ``incident/workspace_id`` FK 无 ``ondelete`` 子句
   (``incident/model.py:19`` ``ForeignKey("workspaces.id")``)，PG 默认
   RESTRICT/NO ACTION，若跳过则下一步 DELETE workspace 被 PG 拦截抛 FK
   违约（R-02 关键守卫）。
2. ``DELETE FROM workspaces WHERE path_source='server-local'`` —— design
   §5 Phase 3 约 15+ 张 ``ondelete=CASCADE`` 外键表（auth/release/
   git_gateway/change/daemon_audit/worktree/scan_docs/spec_workspace/
   spec_profile/tool_gateway/tool_policy/task/daemon/workspace 自表/
   member_runtimes/agent_runs M:N 等）由 PG 自动连带删除，迁移不逐一
   显式 DELETE。``workflow`` / 旧 ``agent_runs`` SET NULL 表本身不阻断
   DELETE（PG 自动把 workspace_id 置 NULL），相关行保留为
   workspace_id=NULL 属预期，不显式删。
3. ``drop_column workspaces.daemon_runtime_id`` + ``drop_column
   workspaces.path_source`` —— PG 下 DROP COLUMN 自动级联删
   ``ix_workspaces_daemon_runtime_id`` 索引（model.py:35），无需显式
   ``drop_index``。

downgrade() 仅形式对称：项目未正式上线（CLAUDE.md 规则 10 / design §9），
不回填已 DELETE 的 server-local 工作区行 + CASCADE 连带数据（物理已丢）。

author: qinyi
created_at: 2026-07-11 00:05:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260710_rm_path_source"
down_revision: str | None = "7c77e09b84e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()

    # 1. 显式 DELETE 非 CASCADE 外键表（incidents RESTRICT 守卫，R-02）
    bind.execute(
        sa.text(
            "DELETE FROM incidents WHERE workspace_id IN "
            "(SELECT id FROM workspaces WHERE path_source = 'server-local')"
        )
    )

    # 2. DELETE server-local 工作区行（CASCADE 外键表由 PG 自动连带，design §5 Phase 3）
    bind.execute(sa.text("DELETE FROM workspaces WHERE path_source = 'server-local'"))

    # 3. DROP 两列（PG 自动级联删 ix_workspaces_daemon_runtime_id 索引）
    op.drop_column("workspaces", "daemon_runtime_id")
    op.drop_column("workspaces", "path_source")


def downgrade() -> None:
    op.add_column(
        "workspaces",
        sa.Column(
            "path_source",
            sa.String(length=20),
            nullable=False,
            server_default="server-local",
        ),
    )
    op.add_column(
        "workspaces",
        sa.Column("daemon_runtime_id", sa.Uuid(as_uuid=True), nullable=True),
    )
    op.create_index(
        "ix_workspaces_daemon_runtime_id",
        "workspaces",
        ["daemon_runtime_id"],
    )
