"""add api_format column to llm_providers

Revision ID: 202608091100
Revises: 20260806140000
Create Date: 2026-08-09 11:00:00

供应商管理支持完整 URL + OpenAI API 格式（change 2026-08-08-llm-provider-openai-format /
FR-01 / D-001@v1）：``llm_providers`` 加 ``api_format`` 列（``anthropic`` 默认 /
``openai_chat``），NOT NULL，``server_default='anthropic'`` 让既有 Anthropic 行自动回填
（NFR-02 零回归：未配 openai 的链路逐字不变）。

不新增 ``is_full_url`` 列（D-001@v1：完整 URL 走算法归一，由 service._strip_openai_suffix
实现，不落库）。索引不变（不动 ix_llm_providers_user /
ix_llm_providers_user_agent_default）。
"""

import sqlalchemy as sa
from alembic import op

revision = "202608091100"
down_revision = "20260806140000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # server_default='anthropic'：加列即把既有行回填 anthropic（NFR-02 零回归）。
    op.add_column(
        "llm_providers",
        sa.Column(
            "api_format",
            sa.String(32),
            nullable=False,
            server_default="anthropic",
        ),
    )


def downgrade() -> None:
    op.drop_column("llm_providers", "api_format")
