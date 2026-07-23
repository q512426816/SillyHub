---
id: task-03
title: 新建 frontend/src/lib/workspace-daemon-status.ts — daemon 在线状态聚合，导出 useDaemonStatusMap（fetchMyBindings 批量 + listDaemonInstances 映射 daemon_id→online）
title_zh: daemon 在线状态批量聚合 hook
author: qinyi
created_at: 2026-07-09 22:47:13
priority: P0
wave: W1
depends_on: []
blocks: [task-04, task-07, task-08]
allowed_paths:
  - frontend/src/lib/workspace-daemon-status.ts
covers:
  - FR-06
  - R-02
  - CB-4
---

## 目标

新建 `frontend/src/lib/workspace-daemon-status.ts`，导出 `useDaemonStatusMap()` 批量聚合「当前用户每个工作区绑定的 daemon 是否在线」，供 task-07（列表页状态徽标）/ task-08（顶栏切换器徽标）/ task-04（context hook 消费）统一消费。

落地 R-02 核心约束：`MemberBindingView` 不带 online 字段（仅 `daemon_id / root_path / path_source`），无法单接口拿全，必须「binding 列表 → daemon 实例列表」客户端映射。

## 实现

新建纯函数 + React hook，单一文件，无副作用 import。

1. **纯函数 `aggregateDaemonStatus`**（可单测，不依赖 React）：
   - 入参：`bindings: MemberBindingView[]`、`instances: DaemonInstanceRead[]`
   - 构建 `instanceById: Map<daemon_id, DaemonInstanceRead>`（键为 instance.id）
   - 输出 `Record<workspace_id, { daemon_id: string | null; online: boolean; status: string | null }>`
   - 遍历 bindings：`daemon_id` 为 null → `online: false`（未绑定）；否则查 instanceById，`online = instance?.status === "online"`，缺失实例视为离线（false，不抛错）。

2. **hook `useDaemonStatusMap()`**：
   - 并行调用 `fetchMyBindings()`（`lib/workspace-binding.ts`，批量，返回 `MemberBindingView[]`，失败降级 `[]`）+ `listDaemonInstances()`（`lib/daemon.ts`，返回 `DaemonInstanceRead[]`）
   - 用 React Query 的 `useQuery` 缓存（key 建议 `["workspace-daemon-status"]`），`refetchInterval` 设置 30~60s 轮询（切换器常驻，需反映 daemon 上下线；具体值实现时定，写进约束）
   - 返回 `{ statusMap: Record<...>, isLoading, isError }`；两接口各自降级为空数组时 `statusMap` 为 `{}`（不阻塞 UI）
   - 不在此 hook 写 store（写 store 是 task-04 的职责）

3. **类型导出**：`DaemonStatusEntry`（`{ daemon_id: string | null; online: boolean; status: string | null }`）供消费方引用。

## provides

- `useDaemonStatusMap()` → `{ statusMap: Record<workspace_id, DaemonStatusEntry>; isLoading: boolean; isError: boolean }`
- `aggregateDaemonStatus(bindings, instances)` → `Record<workspace_id, DaemonStatusEntry>`（纯函数，可单测）
- `DaemonStatusEntry` 类型

## expects_from

- `fetchMyBindings()` — 来自 `lib/workspace-binding.ts`（现有，批量返回 `MemberBindingView[]`，字段含 `workspace_id / daemon_id / root_path / path_source`，**无 online**）
- `listDaemonInstances()` — 来自 `lib/daemon.ts`（现有，返回 `DaemonInstanceRead[]`，字段含 `id / hostname / display_alias / status / providers`）
- React Query（项目已接入，参考既有 hook 用法）

## 验收标准

- `MemberBindingView` 无 online 字段时，通过 daemon_id→instance.status 映射正确得出 online（R-02 落地）
- 未绑定（daemon_id=null）的 ws → online=false，不报错
- daemon_id 指向的 instance 不在 instances 列表（已下线/无权）→ online=false，不抛错
- fetchMyBindings / listDaemonInstances 任一失败 → statusMap 降级为 `{}`，UI 不崩
- 列表页/切换器消费同一份 statusMap（单数据源，不重复请求）

## 验证

- `cd frontend && pnpm test` — 新增单测覆盖 `aggregateDaemonStatus` 纯函数（边界：未绑定 / 在线 / 离线 / instance 缺失 / 空输入）
- `cd frontend && pnpm typecheck` — 类型通过（MemberBindingView / DaemonInstanceRead 字段对齐）
- `cd frontend && pnpm lint` — 零 lint 错误

## 约束

- **CB-4 在线判定标准（已核实）**：`DaemonInstanceRead.status === "online"`（status 为字符串枚举 online/offline/maintenance/disabled，**不是** boolean `online`，也**没有** `is_online` / `last_seen` 字段——instance 级别不带 last_heartbeat_at，那是 runtime 级 `DaemonRuntimeRead` 的字段）。本次只用 `status === "online"` 判定，maintenance/disabled/offline 统一视为「离线」（online=false），与 D-005「离线仅显示不阻断」一致。
- `allowed_paths` 只允许新建 `workspace-daemon-status.ts`；不修改 workspace-binding.ts / daemon.ts（仅 import 复用）。
- daemon 状态为只读消费，不新增任何 daemon 生命周期事件 / lease / session 改动（design §7.5）。
- refetchInterval 实现时选定一个固定值（建议 30s~60s 区间），在文件顶部注释写明选择理由；避免高频请求打满后端。
