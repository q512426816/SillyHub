"""merge heads: 20261021_user_default × 20261021130000（并行变更迁移分叉收拢）

Revision ID: a05c84259_merge
Revises: 20261021_user_default, 20261021130000
Create Date: 2026-10-22

合并 a05c84259 时两侧各自从 c3f8a1d6e2b4 之后新增迁移形成双头：
- 20261021_user_default（本地 agent-profile-slim-default）
- 20261021130000（origin spec-manifest 落地版本通道）
alembic merge 收拢，无 schema 变更。
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "a05c84259_merge"
down_revision = ("20261021_user_default", "20261021130000")
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 纯收拢：无 DDL。
    pass


def downgrade() -> None:
    pass
