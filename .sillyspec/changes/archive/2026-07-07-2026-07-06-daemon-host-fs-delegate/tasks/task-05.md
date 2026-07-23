---
id: task-05
title: complete_lease 入口反查 workspace.path_source 并透传 3 回调（apply_patch / post_scan / stage_callback）（覆盖：FR-03）
author: qinyi
created_at: 2026-07-06 19:28:16
priority: P0
depends_on: [task-01]
blocks: [task-06, task-07, task-08]
requirement_ids: [FR-03]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/lease/service.py
provides:
  - contract: CompleteLeasePathSource
    fields: [path_source]
expects_from: {}
goal: >
  complete_lease 入口反查 workspace.path_source 并透传给 apply_patch / post_scan / stage_callback 三个收尾回调，消灭 design §1 第 2 层贯穿缺口。
implementation:
  - "§12 反查链路核实结论：agent_run 无 workspace_id 字段，真实链路走 M:N 关联表 AgentRunWorkspace（仿 patch/service.py:63-76），新增 _resolve_lease_workspace_path_source helper"
  - "3 回调签名透传 path_source：_apply_patch_to_worktree / _run_post_scan_validation / _trigger_stage_completion_callback 入口解析一次局部变量透传，facade 委托方法同步加参数"
  - "server-local 行为不变：path_source 透传但不改分支执行路径，回调内部分流归 task-06/07/08"
acceptance:
  - "daemon-client lease complete 时 3 回调拿到 path_source=daemon-client（单测断言 facade 调用 kwargs）"
  - "server-local lease complete 时 path_source=server-local，3 回调行为零回归（现有测试全绿）"
  - "§12 反查链路核实结论在 implementation 注明（M:N 走 AgentRunWorkspace，非 design 假设的 agent_run.workspace_id 字段）"
  - "缺 binding / agent_run_id=None 的 lease 不抛（降级 server-local + warn）"
verify:
  - "cd backend && uv run pytest app/modules/daemon/lease/"
constraints:
  - "path_source 反查必须走 AgentRunWorkspace 关联表（§12 核实结论已落实，design 字段假设作废）"
  - "3 回调签名变更是 facade 公共委托面，需在 task-06/07/08 同步消费；本 task 仅加参数 + 透传，不实现回调体分流"
  - "facade 委托方法（patch / run_sync 子域）签名需同步加 path_source，跨子域契约（D-006@v1）保持"
  - "server-local 零回归（NFR-02）"
---

## goal

`complete_lease`（lease/service.py:278）入口处一次性反查 `workspace.path_source`，透传给 `apply_patch_to_worktree` / `_run_post_scan_validation` / `_trigger_stage_completion_callback` 三个收尾回调（service.py:472 / :527 / :511），消灭 design §1 第 2 层「贯穿缺口」——收尾锚点假设 backend 总能访问 root_path 的根因。

## implementation

1. **§12 反查链路核实结论（关键修正 design 假设）**：design §12 写「lease → agent_run → workspace.path_source（agent_run.workspace_id）」——**核实后 agent_run 上无 workspace_id 字段**（agent/model.py:26 `AgentRun` 类无此字段；model.py:477 的 workspace_id 属于 `AgentMission` 类，不适用）。真实链路是 **M:N 关联表 `AgentRunWorkspace`**（与 patch/service.py:65 现成反查一致）：
   - `lease.agent_run_id` → `AgentRunWorkspace.workspace_id`（SELECT ... WHERE agent_run_id = lease.agent_run_id）→ `Workspace.path_source` / `Workspace.root_path`。
   - 在 complete_lease 入口（line 290 `_get_lease_and_verify_token` 之后）新增私有 helper `_resolve_lease_workspace_path_source(lease) -> tuple[Workspace | None, str]`，仿 patch/service.py:63-76 查 `AgentRunWorkspace`，取 `path_source`（缺 binding/agent_run_id 时降级为 `"server-local"` 默认，warn 不阻塞，与 init_meta try/except 风格一致）。
2. **3 回调签名透传 path_source**：
   - `_apply_patch_to_worktree`（line 472 facade 委托，patch/service.py）加 `path_source` 入参。
   - `_run_post_scan_validation`（line 527 facade 委托）加 `path_source` 入参。
   - `_trigger_stage_completion_callback`（line 511 facade 委托）加 `path_source` 入参。
   - 入口解析一次 `path_source` 局部变量，3 处 facade 调用透传；facade 对应委托方法签名同步加（task-06/07/08 落地回调体消费）。
3. **server-local 行为不变**：path_source 透传但不改变 server-local 分支执行路径（D-004 本地容器直做），回调内部分流由 task-06/07/08 接 HostFsDelegate 完成。

## 验收标准

- daemon-client lease complete 时 3 回调能拿到 `path_source="daemon-client"`（单测断言 facade 调用 kwargs）。
- server-local lease complete 时 `path_source="server-local"`，3 回调行为零回归（现有测试全绿）。
- §12 反查链路核实结论在 implementation 注明（M:N 走 AgentRunWorkspace，非 design 假设的 agent_run.workspace_id 字段）。
- 缺 binding / agent_run_id=None 的 lease 不抛（降级 server-local + warn）。

## verify

```
cd backend && uv run pytest app/modules/daemon/lease/
```

## constraints

- path_source 反查必须走 `AgentRunWorkspace` 关联表（§12 待核结论已落实，design 字段假设作废）。
- 3 回调签名变更是 facade 公共委托面，需在 task-06/07/08 同步消费；本 task 仅加参数 + 透传，不实现回调体分流（HostFsDelegate 调用归 task-06/07/08）。
- facade 委托方法（patch / run_sync 子域）签名需同步加 path_source，跨子域契约（D-006@v1）保持。
- server-local 零回归（NFR-02）。
