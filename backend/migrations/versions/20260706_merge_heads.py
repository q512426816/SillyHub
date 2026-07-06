"""merge heads: 20260705_tool_kind + dceb0c45ab3e

Revision ID: 20260706_merge_heads
Revises: 20260705_tool_kind, dceb0c45ab3e
Create Date: 2026-07-06 09:32:37.000000

收编 9561babd 的 dceb0c45ab3e_merge 漏掉的 20260705_tool_kind 分支
（agent-log-type-tags 变更引入），消除 multiple heads 致 alembic upgrade head 启动失败。
"""

from __future__ import annotations

from typing import Sequence

revision: str = "20260706_merge_heads"
down_revision: str | None = ("20260705_tool_kind", "dceb0c45ab3e")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
