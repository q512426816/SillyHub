"""add file_urls to ppm_task_execute

Revision ID: 20260722220000_add_file_urls
Revises: 202607221500_create_file
Create Date: 2026-07-22 22:00:00.000000

task-02:给 ``ppm_task_execute`` 表加 ``file_urls`` 列(覆盖 FR-01)。
- 问题执行 + 计划任务执行共用 ``ppm_task_execute`` 表,本列让执行记录支持附件上传与回显。
- 复用 file-center 的 ``file_urls`` 语义(string[] 存文件 id),与 ``ppm_plan_task.file_urls`` 对齐。
- ``server_default='[]'`` 保证旧记录无附件(brownfield 兼容,CLAUDE.md 规则 11 不要求历史迁移)。

注:revision id 受 alembic ``alembic_version.version_num`` 列 ``varchar(32)`` 硬限制,
本仓库既有 revision 均 ≤31 字符(如 ``20260721_ps_plan_add_created_by``)。
故 revision id 取 ``20260722220000_add_file_urls``(28 字符),文件名保留任务原始命名。

设计依据:``design.md`` §数据模型 / §兼容策略 / D-001。
列定义参照 ``202607041100_create_ppm_task.py`` L62(``ppm_plan_task.file_urls``)。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260722220000_add_file_urls"
down_revision: str | None = "202607221500_create_file"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "ppm_task_execute",
        sa.Column("file_urls", sa.JSON(), nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("ppm_task_execute", "file_urls")
