---
id: task-05
title: lib machine 类型+函数+query-keys（覆盖 FR-1,2,3）
author: WhaleFall
created_at: 2026-07-07 16:30:00
priority: P0
depends_on: [task-03]
blocks: [task-06, task-08, task-09]
requirement_ids: [FR-1, FR-2, FR-3]
decision_ids: []
allowed_paths:
  - frontend/src/lib/daemon.ts
  - frontend/src/lib/query-keys.ts
provides:
  - contract: DaemonMachineRead
    fields: [id, hostname, display_alias, os, arch, status, last_heartbeat_at, version, build_id, created_at, owner, runtime_count, online_runtime_count, runtimes]
  - contract: DaemonMachineListParams
    fields: [q, status, provider, user_id, limit, offset]
  - contract: DaemonMachineListResponse
    fields: [items, total, limit, offset]
  - contract: DaemonMachineUpdate
    fields: [display_alias]
  - contract: listDaemonMachines
    fields: [params, response]
  - contract: updateDaemonMachine
    fields: [instanceId, input, response]
  - contract: triggerMachineSelfUpdate
    fields: [instanceId, response]
expects_from: {}
---

## goal
新增前端 machine 级类型与 API 客户端函数（+ query-key），供 task-06 hook、task-08/09 组件消费，字段对齐后端 task-01 DTO（design §5.1）。

## implementation
- `frontend/src/lib/daemon.ts` 新增：
  - `interface DaemonMachineRead`（id/hostname/display_alias/os/arch/status/last_heartbeat_at/version/build_id/created_at 均对齐 §5.1；`owner?: OwnerRead | null` 复用既有 `OwnerRead`；`runtimes: DaemonRuntimeRead[]` 复用既有类型；派生 `runtime_count: number` / `online_runtime_count: number`）。
  - `interface DaemonMachineListParams { q?; status?; provider?; user_id?; limit?; offset? }`、`interface DaemonMachineListResponse { items; total; limit; offset }`、`interface DaemonMachineUpdate { display_alias?: string | null }`。
  - `listDaemonMachines(params?)` → `apiFetch<DaemonMachineListResponse>("/api/daemon/machines", { query: params })`（仿 `listDaemonRuntimesPage`）。
  - `updateDaemonMachine(instanceId, input)` → `apiFetch<PATCH>("/api/daemon/machines/${encodeURIComponent(instanceId)}", { method:"PATCH", json: input })` 返回 `DaemonMachineRead`（仿 `updateDaemonRuntime`）。
  - `triggerMachineSelfUpdate(instanceId)` → `apiFetch<POST>("/api/daemon/machines/${encodeURIComponent(instanceId)}/self-update", { method:"POST" })` 返回 `{ sent: boolean; latest_version: string }`（仿 `triggerDaemonSelfUpdate`）。
- `frontend/src/lib/query-keys.ts` 新增 `daemonMachines: { all: ["daemonMachines"] as const, list: (params: DaemonMachineListParams) => ["daemonMachines","list",params] as const }`，并 import `DaemonMachineListParams`（对齐 `daemonRuntimes` 模式）。

## 验收标准
- 上述 3 类型 + 3 函数 + `daemonMachines` query-key 均可从 `@/lib/daemon`、`@/lib/query-keys` import。
- 字段命名/可空性与后端 task-01 DTO（`DaemonMachineRead`/`DaemonMachineListResponse`/`DaemonMachineUpdate`）1:1 对齐。
- `cd frontend && pnpm exec tsc --noEmit` 通过；`cd frontend && pnpm lint` 通过。
- 不破坏现有 `daemon.ts` 导出（`DaemonRuntimeRead`/`listDaemonRuntimesPage`/`updateDaemonRuntime`/`triggerDaemonSelfUpdate` 等签名不变）；不改动 `daemonRuntimes` query-key。

## verify
- `cd frontend && pnpm exec tsc --noEmit`
- `cd frontend && pnpm lint`

## constraints
- 复用既有 `apiFetch`、`OwnerRead`、`DaemonRuntimeRead`，不新建并行类型。
- 不改动现有 daemon.ts 导出与 `daemonRuntimes` key；新增项与既有命名风格一致（蛇形字段、驼峰函数）。
- `instanceId` 路径段一律 `encodeURIComponent`；mutation 端点 body 用 `json:`，不手拼。
- 不内联用量（用量走 `/runtimes/usage`，task-06 处理，D-004）。
