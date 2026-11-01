"""business_member 补 change:read 权限

Revision ID: 20261030160000
Revises: 20261023090100
Create Date: 2026-10-30

``business_member`` 是 ``is_system=true`` 的系统内置角色，管理后台
``roles_service.update`` 明确抛 ``RoleSystemProtected``（系统内置角色不可修改），
所以「业务成员能查看工作区变更」的诉求只能通过迁移补权限，不能在界面上配置。

为什么新建迁移而不改 202607251600：已部署的迁移不会再跑，改历史迁移对存量库无效
（同 202607251600 自身 docstring 的范式）。为什么不改 ``ROLE_KEY_WHITELIST`` 或换角色：
``viewer`` / ``developer`` 没有 ``daemon:borrow``，换成它们会让业务成员失去借用共享
daemon 的能力；直接扩大 ``business_member`` 的权限集是用户确认的全局口径
（2026-10-30-business-member-change-read / D-001）。

幂等：``INSERT ... SELECT ... WHERE NOT EXISTS`` + ``ON CONFLICT DO NOTHING``，
重复执行/Marker 已手工预置都不新增行、不报唯一键错误。语句只用 PG 与 SQLite
共同支持的语法（迁移单测在 SQLite 上跑本体）。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261030160000"
down_revision = "20261023090100"
branch_labels = None
depends_on = None


#: 幂等授予：仅当 business_member 存在且尚未持有 change:read 时插入一行。
_GRANT_SQL = """
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, 'change:read'
FROM roles r
WHERE r.key = 'business_member'
  AND NOT EXISTS (
      SELECT 1
      FROM role_permissions rp
      WHERE rp.role_id = r.id AND rp.permission = 'change:read'
  )
ON CONFLICT DO NOTHING
"""

#: 降级删除 business_member 名下**全部** change:read 行——role_permissions 无来源
#: 标记，无法只删「本迁移授予的」（2026-11-01-provider-share-audit-fixes 如实化）。
#: 可接受：business_member 是后台不可修改的系统内置角色（RoleSystemProtected），
#: 本迁移即该 (角色, 权限) 组合的唯一合法来源；升级幂等（NOT EXISTS）保证手工
#: 预置行不重复，降级一并移除语义等价。不动角色行与其他权限。
_REVOKE_SQL = """
DELETE FROM role_permissions
WHERE permission = 'change:read'
  AND role_id IN (SELECT id FROM roles WHERE key = 'business_member')
"""


def upgrade() -> None:
    op.execute(sa.text(_GRANT_SQL))


def downgrade() -> None:
    op.execute(sa.text(_REVOKE_SQL))
