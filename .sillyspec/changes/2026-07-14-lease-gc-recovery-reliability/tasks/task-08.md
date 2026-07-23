---
task_id: task-08
title: 悬空 session 可见性——runtime_online 字段 + 离线徽标
wave: W3
priority: P2
depends_on: [task-02]
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/session/service.py
  - frontend/src/components/daemon/session-list-layout.tsx
  - backend/app/modules/daemon/session/tests/
  - backend/app/modules/daemon/tests/
---

## 目标

让用户看到持有 session 的 daemon 是否离线（支撑手动 end/reopen），不自动操作 session 状态。
覆盖 D-004@v1、FR-06；design §8.2 AgentSessionRead runtime_online、§7.5 可见性查询行。

## 实现要点

1. `backend/app/modules/daemon/schema.py`：`AgentSessionRead` 加 `runtime_online: bool` 字段（运行时 join 计算，非 ORM 映射、不入库）。default=True 保持旧无 runtime session 兼容。
2. `backend/app/modules/daemon/session/service.py`：`list_agent_sessions`(:1318)/`get_agent_session`(:1356) 返回 session 时 join `daemon_runtimes`（经 `AgentSession.runtime_id` FK，agent/model.py:426），按 `runtime_stale_seconds`(默认 45，DEFAULT_RUNTIME_STALE_SECONDS runtime/service.py:25) 算 `runtime_online = (now - daemon_runtimes.last_heartbeat_at) < 45s`。runtime_id 为 NULL → runtime_online=False（无运行时即视离线）。
3. router 序列化层把计算结果注入 `AgentSessionRead.runtime_online`（参照 title/current_run_id 现有 router 注入范式 schema.py:34-37）。
4. `frontend/src/components/daemon/session-list-layout.tsx`：`SessionListEntry`(:19) 加 `runtimeOnline?: boolean` 字段；`runtimeOnline===false` 时行内渲染「daemon 离线」徽标（warn 色，复用 Badge 组件:15）。调用方（RuntimeSessionDialog/ChangeSessionSection）map 时透传。

## 验收标准（acceptance）

- [ ] `AgentSessionRead` 含 `runtime_online: bool` 字段，运行时 join 计算不入库（非表列）。
- [ ] `runtime_online = (now - daemon_runtimes.last_heartbeat_at) < runtime_stale_seconds(45s)`；runtime_id NULL → False。
- [ ] `list_agent_sessions` / `get_agent_session` 均返回正确 runtime_online（含跨成员/软删过滤不回归）。
- [ ] 前端 `runtime_online=false` 显示「daemon 离线」徽标；`true`/undefined 不显示。
- [ ] 守护测试钉死：心跳新鲜(<45s)→True；心跳超时(>45s)→False；runtime_id NULL→False。
- [ ] 零回归：现有 session 列表/详情/软删/分页测试全绿。

## verify

- backend pytest daemon session 测试全绿（含新增 runtime_online 守护测试）。
- frontend vitest session-list-layout 离线徽标渲染测试通过。
- `runtime_online` 断言只读、未触发任何 session status 写/自动 end。

## 约束（constraints）

- 不加自动 end/failed/abandoned（D-004@v1 手动哲学）。
- 不加 session age timeout（非目标 design §3）。
- 只加可见性不自动操作 session 状态。
- `runtime_online` 不入库（运行时 join 计算），不加 AgentSession 列、不加 migration。
- 心跳判活复用 `daemon_instances.last_heartbeat_at` 真相源（runtime/service.py:757-765 已统一，不回退 per-runtime 判定）。

## 依赖说明

task-02（config runtime_stale_seconds 已有保留，确认 settings 读取链路）；FR-06；D-004@v1。
