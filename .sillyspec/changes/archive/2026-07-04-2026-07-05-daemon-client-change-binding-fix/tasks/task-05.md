---
id: task-05
title: daemon/runtime/service.py runtime 删除 RESTRICT 改查 lease+change_write
author: qinyi
created_at: 2026-07-05 00:52:43
priority: P1
depends_on: []
blocks: [task-07]
allowed_paths:
  - backend/app/modules/daemon/runtime/service.py
goal: "修 runtime 删除 RESTRICT 保护失效（改查 lease+change_write）"
implementation: "daemon/runtime/service.py line 674,696 查询从 col(Workspace.daemon_runtime_id)==runtime_id 改为查 daemon_task_leases.runtime_id + daemon_change_writes.runtime_id，任一命中→RESTRICT 阻止"
acceptance: "删除被 lease/change_write 引用的 runtime 被阻止（AC-04）；无引用的成功"
verify: "pytest daemon/runtime/tests/（task-07 补用例）"
constraints: "独立于 task-01（可并行）；runtime 自身状态机不变"
---

# task-05 — runtime 删除 RESTRICT 改查 lease + change_write

## goal
修 runtime 删除 RESTRICT 保护失效（D-003@v1 / FR-06）。新链路
`workspaces.daemon_runtime_id` 永远 NULL，原查询查不到引用 → 误删。

## 实现步骤
`daemon/runtime/service.py` line 674, 696 两处删除前引用检查：
- 旧：`col(Workspace.daemon_runtime_id) == runtime_id`
- 新：查 `daemon_task_leases.runtime_id` + `daemon_change_writes.runtime_id`
  （D-003 保留 FK 处，新链路派发+写回现算后这些列有真实值）：
  ```python
  leases = (await session.execute(
      select(DaemonTaskLease.id).where(DaemonTaskLease.runtime_id == runtime_id).limit(1)
  )).scalars().first()
  writes = (await session.execute(
      select(DaemonChangeWrite.id).where(DaemonChangeWrite.runtime_id == runtime_id).limit(1)
  )).scalars().first()
  # leases or writes 命中 → RESTRICT 阻止删除
  ```

## 验收标准
- 删除被 daemon_task_leases 引用的 runtime → 阻止（AC-04）。
- 删除被 daemon_change_writes 引用的 runtime → 阻止（AC-04）。
- 删除无引用的 runtime → 成功（AC-04）。

## 验证
- `pytest app/modules/daemon/runtime/tests/`（task-07 补用例）

## 约束
- 独立于 task-01（不调共享函数，可与 Wave 2 其他并行）。
- runtime 自身状态机（online/offline）不变。
