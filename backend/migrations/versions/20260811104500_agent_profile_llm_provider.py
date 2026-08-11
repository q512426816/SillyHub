"""add llm_provider_id to agent_profiles

Revision ID: 20260811104500
Revises: 20260810150000
Create Date: 2026-08-11 10:45:00

AgentProfile 绑定用户级 LlmProvider（/settings/providers 配置的 claude 类凭证）。
任务派发时 lease metadata 透传，claim 装配优先用绑定 provider 的凭证
（方案A：仅 daemon 登记者 == provider owner 时生效，否则回退用户默认 D-005/D-006/D-007）。
ondelete SET NULL：provider 删除则档案字段置空、回退默认链。

batch_alter_table 兼容 SQLite（单测：ALTER TABLE 加 FK 需 batch 重建表）
与 PostgreSQL（生产：batch 为 no-op wrapper，直接 ALTER）。

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260811104500"
down_revision = "20260810150000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("agent_profiles", schema=None) as batch_op:
        batch_op.add_column(sa.Column("llm_provider_id", sa.Uuid(as_uuid=True), nullable=True))
        batch_op.create_foreign_key(
            "fk_agent_profiles_llm_provider_id_llm_providers",
            "llm_providers",
            ["llm_provider_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("agent_profiles", schema=None) as batch_op:
        batch_op.drop_constraint(
            "fk_agent_profiles_llm_provider_id_llm_providers",
            type_="foreignkey",
        )
        batch_op.drop_column("llm_provider_id")
