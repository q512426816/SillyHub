"""add daemon:borrow permission + business_member role seed

Revision ID: 202607251600
Revises: 202607251500
Create Date: 2026-07-25 13:00:00.000000

Change 2026-07-25-daemon-borrow-for-business task-03 / FR-03 / D-006@v2：
新增 ``daemon:borrow`` 权限点对应的 ``business_member`` 工作空间角色种子
（权限点本身是 ``app.modules.auth.permissions.Permission`` 枚举成员，
permission 字符串落地在此迁移 + role_permissions 表，DB 无独立 permissions 表）。

business_member 权限组合（D-006@v2）：
  - ``task:run_agent``：让业务人员触发现有 agent 端点鉴权通过
    （``agent/router.py:305`` ``require_permission(TASK_RUN_AGENT)``）。因业务人员
    无自有 daemon，placement 必然走借用回退，**不等于** "全量跑自有 agent"。
  - ``daemon:borrow``：借用回退授权（placement._resolve_borrowed_or_own_runtime
    三重校验之一）。
  - ``workspace:read``：工作空间读（成员可见 + 触发端点路径解析）。

**零回归**：本迁移只 INSERT 新角色种子，不改任何现有角色的权限集合，未授予
``business_member`` 的用户行为完全不变（design §9）。

**不改历史迁移 202605280900**：已部署 DB 不会再跑，新角色走独立 INSERT 迁移。
permission 字符串刻意重复（同 202605280900 范式）：迁移须在无 app.* 导入时仍可
生成离线 SQL。

down_revision 接 ``202607251500``（task-02 审计表迁移，alembic heads 实测当前
单 head），单 head 接续避免多 head 分叉（migration-chain-fragmentation-pattern 记忆）。
renumber 见 202607251400 ql-20260726-001-ac8a 说明。

**缓存失效对齐 rbac-permission-cache（R-05）**：本迁移只种角色模板，不向任何用户
授予；``perm:{user_id}:*`` 缓存按用户懒填，迁移时刻无 business_member 的用户缓存
存在。owner 经 ``members_service.add_or_update_member`` / ``update_member_role``
授予时，service 层 commit 后已调 ``invalidate_all_permissions``
（members_service.py），首次借用不会命中旧缓存——故迁移体内无需也不应调 Redis
（迁移是同步部署期动作，Redis 未就绪时反致部署卡死）。

**role_id 解析策略**：照抄 ``202605280900`` 范式——Python 侧 ``uuid.uuid4()``
生成 role_id，两条 ``op.bulk_insert`` 复用同一值（roles.id / role_permissions.role_id）。
blueprint task-03 原写「SELECT id FROM roles WHERE key=…」，但数据依赖型 SELECT
在 ``alembic upgrade --sql`` 离线 SQL 生成（部署预览常用）下 ``op.get_bind()``
为 None 无法执行；Python 复用 uuid 既满足「不猜 / 不硬编码 id」（运行时生成，
非字面量），又跨 online/offline 双模式可移植，且与同库 ``202605280900`` 完全一致。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607251600"
down_revision: str | None = "202607251500"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# ── Seed data ──────────────────────────────────────────────────────────────
#
# ``business_member`` 对齐现有 ``developer`` / ``viewer``：同形存储（roles 表
# + role_permissions），经 members_service.ROLE_KEY_WHITELIST 按工作空间授予。
# Mirrors the SYSTEM_ROLES pattern in 202605280900.

BUSINESS_MEMBER_KEY: str = "business_member"

#: business_member 权限组合（D-006@v2）。常量化便于测试与迁移体引用同源。
BUSINESS_MEMBER_PERMISSIONS: tuple[str, ...] = (
    "task:run_agent",
    "daemon:borrow",
    "workspace:read",
)


def upgrade() -> None:
    # naive UTC:roles.created_at/updated_at 列为 TIMESTAMP WITHOUT TIME ZONE,
    # aware(datetime.now(UTC)) 会被 asyncpg 拒绝(can't subtract offset-naive and offset-aware)。
    # 对齐同库 202605280900 的 datetime.utcnow() 范式(naive UTC),复用已 import 的 UTC 避免 deprecated utcnow。
    now = datetime.now(UTC).replace(tzinfo=None)
    # Python 侧生成 role_id 并在两条 bulk_insert 复用（同 202605280900 范式）。
    # 不用 SELECT id FROM roles：数据依赖型 SELECT 在 alembic offline --sql 模式
    # 下 op.get_bind()=None 无法跑；Python uuid 复用跨 online/offline 双模式可移植。
    role_id = uuid.uuid4()

    roles_table = sa.table(
        "roles",
        sa.column("id", sa.Uuid),
        sa.column("key", sa.String),
        sa.column("name", sa.String),
        sa.column("description", sa.Text),
        sa.column("is_system", sa.Boolean),
        sa.column("is_active", sa.Boolean),
        # sa.TIMESTAMP(timezone=True) 对齐实际列（auth/model.py:72 DateTime(timezone=True)
        # = TIMESTAMPTZ）+ 既有迁移 202605280900 范式。若用 sa.DateTime（naive），
        # bulk_insert 的 INSERT cast 成 TIMESTAMP WITHOUT TIME ZONE，
        # asyncpg 拒绝 tz-aware datetime（can't subtract offset-naive and offset-aware，
        # SQLite 宽松不暴露，PG 才触发）。
        sa.column("created_at", sa.TIMESTAMP(timezone=True)),
        sa.column("updated_at", sa.TIMESTAMP(timezone=True)),
    )
    op.bulk_insert(
        roles_table,
        [
            {
                "id": role_id,
                "key": BUSINESS_MEMBER_KEY,
                "name": "业务成员",
                "description": (
                    "业务/管理人员：可触发 agent 并借用工作空间共享 daemon "
                    "读源码出业务方案（无自有 daemon）。"
                ),
                "is_system": True,
                "is_active": True,
                "created_at": now,
                "updated_at": now,
            }
        ],
    )

    role_perms_table = sa.table(
        "role_permissions",
        sa.column("role_id", sa.Uuid),
        sa.column("permission", sa.String),
    )
    op.bulk_insert(
        role_perms_table,
        [{"role_id": role_id, "permission": perm} for perm in BUSINESS_MEMBER_PERMISSIONS],
    )


def downgrade() -> None:
    # 显式 DELETE 两表——不依赖 role_permissions.role_id → roles.id 的 ON DELETE
    # CASCADE（SQLite 测试建表 / 部分场景可能不带 FK），行为可预期可逆。
    # 用类型化 sa.table 桩，DELETE 同样跨 online/offline 可移植。
    roles_table = sa.table(
        "roles",
        sa.column("id", sa.Uuid),
        sa.column("key", sa.String),
    )
    role_perms_table = sa.table(
        "role_permissions",
        sa.column("role_id", sa.Uuid),
    )
    op.execute(
        role_perms_table.delete().where(
            role_perms_table.c.role_id.in_(
                sa.select(roles_table.c.id).where(roles_table.c.key == BUSINESS_MEMBER_KEY)
            )
        )
    )
    op.execute(roles_table.delete().where(roles_table.c.key == BUSINESS_MEMBER_KEY))
