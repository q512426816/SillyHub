"""AgentMission project_id index (BE-P2-2, 2026-08-21 审查)

Revision ID: 20260821100000
Revises: 20260819100000
Create Date: 2026-08-21 10:00:00

审查修复（docs/project-team-mission-review-2026-08-21.md BE-P2-2）：
``GET /api/projects/{pid}/missions``（agent/router.py list_project_missions）按
``AgentMission.project_id`` 过滤，原先无索引走顺序扫描。补 ``ix_agent_missions_project_id``
普通索引（project_id 选择性高，列表页高频查询）。
"""

from __future__ import annotations

from alembic import op

revision: str = "20260821100000"
down_revision: str | None = "20260819100000"
branch_labels: str | list[str] | None = None
depends_on: str | list[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_agent_missions_project_id",
        "agent_missions",
        ["project_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_agent_missions_project_id", table_name="agent_missions")
