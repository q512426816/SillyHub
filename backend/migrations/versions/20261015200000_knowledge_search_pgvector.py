"""knowledge_search pgvector 持久化（change 2026-10-15-knowledge-search-pgvector）。

两新表（design.md 数据模型）：
- knowledge_search_chunks：chunk 行 + embedding vector(512)（uq(workspace_id,
  spec_path, anchor, title) 差量比对键）；
- knowledge_search_state：workspace 级语料指纹 + 模型版本（懒同步判定面）。

方言守卫（先例 20260825150000 pg_trgm）：非 PG 方言（测试 SQLite）直接 return——
表由 BaseModel.metadata.create_all 在测试引擎建（with_variant 双方言）。

fail-closed（R-06）：PG 方言下 vector 扩展不可用（镜像未换 pgvector/pgvector:pg16）
即 raise——文案含修复指引，防「只跑迁移没换镜像」的半态表。
"""

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text as sa_text

revision: str = "20261015200000"
down_revision: str | Sequence[str] | None = "20261015120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return  # 测试 SQLite：表由 metadata.create_all 建（with_variant JSON 变体）

    available = bind.execute(
        # pg_available_extensions 行存在 = 二进制带扩展（pgvector 镜像或已手动安装）
        sa_text("SELECT count(*) FROM pg_available_extensions WHERE name = 'vector'")
    ).scalar_one()
    if not available:
        raise RuntimeError(
            "PG vector 扩展不可用：知识搜索持久化迁移中止（fail-closed，防半态表）。"
            "修复：把 postgres 镜像换为 pgvector/pgvector:pg16（deploy/docker-compose.yml "
            "与 dev.yml，数据卷不丢）后重启 PG 再重跑 alembic upgrade head；"
            "升级顺序详见变更 2026-10-15-knowledge-search-pgvector design.md Phase 4。"
        )
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS knowledge_search_chunks (
            id UUID PRIMARY KEY,
            workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            spec_path VARCHAR(1024) NOT NULL,
            kind VARCHAR(32) NOT NULL,
            title VARCHAR(512) NOT NULL,
            anchor VARCHAR(256),
            start_line INTEGER NOT NULL,
            text TEXT NOT NULL,
            content_hash VARCHAR(64) NOT NULL,
            embedding vector(512) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL,
            CONSTRAINT uq_kssc_workspace_path_anchor_title
                UNIQUE (workspace_id, spec_path, anchor, title)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_kssc_workspace ON knowledge_search_chunks (workspace_id)"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS knowledge_search_state (
            id UUID PRIMARY KEY,
            workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            corpus_fingerprint JSON NOT NULL,
            model_version VARCHAR(128) NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL,
            CONSTRAINT uq_kss_workspace UNIQUE (workspace_id)
        )
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    # 只删本变更的表；不卸 vector 扩展（共享扩展，pg_trgm downgrade 同款先例）。
    op.execute("DROP TABLE IF EXISTS knowledge_search_state")
    op.execute("DROP TABLE IF EXISTS knowledge_search_chunks")
