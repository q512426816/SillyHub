"""repair archive-tombstone victims (deleted→archive)

Revision ID: 20260923090000
Revises: 20260923040000
Create Date: 2026-09-23 09:00:00

archive-tombstone 坑一次性数据修复（docs/sillyspec/archive-tombstone-归档墓碑致
面板已归档变更软删不可见.md，2026-09-23-change-events-channel 部署验收发现）：

CLI 墓碑机制（sillyspec sync.js _applyTombstoneStatus，2026-08-29 引入）曾把
归档链（unregisterChange，DB status='archived'）的墓碑载荷一律写成
status='deleted'——平台 _apply_cli_tombstone 见值即置 location='deleted' 并
镜像软删收敛，归档变更在面板「已归档」tab 隐身。CLI 侧已修复为终态透传
（archived 链发 'archived'，2026-09-23 sillyspec 仓提交）；本迁移回翻存量冤案行。

判据（实证安全）：location='deleted' AND current_stage IN ('archive','archived')。
两仓本地进度库实证（2026-09-23 查）：真删除（change-delete 命令）历史仅 3 例，
全部停在 brainstorm/scan 期——无一例从 archive 阶段删除，本判据零误伤；
'archived' 拼写覆盖 _sync_change_stage_status P1 前后两代终态值。

镜像文件（soft_delete_change_dir 移入 30 天备份区）不在本迁移恢复——由源仓
CLI 下次 spec-sync / `sillyspec platform sync-docs --change <名>` 上行自愈重传，
备份区兜底窗口 30 天。行回翻后 _change_key_deleted 拒收锚点同步解除（进度
上行不再 409）。

downgrade：no-op——回翻是把行恢复到 CLI 本地库的真实语义（status='archived'），
反向操作会把冤案重新隐身且无法区分真删除，无意义。

author: qinyi
created_at: 2026-09-23 09:00:00
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

# 模块级常量供迁移测试直接执行断言语义（先例：test_changes_location_check_migration.py
# 的结构断言 + 本仓「迁移可测」惯例——数据迁移把判据 SQL 提为可导入单点）。
REPAIR_SQL = (
    "UPDATE changes SET location = 'archive' "
    "WHERE location = 'deleted' AND current_stage IN ('archive', 'archived')"
)

revision: str = "20260923090000"
down_revision: str | None = "20260923040000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(sa.text(REPAIR_SQL))


def downgrade() -> None:
    # 数据修复不可逆（见模块 docstring）
    pass
