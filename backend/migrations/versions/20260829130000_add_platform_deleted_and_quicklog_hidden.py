"""spec_file_manifest +platform_deleted / quicklog_entries +hidden

Revision ID: 20260829130000
Revises: 4766d997cf09
Create Date: 2026-08-29 13:00:00

Change 2026-08-29-change-delete-closure-and-spec-pull task-01（design §9 数据模型 /
§5.4 防复活标记 / §5.3 quicklog 对账，FR-04 / FR-03b / D-006@v1）：

1. ``spec_file_manifest`` ADD ``platform_deleted`` BOOLEAN NOT NULL DEFAULT FALSE
   —— 平台删除墓碑。变更中心删除入口（task-06）置 TRUE 后，apply_ops add/rename
   复活拦截与 ``_write_spec_root`` 落盘排除（task-02）、``_ensure_change_row``
   manifest 兜底锚点（task-04）均以此列为数据基础。与既有 ``exists``（增量协议
   软删标记，daemon/CLI 对账可置回）语义分离：platform_deleted 只由平台删除动作
   置位。本迁移只铺数据基础，使用方逻辑不在本 task。
2. ``quicklog_entries`` ADD ``hidden`` BOOLEAN NOT NULL DEFAULT FALSE
   —— quicklog 文件对账软隐藏（design §5.3）：apply_ops 落 quicklog 文件后重解析
   ``quicklog/`` 目录，ql_id 不在文件集合中的 pushed 行置 TRUE（读侧 merge 过滤
   在 task-05）。隐藏不硬删，保留推送留底可回滚。

无数据回填：存量行默认 FALSE 即目标态（两列全 FALSE 时行为与现状一致，零语义
变化）。不加索引（低基数布尔列）、不动其它表（task constraints）。

down_revision 接执行时唯一 head ``4766d997cf09``（alembic heads 实测单头），
单 revision 不分叉不 merge（R-05「并行变更撞多 head」已知坑）。

downgrade 对称 drop 两列。

author: qinyi
created_at: 2026-08-29 13:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260829130000"
down_revision: str | None = "4766d997cf09"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "spec_file_manifest",
        sa.Column(
            "platform_deleted",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "quicklog_entries",
        sa.Column(
            "hidden",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("quicklog_entries", "hidden")
    op.drop_column("spec_file_manifest", "platform_deleted")
