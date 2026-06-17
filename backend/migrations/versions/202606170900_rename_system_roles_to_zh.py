"""rename system roles to Chinese

Revision ID: 202606170900
Revises: 202606161200
Create Date: 2026-06-17 09:00:00.000000
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202606170900"
down_revision: str | None = "202606161200"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# key -> 中文 name。key 不变（是 RBAC 判定的稳定标识），name 是展示文案。
SYSTEM_ROLE_NAMES_ZH: dict[str, str] = {
    "platform_admin": "平台管理员",
    "workspace_owner": "工作区所有者",
    "component_lead": "组件负责人",
    "developer": "开发者",
    "reviewer": "审核人",
    "qa": "测试工程师",
    "viewer": "访客",
}


def upgrade() -> None:
    for key, name_zh in SYSTEM_ROLE_NAMES_ZH.items():
        op.execute(
            sa.text(
                "UPDATE roles SET name = :name WHERE key = :key AND is_system = TRUE"
            ).bindparams(name=name_zh, key=key)
        )


def downgrade() -> None:
    # 还原为原英文名
    en_names = {
        "platform_admin": "Platform Admin",
        "workspace_owner": "Workspace Owner",
        "component_lead": "Component Lead",
        "developer": "Developer",
        "reviewer": "Reviewer",
        "qa": "QA",
        "viewer": "Viewer",
    }
    for key, name_en in en_names.items():
        op.execute(
            sa.text(
                "UPDATE roles SET name = :name WHERE key = :key AND is_system = TRUE"
            ).bindparams(name=name_en, key=key)
        )
