"""spec_file_manifest.landing_version 印章列 + 增量过滤索引

Revision ID: 20261021130000
Revises: 20261021120000
Create Date: 2026-10-21 13:00:00

Change 2026-10-21-spec-manifest-incremental task-01（FR-03 / FR-05）：
GET /api/changes/-/spec-manifest?since=<spec_version> 增量游标的存储面——

- 加列 ``landing_version INTEGER NULL``：行最后写入时的工作区 spec_version
  印章，写点盖章逻辑见 spec_workspace/service.py 三处（apply_ops /
  _write_spec_root 对齐 / soft_delete_change_dir）。
- **存量行不回填**：NULL 语义即正确（NULL 行永不进增量流，只经全量清单
  出场；首次落地触碰后自然进入增量流）——省去 1.3 万行 UPDATE 且无正确性
  损失。
- 加复合索引 ``ix_spec_manifest_ws_landing (workspace_id, landing_version)``
  支撑增量过滤查询；单 worker 线上小表（万级行）普通 CREATE INDEX 秒级，
  不需要 CONCURRENTLY（deploy 通道 alembic upgrade 串行执行）。
- downgrade 对称：删索引 + 删列。

author: qinyi
created_at: 2026-10-21 13:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261021130000"
down_revision: str | None = "20261021120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "spec_file_manifest"
_COLUMN = "landing_version"
_INDEX = "ix_spec_manifest_ws_landing"


def upgrade() -> None:
    op.add_column(_TABLE, sa.Column(_COLUMN, sa.Integer(), nullable=True))
    op.create_index(_INDEX, _TABLE, ["workspace_id", _COLUMN])


def downgrade() -> None:
    op.drop_index(_INDEX, table_name=_TABLE)
    op.drop_column(_TABLE, _COLUMN)
