"""users.default_agent_profile_id — 每用户一个默认智能体档案

Revision ID: 20261021_user_default
Revises: c3f8a1d6e2b4
Create Date: 2026-10-21

Change 2026-10-21-agent-profile-slim-default task-01 / design §接口契约：
- ``users`` 加 ``default_agent_profile_id`` (uuid NULL, FK agent_profiles.id
  ON DELETE SET NULL)——用户级默认档案（每用户至多一个，单列天然互斥）。
- FK SET NULL：默认档案被删 → 用户默认自动回落无默认（软偏好，不阻断会话创建）。

与既有 ``workspaces.default_agent_profile_id``（20260802_agent_profile，dispatch
兜底第二档、无 UI 可配恒 NULL）区分：本列是**用户级**，供会话/群聊未显式选档案
时注入人格与技能（本变更 task-02）。

铁律：全新列 nullable，向后兼容（未设默认 = 现状零注入零回归）。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20261021_user_default"
down_revision: str | None = "c3f8a1d6e2b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("default_agent_profile_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_users_default_agent_profile",
        "users",
        "agent_profiles",
        ["default_agent_profile_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_users_default_agent_profile", "users", type_="foreignkey")
    op.drop_column("users", "default_agent_profile_id")
