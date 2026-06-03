---
author: qinyi
created_at: 2026-06-02T16:21:37
id: task-04
title: "前端 `StreamLogEvent` 增加 `log_id` 字段 + `getAgentRunLogs` 支持 `after` 参数"
priority: P0
estimated_hours: 0.5
depends_on: [task-01]
blocks: [task-05, task-06]
allowed_paths:
  - frontend/src/lib/agent.ts
---

# task-04: 前端 `StreamLogEvent` 增加 `log_id` 字段 + `getAgentRunLogs` 支持 `after` 参数

## 修改文件

- `frontend/src/lib/agent.ts` — `StreamLogEvent` 接口 + `getAgentRunLogs` 函数

## 实现要求

1. `StreamLogEvent` 接口增加 `log_id: string | null` 字段（UUID 字符串）
2. `getAgentRunLogs` 函数增加 `after` 可选参数（UUID 字符串），拼接到 query string

**重要**：`log_id` 是 UUID 字符串，不是 number。`AgentRunLog.id` 在后端是 UUID。

## 接口定义

```typescript
export interface StreamLogEvent {
  channel: AgentRunLogChannel;
  content: string;
  timestamp: string;
  log_id: string | null;  // 新增，UUID 字符串
}

export function getAgentRunLogs(
  workspaceId: string,
  runId: string,
  after?: string,  // 新增，UUID 字符串
) {
  const qs = after ? `?after=${encodeURIComponent(after)}` : "";
  return apiFetch<AgentRunLogEntry[]>(
    `/api/workspaces/${workspaceId}/agent/runs/${runId}/logs${qs}`,
  );
}
```

## 边界处理

- `log_id` 为 null：后端未 flush 时可能为 null，前端安全忽略，不做去重
- `after` 为 undefined 或空字符串：不拼 query string，向后兼容
- `AgentRunLogEntry.id` 也是 UUID string（与 `StreamLogEvent.log_id` 类型一致）
- `after` 参数值需要 `encodeURIComponent` 编码（含 `-` 等特殊字符）
- 不修改 `streamAgentRunLogs` 函数（保持向后兼容）

## 非目标

- 不重构现有 `streamAgentRunLogs` 函数
- 不修改 `page.tsx`
- 不创建新文件
- 不修改 `AgentRunLogEntry` 接口

## 参考

- `StreamLogEvent` 在 `agent.ts:72`
- `getAgentRunLogs` 在 `agent.ts:66`

## TDD 步骤

1. 写测试：解析含 `log_id` 的 SSE 事件，验证类型正确
2. 确认失败
3. 修改 `StreamLogEvent` 接口和 `getAgentRunLogs` 函数
4. 确认通过
5. 回归：不含 `log_id` 的旧事件仍可解析（log_id 为 null）

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `StreamLogEvent` 类型 | 包含 `log_id: string \| null` 字段 |
| AC-02 | `getAgentRunLogs(ws, run, "uuid-str")` | 请求 URL 包含 `?after=uuid-str` |
| AC-03 | `getAgentRunLogs(ws, run)` | 请求 URL 无 after 参数 |
| AC-04 | TypeScript 编译 | 无类型错误 |
