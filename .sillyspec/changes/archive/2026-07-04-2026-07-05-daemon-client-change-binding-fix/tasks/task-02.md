---
id: task-02
title: change_writer proxy-create 删 runtime_id 入参 + 校验改现算
author: qinyi
created_at: 2026-07-05 00:52:43
priority: P0
depends_on: [task-01]
blocks: [task-06]
allowed_paths:
  - backend/app/modules/change_writer/proxy.py
  - backend/app/modules/change_writer/router.py
  - backend/app/modules/change_writer/service.py
goal: "修 daemon-client 建变更永远 DAEMON_CLIENT_NO_SESSION（删 runtime_id 入参，校验改现算）"
implementation: "proxy_create_change 签名删 runtime_id；line 192 死校验删改调 resolve_runtime_for_writeback；router ProxyCreateChangeRequest 删 runtime_id；service create_change 签名删 runtime_id"
acceptance: "daemon-client workspace（NULL+binding）建变更成功（AC-01）；daemon 离线→DAEMON_CLIENT_NO_SESSION"
verify: "pytest change_writer/tests/test_proxy.py（task-07 补新链路 fixture）"
constraints: "不改 DaemonChangeWrite 表结构；daemon 端轮询协议不动"
---

# task-02 — change_writer proxy-create 删 runtime_id 入参 + 校验改现算

## goal
修 daemon-client workspace 建变更永远 DAEMON_CLIENT_NO_SESSION（D-001/D-002@v1 /
FR-02/FR-03）。

## 实现步骤
1. `change_writer/proxy.py:168` `proxy_create_change` 签名删 `runtime_id` 参数。
2. line 192 的 `workspace.daemon_runtime_id != runtime_id` 死校验**整段删除**，改为
   调 `resolve_runtime_for_writeback(session, workspace_id, user_id)` 拿 runtime
   （失败抛 DaemonClientNoActiveSession）；`runtime_id = runtime.id`。
3. line 205-215 runtime 心跳二次校验保留（防竞态）。
4. `DaemonChangeWrite(runtime_id=runtime_id, ...)`（line 234）填现算值。
5. `change_writer/router.py:90` `ProxyCreateChangeRequest` 删 `runtime_id` 字段。
6. `change_writer/service.py:57` `create_change` 签名删 `runtime_id`；line 113-135
   daemon-client 分支简化（删 `runtime_id is None` 防御）。

## 验收标准
- daemon-client workspace（daemon_runtime_id=NULL + member binding）调
  proxy-create 建变更成功（AC-01）。
- daemon 离线 → DaemonClientNoActiveSession（reason=daemon_offline）。

## 验证
- `pytest app/modules/change_writer/tests/test_proxy.py`（task-07 补新链路 fixture）

## 约束
- 不改 DaemonChangeWrite 表结构（runtime_id NOT NULL 保留）。
- daemon 端轮询协议不动。
