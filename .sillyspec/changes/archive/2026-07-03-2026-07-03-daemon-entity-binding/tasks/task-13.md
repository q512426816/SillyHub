---
id: task-13
title: alembic 迁移链完善 + 可选 cleanup 脚本（D-003 保留 / D-007 重置）
author: qinyi
created_at: 2026-07-03 11:30:00
priority: P1
depends_on: [task-01, task-02, task-03]
blocks: [task-15]
allowed_paths:
  - backend/migrations/versions/
  - backend/scripts/
covers: [D-003, D-007]
---

## goal
> 汇总 task-01/02/03 的迁移为单一一致链，提供可选 cleanup 脚本清空旧绑定数据，FK 与 default_agent 按决策保留。

## implementation
- 合并/校验 task-01（建 daemon_instances）、task-02（runtimes 加 daemon_instance_id + 移除 os/arch/allowed_roots/capabilities/display_alias + idx）、task-03（wmr 加 daemon_id + ix_wmr_daemon）为线性 revision 链，down_revision 接真实当前 head（避免 migration-chain-fragmentation-pattern）。
- upgrade 不写历史 daemon_local_id（D-007）：daemon_instance_id 与 daemon_id 列留空；downgrade 逆向重建被移除列。
- 保留 `daemon_task_leases.runtime_id` 与 `daemon_change_writes.runtime_id` FK（D-003 不动）；保留 `workspaces.default_agent` 列与数据（D-005/D-007）。
- 新增 `backend/scripts/cleanup_legacy_daemon_bindings.py`：可选脚本清空 daemon_runtimes 与 workspace_member_runtimes 旧数据，默认 --dry-run，需显式 --confirm 执行。

## acceptance
- `alembic upgrade head` 在空库与现有库均成功，单 head 无分叉。
- 迁移后 daemon_instances 存在、runtimes.daemon_instance_id 可空、被移除列消失、索引就位。
- lease/change_write 的 runtime_id FK 完整、default_agent 数据无丢失。
- cleanup 脚本 --dry-run 预览、--confirm 清空两表。

## verify
- `cd backend && uv run alembic upgrade head && uv run alembic heads`
- `cd backend && uv run alembic downgrade -1 && uv run alembic upgrade head`
- `cd backend && uv run python scripts/cleanup_legacy_daemon_bindings.py --dry-run`

## constraints
- brownfield 兼容（D-007）：旧数据不迁移 daemon_local_id，留空让用户重绑；不引入 runtime_id→daemon_id 历史推导（YAGNI）。
- down_revision 接真实 head，revision id 唯一（避免并行变更撞 id）。
- lease/change_write.runtime_id FK 与 default_agent 全程保留。
- 兼容 SQLite（测试）与 PG（生产）方言（backend-test-sqlite-vs-pg）。
