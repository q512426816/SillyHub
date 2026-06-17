"""rename system roles to Chinese

Revision ID: 202607010900
Revises: 202606161200
Create Date: 2026-07-01 09:00:00.000000
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607010900"
down_revision: str | None = "202606161200"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# 系统角色 key → 中文 name。源 migration 202605280900 已对全新库直接种子中文名，
# 本迁移负责把已部署库里的英文 name UPDATE 成中文。description 也一并中文化。
SYSTEM_ROLE_NAMES_ZH: dict[str, tuple[str, str]] = {
    "platform_admin": ("平台管理员", "拥有全部工作区的全部权限。"),
    "workspace_owner": ("工作区所有者", "对单个工作区拥有完整控制权。"),
    "component_lead": ("组件负责人", "负责工作区内的一个或多个组件。"),
    "developer": ("开发者", "日常贡献者。"),
    "reviewer": ("审核人", "可审核代码与变更，但不能修改。"),
    "qa": ("测试工程师", "质量保障，可发起有限的 Agent 运行。"),
    "viewer": ("访客", "工作区只读访问。"),
}


def upgrade() -> None:
    for key, (name_zh, desc_zh) in SYSTEM_ROLE_NAMES_ZH.items():
        op.execute(
            sa.text(
                "UPDATE roles SET name = :name, description = :desc "
                "WHERE key = :key AND is_system = TRUE"
            ).bindparams(name=name_zh, desc=desc_zh, key=key)
        )


def downgrade() -> None:
    system_role_names_en: dict[str, tuple[str, str]] = {
        "platform_admin": ("Platform Admin", "Holds every permission across every workspace."),
        "workspace_owner": ("Workspace Owner", "Full control over a single workspace."),
        "component_lead": ("Component Lead", "Owns one or more components inside a workspace."),
        "developer": ("Developer", "Day-to-day contributor."),
        "reviewer": ("Reviewer", "Can review code and changes but cannot write."),
        "qa": ("QA", "Quality assurance + limited agent runs."),
        "viewer": ("Viewer", "Read-only across the workspace."),
    }
    for key, (name_en, desc_en) in system_role_names_en.items():
        op.execute(
            sa.text(
                "UPDATE roles SET name = :name, description = :desc "
                "WHERE key = :key AND is_system = TRUE"
            ).bindparams(name=name_en, desc=desc_en, key=key)
        )
