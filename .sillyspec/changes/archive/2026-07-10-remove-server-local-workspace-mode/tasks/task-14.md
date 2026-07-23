---
id: task-14
title: 前端组件测试精简 + vitest + typecheck 守回归
title_zh: 前端测试精简与类型守卫
author: qinyi
created_at: 2026-07-10 23:45:39
priority: P1
depends_on: [task-10, task-11, task-12]
blocks: [task-15]
requirement_ids: [FR-8, R-03]
decision_ids: [D-001]
allowed_paths:
  - frontend/src/**/__tests__/**
---

## goal

移除前端测试套件中所有 server-local 相关分支断言（radio/本地扫描 case/pathSource='server-local' fixture/isServerLocal 分支断言/canUseServerLocal 相关断言），同时保留 `workspace:admin` 权限枚举测试（D-001 不动权限），并通过 `pnpm test` + `pnpm typecheck` 守护 api-types.ts 删字段后无残留引用导致的类型回归（R-03）。

## implementation

> 前置：task-10（组件群改完）/ task-11（lib+pages 改完）/ task-12（api-types.ts 已删 path_source/daemon_runtime_id）。

1. **组件测试精简**（allowed_paths 限定 `frontend/src/**/__tests__/**`）：
   - `components/__tests__/workspace-scan-dialog*`：无独立测试文件（组件在 task-10），跳过。
   - `components/__tests__/workspace-access-guide.test.tsx`：删 server-local 分支断言、路径来源下拉相关 case。
   - `components/__tests__/workspace-config-card.test.tsx`：删 isServerLocal 分支断言。
   - `components/workspace-binding-dialog.test.tsx`：删 server-local 相关 case。
   - `components/__tests__/workspace-card.test.tsx`：删 path_source 读取断言（原读 path_source==='server-local' 等）。
   - `components/__tests__/workspace-switcher.test.tsx` / `__tests__/workspace-daemon-switcher.test.tsx`：删 server-local 分支。
   - `lib/__tests__/workspace-path.test.ts`：删二元映射（server-local↔本地路径）case，仅保留 daemon-client 映射。
   - `lib/__tests__/workspace-daemon-status.test.ts`：删 path_source 相关断言。
   - `lib/__tests__/scan-docs-tree.test.ts`：若 fixture 含 pathSource 分支则删。
   - `lib/workspaces.test.ts`：删 path_source 入参相关 case。

2. **页面测试精简**：
   - `app/(dashboard)/workspaces/__tests__/page.test.tsx`：删「本机路径」筛选 option 断言。
   - `app/(dashboard)/workspaces/[id]/page.test.tsx` + `[id]/__tests__/page-sync.test.tsx`：删 server-local 分支 case。
   - `app/(dashboard)/workspaces/[id]/agent/__tests__/page.test.tsx`：删 server-local 分支。
   - `app/(dashboard)/workspaces/[id]/create-change/__tests__/page.test.tsx`：永远走 proxyCreateChange 的断言保留，删 server-local 分支。

3. **fixture 默认值迁移**：所有测试 fixture 中 `pathSource: 'server-local'` / `path_source: 'server-local'` 默认值改为 `'daemon-client'`（跟随 api-types.ts 字段删除后组件默认）。

4. **权限测试保留**（D-001）：
   - `lib/__tests__/menu-permissions.test.ts` 的 `workspace:admin` 断言保留。
   - `components/__tests__/admin-role-permission-picker.test.tsx` + `lib/__tests__/permission.test.ts` 中 workspace:admin 权限枚举断言保留。
   - 这些文件若不含 path_source/server-local 断言则本任务不动。

5. **回归守护**：
   - `cd frontend && pnpm test`：全量 vitest 全绿。
   - `cd frontend && pnpm typecheck`：tsc 守类型，确保 api-types.ts 删字段后无残留引用（R-03）。

## 验收标准

- 所有 server-local 相关测试 case 删除或改为 daemon-client 默认值。
- `workspace:admin` 权限枚举/菜单绑定/角色赋权测试保留（D-001）。
- `pnpm test` 全绿，无 failed/skip 掩盖。
- `pnpm typecheck` 全绿，无 api-types 字段删除后的残留引用报错（R-03）。

## verify

```bash
cd frontend && pnpm test && pnpm typecheck
```

- vitest 报告全 passed（无 server-local 断言失败）。
- tsc 报告无错误（api-types.ts 删字段后所有引用点已由 task-10/11/12 清干净）。

## constraints

- 只动测试文件（allowed_paths `frontend/src/**/__tests__/**`，含同级 binding-dialog.test.tsx）；组件/lib 源码改动属 task-10/11，本任务不越界。
- typecheck 是 R-03 的硬守卫：api-types.ts 删 path_source/daemon_runtime_id 后若有残留引用，typecheck 必失败——失败时回查 task-10/11/12 遗漏点而非在测试里打补丁。
- `workspace:admin` 权限测试一律保留（D-001：权限枚举不动，仅删运行时门禁 `_require_server_local_workspace_admin`）。
- 不新增测试（纯精简 + 守护），不改测试框架配置。
