---
id: task-04
title: spec_workspace/router.py sync-manual runtime_id 改现算
author: qinyi
created_at: 2026-07-05 00:52:43
priority: P0
depends_on: [task-01]
blocks: [task-07]
allowed_paths:
  - backend/app/modules/spec_workspace/router.py
goal: "修 daemon-client spec 手动同步错走 server-local（runtime_id 改现算）"
implementation: "sync_manual_spec_workspace 分流条件 line 172 改 path_source==daemon-client；分支内调 resolve_runtime_for_writeback 拿 runtime_id；保留 MemberBindingResolver 解析 daemon_id+root_path"
acceptance: "daemon-client sync-manual 返回 {status:pending,task_id}（AC-03）；server-local 分支不变"
verify: "pytest spec_workspace/tests/test_sync_manual.py（task-07 补新链路）"
constraints: "MemberBindingResolver 解析保留；kind=spec-sync 的 DaemonChangeWrite 结构不变"
---

# task-04 — spec_workspace sync-manual runtime_id 改现算

## goal
修 daemon-client workspace 手动 spec 同步错走 server-local（D-001@v1 / FR-05）。

## 实现步骤
1. `spec_workspace/router.py:148-196` `sync_manual_spec_workspace`：
   - 分流条件 line 172 `if path_source == "daemon-client" and runtime_id is not None:`
     改为 `if path_source == "daemon-client":`（不再依赖 runtime_id 非空）。
   - 分支内调 `resolve_runtime_for_writeback(session, workspace_id, user.id)` 拿
     `runtime_id`（替代 line 191 `runtime_id = ws.daemon_runtime_id`）。
2. 保留 `MemberBindingResolver` 解析 daemon_id + root_path（router.py:180 现有）。
3. DaemonChangeWrite(runtime_id=现算值) 建 outbox 行。

## 验收标准
- daemon-client workspace sync-manual 返回 `{"status":"pending","task_id":...}`（AC-03）。
- server-local 分支不变。

## 验证
- `pytest app/modules/spec_workspace/tests/test_sync_manual.py`（task-07 补新链路）

## 约束
- MemberBindingResolver 解析逻辑保留（daemon_id + root_path 来自 binding）。
- kind="spec-sync" 的 DaemonChangeWrite 结构不变。
