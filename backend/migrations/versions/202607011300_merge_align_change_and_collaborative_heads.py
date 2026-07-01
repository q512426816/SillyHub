"""merge align_change_stage and collaborative_workspace heads

Revision ID: 202607011300
Revises: 202607011000, 202607011200
Create Date: 2026-07-01 19:45:00

合并两条并行分支（部署时 alembic upgrade head 报 Multiple head revisions）：
- 202607011000 (changes-align：删 changes.human_gate + status 默认 active)
- 202607011200 (collaborative-workspace：per-member binding 新表 + scan_documents 加列)

两者操作不同的表/列（changes 表 vs workspace_member_runtimes/scan_documents），
无 schema 冲突；纯 merge 节点，upgrade/downgrade 无 op。参照既有先例
1e69522e288c_merge_orchestration_and_ppm_heads.py。
"""

from __future__ import annotations

from typing import Sequence

revision: str = "202607011300"
down_revision: str | None = ("202607011000", "202607011200")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
