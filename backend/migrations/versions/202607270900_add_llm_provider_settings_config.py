"""add settings_config JSON column to llm_providers

Revision ID: 202607270900
Revises: 202607251600
Create Date: 2026-07-27 09:00:00.000000

Change 2026-07-27-llm-provider-fetch-models task-01 / FR-06 / D-004：
为 ``llm_providers`` 表新增 ``settings_config`` JSON 列（nullable），存"高级配置
片段"（attribution / enabledPlugins / env / model / skipDangerousModePermissionPrompt
等），为 task-04 context 透传 / task-05 daemon toEnv / task-10 配置面板提供持久化
落点（D-004 / D-007 / D-009）。

``sa.JSON()`` 跨 SQLite / PG 双方言自动渲染（照 ``202605311700`` 范式，两方言均
渲染 ``ALTER TABLE llm_providers ADD COLUMN settings_config JSON NULL``），无需
显式方言分支。

brownfield 兼容：nullable=True，无 server_default，旧行 ``settings_config`` 为
NULL 视为 None（D-004）。

down_revision 接 ``202607251600``（``alembic heads`` 实测当前单 head），单 head
接续避免多 head 分叉（migration-chain-fragmentation-pattern 记忆）。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607270900"
down_revision: str | None = "202607251600"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "llm_providers",
        sa.Column("settings_config", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("llm_providers", "settings_config")
