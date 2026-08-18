---
schema_version: 1
doc_type: module-card
module_id: lib-use-daemon-machines
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 机器列表数据 hook（lib-use-daemon-machines）

## 定位

daemon 机器列表的机器级数据 hook（会话门户/runtimes 页共用）：一次查询并发拉取
机器分页列表 + 最近会话列表，组合成单一 `useQuery` 结果；15s 无条件轮询。

## 契约摘要

- `useDaemonMachines(params: DaemonMachineListParams)`（类型来自 `lib/daemon`）→
  `{ items: DaemonMachineRead[]; total: number; sessions: AgentSessionRead[];
  isLoading; isFetching; isError; error: ApiError; refetch }`；
  各字段无数据时兜底空数组 / 0。
- queryKey 为 `queryKeys.daemonMachines.list(params)`——params 进 key，
  过滤/分页条件变化即自动停旧启新。

## 关键逻辑

```
queryFn = Promise.all([
  listDaemonMachines(params),
  listAgentSessions({ limit: 100 }).catch(() => null),   // 失败降级不阻塞
]) → { items, total, sessions: sessionsResp?.items ?? [] }
refetchInterval: 15000（无条件）
```

## 注意事项

- sessions 查询失败 `.catch(null)` 降级为 `[]`——机器列表照常渲染，只有会话
  徽标/计数缺失，不整块报错。
- **用量统计不走本 hook**（D-004）：runtimes 页单独调
  `getRuntimesUsage(window)` 管理，勿内联进 `/machines` 查询。
- 依赖 `lib/daemon` 的 `listDaemonMachines` / `listAgentSessions` 与
  `lib/query-keys`（lib-react-query）；单测
  `lib/__tests__/use-daemon-machines.test.ts`。
- 消费方：`app/(dashboard)/runtimes/page.tsx`、`app/(dashboard)/sessions/page.tsx`
  及 components-sessions 面板。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
