---
author: qinyi
created_at: 2026-09-09 20:54:48
---
# 任务清单（Tasks）

> 唯一真相文件（plan 阶段已展开；plan.md Wave 段按 ID 引用本表分组）。

## Wave 1 — 根解析核心 + backend 契约（可并行；03→04 建议串行）

- [x] task-01: sillyspec-manager workspaceId 参数化 + workspace_root_unknown 两态语义 + manager 侧测试 (depends_on: —) [target: sillyhub-daemon/src/sillyspec-manager.ts, sillyhub-daemon/tests/sillyspec-conflict-snapshot.test.ts, sillyhub-daemon/tests/sillyspec-platform-command.test.ts]
- [x] task-03: backend compare _fetch_snapshot 透传 workspace_id + ensure_workspace_member 公开(action 参数) + 测试 (depends_on: —) [target: backend/app/modules/daemon/sillyspec_compare.py, backend/app/modules/daemon/tests/test_sillyspec_compare.py]
- [x] task-04: backend resolve 契约（请求体必填 + WS payload + 成员校验）+ 测试 (depends_on: task-03) [target: backend/app/modules/daemon/router/machines.py, backend/app/modules/daemon/ws_hub.py, backend/app/modules/daemon/tests/test_sillyspec_platform_commands.py]

## Wave 2 — daemon 接线 + 可选文案

- [x] task-02: daemon.ts 接线（statusRootFor 注入 / RPC+RESOLVE 透传 / Executor 签名 / _noteSillySpecStatusRoot 防投毒）+ heartbeat 测试 (depends_on: task-01) [target: sillyhub-daemon/src/daemon.ts, sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts]
- [x] task-05: 502 网关文案按 daemon_code 分叉（可选 FR-06） (depends_on: task-03) [target: backend/app/modules/daemon/sillyspec_compare.py]

## Wave 3 — 契约同步 + 前端

- [x] task-06: pnpm gen:types + conflict-compare-modal workspace_id 下传 + 前端测试 (depends_on: task-04) [target: frontend/src/lib/api-types.ts, backend/openapi.json, frontend/src/components/changes/conflict-compare-modal.tsx, frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx]
