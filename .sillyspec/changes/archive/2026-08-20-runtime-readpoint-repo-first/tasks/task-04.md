---
schema_version: 1
doc_type: task
id: task-04
title: Daemon daemon.ts wiring for root_path
title_zh: daemon.ts 透传 root_path 与 rootsProvider 注入
author: qinyi
created_at: 2026-08-20T11:05:00+08:00
change_name: 2026-08-20-runtime-readpoint-repo-first
wave: 2
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/runtime-handler.test.ts
depends_on: [task-01]
provides:
  - _registerRuntimeRpcHandler 四方法透传 params.root_path
expects_from:
  - task-01: normalizeRootPathParam（RPC 参数归一）、RuntimeHandler 构造参数 rootsProvider
goal: RPC 参数从 ws 层接进 RuntimeHandler 读点选择
implementation: _registerRuntimeRpcHandler 内 const rootPath = normalizeRootPathParam(params.root_path) 传入四方法；类字段构造点（daemon.ts:784）注入 rootsProvider: () => this._effectiveAllowedRoots()；normalizeRootPathParam 归一行为（非字符串→undefined）在 runtime-handler.test.ts 补用例
acceptance: pnpm typecheck 通过；normalizeRootPathParam 用例（字符串原样/非字符串 undefined/空串 undefined）全绿
verify: cd sillyhub-daemon && pnpm typecheck && pnpm exec vitest run tests/runtime-handler.test.ts
constraints: 构造注入走类字段初始化处，不在 _registerRuntimeRpcHandler 内 new（对齐现有 this._runtimeHandler 单例字段）
---

# task-04：daemon.ts 接线

依据：design.md §5.2；plan-review 建议（注册器级归一用例）。
