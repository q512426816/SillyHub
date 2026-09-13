"""agent 日志归属存量清理——已改 no-op，DML 抽出到运维脚本（2026-09-13 部署裁决）

Revision ID: 20260912050000
Revises: 5e295549e20f
Create Date: 2026-09-12 05:00:00

Change 2026-09-11-agent-log-attribution-refactor task-05 / design §Phase 3 /
D-004@v2（用户裁决全清）。**本迁移不再执行任何 DML**：deploy/docker-compose.yml
启动命令 ``alembic upgrade head`` 自动前滚，链内破坏性清库会在 CLI 升级前自动
执行（DG-03 设计时序是 backend 发布 → CLI 升级 → 手动执行清库），清空白做且旧
CLI 旧语义上报会立刻重建错配数据；且 downgrade→upgrade 重放会把已重建的正确
数据再清一遍。白名单/stop-revision 对本迁移不可行（与 20260911220000 是
5e295549e20f 兄弟分叉，停在任一止点必丢另一支及后续 schema 迁移）；迁移内
env 门控有"首次 upgrade 即 stamp、跳过的 DML 永不重跑"死结。

清库动作（与原 DML 逐条对齐）改由一次性运维脚本执行：
``backend/scripts/reset_agent_log_attribution.py``（dry-run 默认 + ``--apply``
单事务 + 前后计数回报；在 CLI 升级完成后、重推开始前手动跑一次）。

保留 revision id 占位（2026-09-13 前已 stamp 过的环境不受影响）；schema 零
变更（本来就不建表不加列），no-op 化无副作用。downgrade 维持 no-op
（D-004@v2：数据可由 CLI 重推重建，恢复错配时代的旧归属无意义）。

down_revision 接执行时唯一 head 5e295549e20f（2026-09-12 ``alembic heads``
实测单 head）。

author: qinyi
created_at: 2026-09-12 05:00:00
"""

from __future__ import annotations

from typing import Sequence

revision: str = "20260912050000"
down_revision: str | None = "5e295549e20f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # no-op（2026-09-13 部署裁决）：破坏性清库 DML 抽出到
    # backend/scripts/reset_agent_log_attribution.py 按 DG-03 时序手动执行。
    pass


def downgrade() -> None:
    # no-op（D-004@v2）：数据可由 CLI 重推重建，恢复错配时代的旧归属无意义。
    pass
