---
schema_version: 1
doc_type: module-card
module_id: lib-workspace-context
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 工作区上下文三件套（lib-workspace-context）

## 定位
工作区上下文三件套，串起「当前在哪个工作区、绑没绑 daemon、daemon 在不在线、怎么切过去」四件事：
- `src/lib/use-workspace-context.ts`（131 行）— 组合 hook：URL 派生（真相源）+ store 缓存 + daemon 在线聚合 + switchWorkspace 切同模块路径替换（change 2026-07-09-workspace-prioritization task-04 / FR-01 / D-002）。
- `src/lib/workspace-binding.ts`（155 行）— per-member daemon 绑定 API：自有 binding 读写、批量拉取、daemon 共享（lender 标记 / owner 查询撤销）、借用门禁（change 2026-07-01-collaborative-workspace task-03/10 + 2026-07-25-daemon-borrow-for-business task-12/13）。
- `src/lib/workspace-daemon-status.ts`（131 行）— daemon 在线状态批量聚合（同 change task-03 / FR-06 / R-02）。

核心设计约束：**URL 是真相源，store 仅叠加缓存**；刷新后由 hook 从 URL 重建。实测消费方：workspace-switcher.tsx 与 app-shell.tsx（useWorkspaceContext）、workspace-binding-guard / workspace-config-card / workspace-path-picker / shared-daemon-manager / shared-daemon-toggle / shared-daemon 系列与多个 workspace 页面（binding/status）；agent 域 borrow-trigger-contract 测试锁借用契约。

## 契约摘要
use-workspace-context.ts：
- `useWorkspaceId(): string | null` — pathname 按 `/^\/workspaces\/([^/]+)/` 解析；非 workspace 路径返 null。
- `buildSwitchPath(pathname, targetId): string` — 纯函数（可单测）：替换 wsId 段，**保留首个模块段、截断更深子路径**（`/workspaces/A/changes/123` → `/workspaces/B/changes`，防目标工作区无对应条目 404，D-002/R-05 已接受）；无模块段 → `/workspaces/{targetId}`；非 workspace 路径降级 `/workspaces/{targetId}` 守卫兜底。
- `useWorkspaceContext()` → `{ workspaceId, current, daemonOnline, switchWorkspace }` — current 来自 `useWorkspaceStore`；switchWorkspace = `router.push(buildSwitchPath(...))`。

workspace-binding.ts：
- `fetchMyBinding(workspaceId): Promise<MemberBindingView | null>` — 单工作区自有 binding，无 binding / 请求失败均返 null（前端展示 access guide）。
- `fetchMyBindings(): Promise<MemberBindingView[]>` — 全量自有 binding（前端自行按 workspace_id 索引），失败降级 []（列表卡片不阻塞）。
- `upsertMyBinding(workspaceId, req: MemberBindingUpsertRequest)` — PUT /api/workspaces/{ws}/my-binding。
- `setMyBindingShared(workspaceId, shared: boolean)` — lender 标记/撤销自己 binding 的 daemon 共享（PUT .../my-binding/shared；未配置 binding 409 直通）。
- `fetchSharedDaemons(workspaceId): Promise<SharedDaemonView[]>` — owner 查全部共享 daemon（非 owner 403 降级 []，管理卡片静默）。
- `revokeSharedDaemon(workspaceId, lenderUserId)` — owner 撤销某成员共享（DELETE .../members/{uid}/shared；置 shared=False 不删行，无 binding 409 直通）。
- `canBorrowSharedDaemon(permissions, isPlatformAdmin): boolean` — 纯函数：isPlatformAdmin 短路 OR 权限并集含 `daemon:borrow`（`DAEMON_BORROW_PERMISSION` 常量与后端 auth/permissions.py 对齐）。
- 类型：`MemberBindingView` / `MemberBindingUpsertRequest` / `SharedDaemonView` 从 api-types 生成类型派生；`MemberBindingWithShared` 是历史别名（= MemberBindingView）。

workspace-daemon-status.ts：
- `DaemonStatusEntry { daemon_id: string | null; online: boolean; status: string | null }`。
- `aggregateDaemonStatus(bindings, instances): Record<workspace_id, DaemonStatusEntry>` — 纯函数。
- `useDaemonStatusMap(): { statusMap, isLoading, isError }` — react-query，`WORKSPACE_DAEMON_STATUS_QUERY_KEY`（就地常量），refetchInterval 30s。

## 关键逻辑
```
useWorkspaceContext():
  workspaceId ← useWorkspaceId()(URL); current ← useWorkspaceStore
  daemonOnline = statusMap[workspaceId]?.online ?? false
  effect: workspaceId 变 且 ≠ current.id →
    setCurrent({ id: workspaceId, name: "", daemon_id: status?.daemon_id, daemon_online: status?.online })
  // id 一致则不重写（幂等，不覆盖切换器/列表页写入的完整 current）
aggregateDaemonStatus(bindings, instances):
  instanceById = Map(instances)
  daemon_id=null            → { daemon_id:null, online:false, status:null }   // 未绑定
  instanceById 缺该 id       → { daemon_id, online:false, status:null }        // 已下线/无权，不抛错
  否则                       → online = (instance.status === "online")         // maintenance/disabled/offline 均视为离线
```

## 注意事项
- daemonOnline 按 **workspace_id** 查 statusMap（Record 按 binding.workspace_id 索引，非按 daemon_id）；无 workspaceId 或无条目 → false。
- online 判定是严格等于 `"online"`：maintenance/disabled/offline 统一按离线展示（对齐 design D-005「离线仅显示不阻断」）；instance 级别不带 last_heartbeat_at（那是 runtime 级字段）。
- hook 的 current 填充是**最小自洽**策略：name 只能由消费方（切换器有列表项/app-shell）用列表数据覆盖；effect 的幂等保护依赖 id 一致判断，别改成无条件写。
- `canBorrowSharedDaemon` 只是门禁放宽的展示层（business_member 能点「启动扫描」），权威三重校验在后端 placement `_resolve_borrowed_or_own_runtime`；前端按 `/api/auth/me` 的权限并集（platform ∪ all-workspace）判断，误判会收到 403/422。
- 三个 fetch（fetchMyBinding / fetchMyBindings / fetchSharedDaemons）都是**降级语义**（null/[]），调用方无法区分「无数据」与「请求失败」——这是刻意的 UI 不阻塞取舍。
- 30s 轮询是刻意节奏：daemon status 由后端心跳驱动非秒级变化，且切换器常驻顶栏；别对齐 use-daemon-machines 的 15s。
- `useDaemonStatusMap` 内 `listDaemonInstances().catch(() => [])` 保证 instances 失败不阻塞；isError 实际恒 false（两数据源都被 catch 降级），仅作透传。
- buildSwitchPath 不做 URL 编码（targetId 原样拼段，编码交给 router.push）。
- 单测落位：`src/lib/__tests__/use-workspace-context.test.ts` 与 `workspace-daemon-status.test.ts`（都用 renderHook + QueryClientProvider，故在 vitest node 环境白名单外、走 jsdom）；binding 的测试是同层 colocated `src/lib/workspace-binding.test.ts`（node 白名单内）。改本模块行为先跑这三处。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
