---
id: task-12
title: alembic migration component_readonly_cleanup + 测试库 dry-run
author: qinyi
created_at: 2026-07-06 11:29:29
priority: P0
depends_on: [task-11]
blocks: []
requirement_ids: [FR-08]
decision_ids: [D-006@V1, D-008@V1]
allowed_paths:
  - backend/alembic/versions/component_readonly_cleanup.py
goal: >
  新建 alembic migration 清理存量（D-006）：硬删 component_key 非空的 workspace 行、DROP workspace_relations 与 change_workspaces 表；保留 component_key 列（D-008）；测试库 dry-run 验证无残留。
implementation:
  - 生成新 revision（唯一 revision id，down_revision 接当前真实 head，参考 memory migration-chain-fragmentation-pattern）
  - upgrade：`op.execute("DELETE FROM workspaces WHERE component_key IS NOT NULL")` → `op.drop_table('workspace_relations')` → `op.drop_table('change_workspaces')`
  - 保留 `workspaces.component_key` 列（不删列，D-008）
  - downgrade：抛 `NotImplementedError`（本项目允许重置数据，CLAUDE.md 规则10）
  - 测试库 dry-run（`alembic upgrade head --sql` 或 SQLite 重建）验证：workspaces 无 component_key 非空行、两表不存在
acceptance:
  - migration 链单 head 无分叉
  - dry-run 后 workspaces 表无 component 行，workspace_relations/change_workspaces 表消失
  - component_key 列仍存在于 workspaces
  - downgrade 行为已明确（不可逆）
verify:
  - cd backend && python -m alembic upgrade head --sql
  - cd backend && python -m pytest tests/ -q -k "migration or alembic"
constraints:
  - revision id 唯一，down_revision 接真实 head（防多 head）
  - CASCADE 顺序：先 DELETE component 行（触发 relations/change_workspaces 行级联）再 DROP 表（R-04）
  - 不在 W1/W2 跑此 migration（W3 最后跑，前两 Wave 出问题可回退代码不回退数据）
---

