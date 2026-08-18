---
schema_version: 1
doc_type: module-card
module_id: lib-use-agent-runs
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 运行记录列表 hook（lib-use-agent-runs）

## 定位

agent 运行记录列表的 react-query 数据 hook（D-003@v1 / FR-04）：封装
`listAgentRuns` 并做 **5s 条件轮询**——仅当列表里还有 `status==="running"` 的
run 时才继续轮询，全部静止即停，避免空转请求。

## 契约摘要

- `useAgentRuns(workspaceId)` → `{ runs: AgentRun[]; isLoading; isFetching;
  isError; error: ApiError; refetch }`；`runs` 无数据时兜底 `[]`。
- `agentRunsRefetchInterval(runs: AgentRun[] | undefined): number | false` —
  纯函数谓词，含 running 返回 `5000`，否则 `false`（undefined/空不轮询）；
  单独导出便于单测。

## 关键逻辑

```
useQuery(queryKeys.agentRuns.list(workspaceId), () => listAgentRuns(workspaceId),
         refetchInterval: q => agentRunsRefetchInterval(q.state.data))
```

## 注意事项

- 轮询判定只认 `"running"`（对齐 agent 页 runningRuns 过滤），pending/completed
  等不算——改判定先确认页面口径。
- queryKey 来自 `lib/query-keys.ts`（lib-react-query 模块），queryFn 直接复用
  `lib/agent` 的 `listAgentRuns`，鉴权与 ApiError 处理天然衔接，本模块零请求代码。
- 消费方为 workspace agent 页运行列表；单测
  `lib/__tests__/use-agent-runs.test.tsx`。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
