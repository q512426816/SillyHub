"""add agent_run error_detail column

存放模型层 ModelError（auth_failed/quota_exceeded/rate_limited/timeout/
model_not_found/network/provider_error/unknown），由 daemon 归类器（task-02）
产出、close_interactive_run（task-06）写入 AgentRun.error_detail。与既有
``error_code``（调度层/系统错误，如 no_online_daemon）正交，不互相覆盖（D-009）。
详见 change 2026-07-29-model-error-visibility design §8。

Revision ID: 202607291100
Revises: 202607281500
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202607291100"
down_revision = "202607281500"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("agent_runs", sa.Column("error_detail", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("agent_runs", "error_detail")
