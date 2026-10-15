"""drop knowledge_search_chunks 的 (workspace_id, spec_path, anchor, title) 唯一约束。

生产实证（2026-10-15 部署）：决策库跨变更重号条目 + 模板化同标题（如多个
「## D-001@v1 风险与死路（design 槽4 收割）」）大量存在，(anchor, title) 组合
不唯一 —— 首建库 INSERT 即撞 uq 失败。差量比对改按行号坐标 (spec_path,
start_line)（应用层，文件内唯一）；DB 级约束移除（并发兜底由进程锁 single-flight
+ 全量清空重建语义承担）。
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20261016010000"
down_revision: str | Sequence[str] | None = "20261015200000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute(
        "ALTER TABLE knowledge_search_chunks "
        "DROP CONSTRAINT IF EXISTS uq_kssc_workspace_path_anchor_title"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute(
        "ALTER TABLE knowledge_search_chunks "
        "ADD CONSTRAINT uq_kssc_workspace_path_anchor_title "
        "UNIQUE (workspace_id, spec_path, anchor, title)"
    )
