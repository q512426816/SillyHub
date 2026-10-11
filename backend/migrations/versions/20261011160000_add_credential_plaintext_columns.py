"""api_keys.encrypted_key / mcp_tokens.encrypted_token（2026-10-11-apikey-mcp-copy-delete task-01）

两凭据表各加一可空 TEXT 列，存可逆加密的明文（``{key_id}:{hex(ciphertext)}``，
libsodium secretbox，KEK=SILLYSPEC_MASTER_KEY，与 mcp_webhooks.secret 存储格式同构）：
管理面「复制已生成凭据」按需解密返回。鉴权面（api_keys bcrypt key_hash /
mcp_tokens sha256 token_hash 唯一索引）零改动。

存量行保持 NULL——明文不可恢复，UI 复制入口降级禁用（FR-05）；签发时未配置
主密钥的新行同样置 NULL（创建不因此失败）。

Revision ID: 20261011160000
Revises: 20261010190000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261011160000"
down_revision = "20261010190000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("api_keys", sa.Column("encrypted_key", sa.Text(), nullable=True))
    op.add_column("mcp_tokens", sa.Column("encrypted_token", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("mcp_tokens", "encrypted_token")
    op.drop_column("api_keys", "encrypted_key")
