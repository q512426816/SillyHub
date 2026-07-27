"""add token_id_hmac column + partial unique index to sessions

Revision ID: 202607271700
Revises: 202607270900
Create Date: 2026-07-27 17:00:00.000000

Change 2026-07-27-auth-refresh-token-index task-03 / FR-10 / D-003 / D-008：
为 ``sessions`` 表新增 ``token_id_hmac`` 列（HMAC-SHA256(key, token_id) hex，
String(64)），并在其上建部分唯一索引 ``ux_sessions_token_id_hmac``
（``WHERE token_id_hmac IS NOT NULL``），把 refresh/consume 的 token 查找从
``refresh_token_hash`` bcrypt 全表比对改为按 HMAC 的 O(1) 索引命中（D-003）。

镜像 task-01 模型定义（``auth/model.py`` 的 ``Session.__table_args__``），双
``_where``（``postgresql_where`` + ``sqlite_where``）保证 PG 生产（migration）
与 SQLite 测试（create_all）索引形态一致（B2，照 ``workspace/model.py`` 既有
范式）。

brownfield 兼容（D-008）：``nullable=True``，无 server_default，不清 sessions
表；旧 session 行 ``token_id_hmac`` 为 NULL，``WHERE token_id_hmac IS NOT NULL``
使其不进部分唯一索引（多 NULL 行共存不违反唯一约束）。旧 session refresh 走
新代码解析旧 token（无 ``.`` 分隔符）→ ``AuthTokenInvalid`` → 401 → 前端跳
登录，自然失效。

down_revision 接 ``202607270900``（``alembic heads`` 实测当前单 head）；游离
``202608010900`` 不在 head 链（pre-existing 仓库卫生问题，非本变更引入），
接续不受影响（design §7 B4；migration-chain-fragmentation-pattern 记忆）。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607271700"
down_revision: str | None = "202607270900"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("token_id_hmac", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ux_sessions_token_id_hmac",
        "sessions",
        ["token_id_hmac"],
        unique=True,
        postgresql_where=sa.text("token_id_hmac IS NOT NULL"),
        sqlite_where=sa.text("token_id_hmac IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ux_sessions_token_id_hmac", table_name="sessions")
    op.drop_column("sessions", "token_id_hmac")
