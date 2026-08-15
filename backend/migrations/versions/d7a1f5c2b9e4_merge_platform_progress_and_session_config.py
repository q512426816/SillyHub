"""merge platform_progress_documents_approval and agent_session_config heads

Revision ID: d7a1f5c2b9e4
Revises: 20260814220000, 20260815090000
Create Date: 2026-08-15 19:05:00

rebase 合并修复（ql-20260815-001 期间）：sessions-portal 的
20260815090000（agent_sessions 配置三列 + agent_runs.llm_provider_id）与远端
20260814220000（platform progress documents/approval）自 20260813173000 分叉
出两条 head，合并为单 head。两分支 DDL 互不相交，merge 节点无操作。
"""

from __future__ import annotations

from typing import Sequence

revision: str = "d7a1f5c2b9e4"
down_revision: str | None = ("20260814220000", "20260815090000")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
