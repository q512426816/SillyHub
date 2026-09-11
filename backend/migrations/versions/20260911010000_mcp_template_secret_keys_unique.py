"""mcp_templates: secret_env_keys 列 + 预置名唯一索引

Revision ID: 20260911010000
Revises: b299f3782f7a
Create Date: 2026-09-11 01:30:00

ql-20260911-003-355a（用户自定义密钥类型 + P2 双 seed 竞态）：
- 新列 ``mcp_templates.secret_env_keys``（JSON，键名清单——「从模板新建」预勾
  加密开关的依据，值永不入模板）；
- ``uq_mcp_templates_preset_name`` 部分唯一索引（name WHERE is_preset）：
  并发首调双 seed 的 check-then-insert 竞态在此被 DB 拒绝（败者 IntegrityError
  回滚静默退出，templates.ensure_preset_templates 容错）。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260911010000"
down_revision: str | None = "b299f3782f7a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PRESET_WHERE = "is_preset"


def upgrade() -> None:
    op.add_column(
        "mcp_templates",
        sa.Column("secret_env_keys", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )
    op.alter_column("mcp_templates", "secret_env_keys", server_default=None)
    op.create_index(
        "uq_mcp_templates_preset_name",
        "mcp_templates",
        ["name"],
        unique=True,
        postgresql_where=sa.text(_PRESET_WHERE),
        sqlite_where=sa.text(_PRESET_WHERE),
    )


def downgrade() -> None:
    op.drop_index("uq_mcp_templates_preset_name", table_name="mcp_templates")
    op.drop_column("mcp_templates", "secret_env_keys")
