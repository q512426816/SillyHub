"""workspace description column + legacy type CASE normalization

Revision ID: 20260818150000
Revises: 20260817100000
Create Date: 2026-08-18 15:00:00

Change 2026-08-18-workspace-role-type task-02（design §5.2/§8）：
1. workspaces 加 description TEXT NULL 列（FR-03）；
2. 存量非空 type 按映射可收编子集做幂等 CASE 收编 UPDATE——CASE 分支与
   app/modules/workspace/constants.py 的 YAML_TYPE_NORMALIZE_MAP 逐字一致
   （18 条可映射分支；migration 内不 import app 模块，避免迁移环境路径耦合，
   改词表时两处需同步——constants.py 的 docstring 已注明此消费方）。
   仅收编明确映射（D-003@v1）：映射不上的 ELSE type 保留原值，绝不强改 other。

downgrade：drop description 列；**type 收编不可逆**——原值已被 CASE 覆盖，
无反向映射可恢复（design §9 回退路径），故 downgrade 不写反向 UPDATE。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260818150000"
down_revision: str | None = "20260817100000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 与 constants.YAML_TYPE_NORMALIZE_MAP 可映射子集逐字对齐（design §8 SQL 原文）。
_CASE_WHEN = """
            WHEN 'frontend' THEN 'frontend-code' WHEN 'frontend-app' THEN 'frontend-code'
            WHEN 'web' THEN 'frontend-code' WHEN 'backend' THEN 'backend-code'
            WHEN 'backend-api' THEN 'backend-code' WHEN 'api' THEN 'backend-code'
            WHEN 'service' THEN 'backend-code' WHEN 'fullstack' THEN 'fullstack'
            WHEN 'monorepo' THEN 'fullstack' WHEN 'docs' THEN 'business-doc'
            WHEN 'doc' THEN 'business-doc' WHEN 'documentation' THEN 'business-doc'
            WHEN 'module' THEN 'submodule' WHEN 'submodule' THEN 'submodule'
            WHEN 'deploy' THEN 'deploy-ops' WHEN 'infra' THEN 'deploy-ops'
            WHEN 'devops' THEN 'deploy-ops' WHEN 'design' THEN 'design-asset'
"""


def upgrade() -> None:
    op.add_column(
        "workspaces",
        sa.Column("description", sa.Text(), nullable=True),
    )
    # 存量收编（幂等，可重跑）：映射不上 ELSE type 保留原值，WHERE 只动非空行。
    op.execute(
        sa.text(
            f"""
            UPDATE workspaces SET type = CASE type{_CASE_WHEN}
            ELSE type END
            WHERE type IS NOT NULL
            """
        )
    )


def downgrade() -> None:
    # type 收编不可逆：原值已被 upgrade 的 CASE 覆盖，无反向映射（design §9）。
    op.drop_column("workspaces", "description")
