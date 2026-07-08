---
id: task-06
title: 新增 useDaemonMachines hook（覆盖 FR-4,6）
author: WhaleFall
created_at: 2026-07-07 16:30:00
priority: P0
depends_on: [task-05]
blocks: [task-09]
requirement_ids: [FR-4, FR-6]
decision_ids: [D-004]
allowed_paths:
  - frontend/src/lib/use-daemon-machines.ts
provides:
  - contract: useDaemonMachines
    fields: [items, total, sessions, isLoading, isFetching, isError, error, refetch]
expects_from:
  task-05:
    - contract: listDaemonMachines
      needs: [params, response]
    - contract: DaemonMachineRead
      needs: [runtimes, runtime_count, online_runtime_count]
    - contract: queryKeys.daemonMachines.list
      needs: [params-key]
---

## goal
机器列表 + 会话组合查询 hook，15s 轮询；用量走单独端点 `getRuntimesUsage` 不入此 hook（D-004）。

## implementation
- 新建 `frontend/src/lib/use-daemon-machines.ts`，仿 `use-daemon-runtimes.ts` 结构。
- 定义 `interface DaemonMachinesData { items: DaemonMachineRead[]; total: number; sessions: AgentSessionRead[] }`。
- `useQuery`：`queryKey = queryKeys.daemonMachines.list(params)`。
- `queryFn`：`Promise.all([ listDaemonMachines(params), listAgentSessions({ limit: 100 }).catch(() => null) ])`，返回 `{ items: resp.items, total: resp.total, sessions: sessionsResp?.items ?? [] }`。
- `refetchInterval: 15000`（无条件轮询，对齐现有 runtimes hook）。
- 返回 `{ items, total, sessions, isLoading, isFetching, isError, error, refetch }`。

## 验收标准
- hook 可正常导入调用，`items`/`total`/`sessions` 默认空值。
- `params` 进入 queryKey，过滤/分页变化触发新查询。
- sessions 拉取失败时降级为 `[]`，不阻塞列表渲染。
- 用量不在本 hook 拉取（由 page 单独调 `getRuntimesUsage`）。
- `cd frontend && pnpm exec tsc --noEmit` 通过。

## verify
- `cd frontend && pnpm exec tsc --noEmit`

## constraints
- 用量仍由 page 调 `getRuntimesUsage(window)` 单独管（D-004，不内联 `/machines`）。
- 不删 `use-daemon-runtimes.ts`（保留兼容）。
- 复用现有 `listAgentSessions`，不新增会话接口。
- 不写实现代码细节到本卡（执行阶段在 execute 完成）。
