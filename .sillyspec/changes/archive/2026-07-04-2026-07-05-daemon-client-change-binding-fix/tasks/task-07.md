---
id: task-07
title: 后端集成测试 + 新链路覆盖 + 回归
author: qinyi
created_at: 2026-07-05 00:52:43
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05]
blocks: []
allowed_paths:
  - backend/app/modules/change_writer/tests/test_proxy.py
  - backend/app/modules/change/tests/test_files_router.py
  - backend/app/modules/spec_workspace/tests/test_sync_manual.py
  - backend/app/modules/daemon/runtime/tests/
  - backend/app/modules/agent/tests/test_placement_member_binding.py
goal: "补 daemon_runtime_id=NULL+member binding 新链路测试覆盖 + 守零回归"
implementation: "新增共享 fixture _make_daemon_client_workspace_with_binding（runtime_id=None+DaemonInstance+WorkspaceMemberRuntime）；test_proxy/test_files_router/test_sync_manual/daemon-runtime 各补新链路；placement 查询提取零回归"
acceptance: "AC-01~06/08 全覆盖；现有 server-local/legacy fixture 零回归（AC-06）"
verify: "pytest app/modules/（workspace+change_writer+change+spec_workspace+daemon+agent 全绿）"
constraints: "仅测试不改实现；新 fixture 不破坏现有 _make_daemon_client_workspace"
---

# task-07 — 后端集成测试 + 新链路覆盖 + 回归

## goal
补 `daemon_runtime_id=NULL + member binding` 新链路测试覆盖（现有 fixture 全用
非空 runtime_id，是 bug 漏到生产的主因），并守住零回归（AC-01~06/08）。

## 实现步骤
1. 新增共享 fixture `_make_daemon_client_workspace_with_binding`：daemon_runtime_id=None
   + DaemonInstance + WorkspaceMemberRuntime 行（daemon_id 绑 admin）。
2. `test_proxy.py`：daemon-client workspace（新 fixture）proxy_create_change 成功；
   daemon 离线 → DaemonClientNoActiveSession。
3. `test_files_router.py`：_enqueue_edit_write 新链路成功落 DaemonChangeWrite。
4. `test_sync_manual.py`：daemon-client sync-manual 走 outbox 返回 pending。
5. `daemon/runtime/tests/`：删除被 lease/change_write 引用的 runtime 被阻止。
6. `test_placement_member_binding.py`：查询函数提取后零回归。

## 验收标准
- AC-01~06/08 全部覆盖。
- 现有 server-local / legacy fixture（非空 daemon_runtime_id）测试零回归（AC-06）。

## 验证
- `pytest app/modules/`（workspace + change_writer + change + spec_workspace + daemon + agent 全绿）

## 约束
- 不改实现文件（仅测试）。
- 新 fixture 不破坏现有 `_make_daemon_client_workspace`（legacy 回归用）。
