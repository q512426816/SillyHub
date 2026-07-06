"""component readonly cleanup

Revision ID: 20260706_component_readonly
Revises: 20260706_rt_ar
Create Date: 2026-07-06

组件只读化数据清理（D-006/D-008@V1，变更 2026-07-06-component-readonly-split）。

1. 硬删 ``workspaces`` 中 ``component_key IS NOT NULL`` 的组件行（36 条存量垃圾）。
   ``workspace_relations`` / ``change_workspaces`` 对 ``workspaces.id`` 均
   ``ondelete=CASCADE``，组件行删除时自动级联清空引用。
2. ``DROP TABLE workspace_relations``（关系层已砍，446 条边 100% 垃圾，D-004@V1）。
3. ``DROP TABLE change_workspaces``（M:N 投影表废弃，权威主存储是
   ``changes.affected_components`` 字符串数组，D-005@V1）。
4. 保留 ``workspaces.component_key`` 列（nullable，值已全空，D-008@V1）——减少改动面。

downgrade 不可逆：组件行 + 关系/投影数据已硬删，本项目允许重置数据（CLAUDE.md 规则10）。
"""

from __future__ import annotations

from alembic import op

revision = "20260706_component_readonly"
down_revision = "20260706_rt_ar"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. 硬删 component workspace 行；FK CASCADE 自动清理 workspace_relations /
    #    change_workspaces 中引用这些行的记录（剩余投影行随表 DROP 一并消失）。
    op.execute("DELETE FROM workspaces WHERE component_key IS NOT NULL")
    # 2. DROP 关系层 + change_workspaces 投影表（D-004/D-005@V1）。
    op.drop_table("workspace_relations")
    op.drop_table("change_workspaces")
    # 3. 保留 workspaces.component_key 列（D-008@V1，nullable，值已全空）。


def downgrade() -> None:
    # 不可逆：component 行 + 关系/投影数据已硬删，无法重建。
    raise NotImplementedError(
        "component_readonly_cleanup is irreversible (data deleted per D-006@V1)"
    )
