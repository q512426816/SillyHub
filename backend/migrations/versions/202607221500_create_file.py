"""create file 表 (平台级文件中心元数据).

Revision ID: 202607221500_create_file
Revises: 20260722_backfill_task_desc
Create Date: 2026-07-22

平台级文件中心 (2026-07-22-platform-file-center) 引入 ``file`` 表，存对象存储
(MinIO) 中文件的业务元数据。PPM 各 ``file_urls`` 字段改存本表 id（D-006）。

- ``owner_type``/``owner_id`` 多态归属（D-004/D-008），owner_id 可空（先上传后绑定）;
- ``stored_key`` 唯一（对象存储键）;
- 索引：uploaded_by、owner_type+owner_id;
- ``deleted_at`` 软删。

设计依据：``.sillyspec/changes/2026-07-22-platform-file-center/design.md`` §D-004/D-008。

author: qinyi
created_at: 2026-07-22 15:00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "202607221500_create_file"
down_revision = "20260722_backfill_task_desc"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "file",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("owner_type", sa.String(length=64), nullable=False),
        sa.Column("owner_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("original_name", sa.String(length=255), nullable=False),
        sa.Column("stored_key", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=128), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("uploaded_by", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("stored_key", name="uq_file_stored_key"),
    )
    op.create_index("ix_file_uploaded_by", "file", ["uploaded_by"])
    op.create_index("ix_file_owner", "file", ["owner_type", "owner_id"])


def downgrade() -> None:
    op.drop_index("ix_file_owner", table_name="file")
    op.drop_index("ix_file_uploaded_by", table_name="file")
    op.drop_table("file")
