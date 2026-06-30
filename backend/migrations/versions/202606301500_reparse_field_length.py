"""expand reparse field length for daemon-client flat layout

Revision ID: 202606301500
Revises: 202606291030
Create Date: 2026-06-30 15:00:00

扩 reparse 相关字段长度，修 daemon-client 扁平 specRoot reparse 时
StringDataRightTruncationError（如 sillyhub-daemon 的 role 字段 115 字符超
varchar(100)），导致 reparse 500、扫描文档/变更中心不显示。

- scan_documents.doc_type / workspaces.role → text（无长度限制）
- workspaces.slug / component_key / default_branch → varchar(200)

幂等：DB 可能已被临时 ALTER，alter_column TYPE 对相同类型 no-op。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202606301500"
down_revision = "202606291030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # scan_documents.doc_type 存文档分类/路径片段，扁平布局下可能较长 → text
    op.alter_column("scan_documents", "doc_type", type_=sa.Text())
    # workspaces.role 存 projects.yaml 的 role 描述（如 sillyhub-daemon 115 字符）→ text
    op.alter_column("workspaces", "role", type_=sa.Text())
    # slug/component_key/default_branch 扩到 200 防边界超长
    op.alter_column("workspaces", "slug", type_=sa.String(length=200))
    op.alter_column("workspaces", "component_key", type_=sa.String(length=200))
    op.alter_column("workspaces", "default_branch", type_=sa.String(length=200))


def downgrade() -> None:
    op.alter_column("workspaces", "default_branch", type_=sa.String(length=100))
    op.alter_column("workspaces", "component_key", type_=sa.String(length=100))
    op.alter_column("workspaces", "slug", type_=sa.String(length=100))
    op.alter_column("workspaces", "role", type_=sa.String(length=100))
    op.alter_column("scan_documents", "doc_type", type_=sa.String(length=100))
