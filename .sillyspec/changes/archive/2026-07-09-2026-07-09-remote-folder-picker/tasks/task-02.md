---
id: task-02
title: daemon.ts 注册 list_roots + 删 browse_folder handler
wave: W1
depends_on:
  - task-01
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
author: WhaleFall
created_at: 2026-07-09 09:55:00
no_deps_verify: true
goal: |
  daemon.ts 注册 list_roots RPC handler；删除 browse_folder handler。FR-1 / FR-5 / D-006。
implementation: |
  - _registerListDirRpcHandler(:2095-2158) 内新增 registerRpcHandler('list_roots',()=>listRoots())。
  - import listRoots；删除 browse_folder handler(:2114 起)；核验 import 未 unused。
acceptance: |
  - list_roots RPC 可响应；browse_folder handler 已删；无 unused import；typecheck 过。
verify: |
  - cd sillyhub-daemon && pnpm test
  - cd sillyhub-daemon && pnpm typecheck
constraints: |
  - 注册宿主 _registerListDirRpcHandler；依据 design §6/§7.1。
---

# task-02 · daemon.ts 注册 list_roots + 删 browse_folder

> Wave W1 · daemon · FR-1 / FR-5 / D-006 · design §6/§7.1

## 验收标准
- [ ] daemon WS `list_roots` RPC 可响应 `{roots}`
- [ ] `browse_folder` handler 代码段已移除
- [ ] 无 unused import 警告
- [ ] `pnpm typecheck` 通过

## TDD/验证步骤
- 测试：list_roots 已注册 / browse_folder 不存在
- `cd sillyhub-daemon && pnpm test` + `pnpm typecheck`
