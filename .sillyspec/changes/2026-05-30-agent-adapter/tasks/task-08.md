---
author: qinyi
created_at: 2026-05-30T19:00:00
id: task-08
title: Agent API 客户端 + 类型
priority: P0
estimated_hours: 1
depends_on: [task-05, task-06, task-07]
blocks: [task-09, task-10]
allowed_paths:
  - frontend/src/lib/agent.ts
---

# task-08: Agent API 客户端 + 类型

## 修改文件（必填）

- `frontend/src/lib/agent.ts` — 补充 Kill 相关接口和类型

## 实现要求

现有 `agent.ts` 已包含 `AgentRun`、`AgentRunLogEntry`、`CreateAgentRunInput` 等类型和 `createAgentRun`、`getAgentRun`、`listAgentRuns`、`getAgentRunLogs`、`streamAgentRunLogs` 函数。

本任务需要补充：

1. `AgentKillResponse` 接口类型
2. `killAgentRun` 函数
3. 确保 `AgentRun` 接口包含 `diff_summary` 字段（已存在则跳过）
4. 确保 `AgentRunStatus` 包含 `"killed"` 值（已存在则跳过）

## 接口定义（代码类任务必填）

### 新增类型

```typescript
/** Kill API 响应 */
export interface AgentKillResponse {
  id: string;
  status: "killed";
}
```

### 新增函数

```typescript
/**
 * 终止一个正在运行的 Agent Run。
 * POST /api/workspaces/{workspaceId}/agent/runs/{runId}/kill
 *
 * @throws ApiError(404) — run 不存在
 * @throws ApiError(409) — run 不在 running/pending 状态
 * @throws ApiError(403) — 无权限
 */
export function killAgentRun(workspaceId: string, runId: string) {
  return apiFetch<AgentKillResponse>(
    `/api/workspaces/${workspaceId}/agent/runs/${runId}/kill`,
    { method: "POST" },
  );
}
```

### 现有类型确认（已存在，无需修改）

```typescript
// 已存在，确认包含 diff_summary 字段
export interface AgentRun {
  id: string;
  task_id: string;
  // ...
  diff_summary: string | null;  // ← 已存在
  // ...
}

// 已存在，确认包含 "killed"
export type AgentRunStatus = "pending" | "running" | "completed" | "failed" | "killed";
```

## 边界处理（必填）

1. **Kill 返回类型**：`AgentKillResponse.status` 固定为 `"killed"` 字面量类型
2. **错误处理**：不做客户端特殊处理，由 `apiFetch` 抛出 `ApiError`（404/409/403），调用方自行处理
3. **workspaceId / runId 格式**：调用方负责传入有效的 UUID 字符串，本函数不做格式校验

## 非目标（本任务不做的事）

- 不修改页面组件（task-09/10 职责）
- 不添加新的 UI 组件
- 不修改 `api.ts` 基础设施
- 不修改后端代码
- 不重复定义已存在的类型

## 参考

- 现有文件：`frontend/src/lib/agent.ts` — 已有的 API 客户端模式
- 后端 schema：`backend/app/modules/agent/schema.py` 第 44-47 行 `AgentKillResponse`
- 后端路由：`backend/app/modules/agent/router.py` — Kill 端点签名

## TDD 步骤

### 步骤 1：修改 agent.ts

在现有文件底部追加 `AgentKillResponse` 接口和 `killAgentRun` 函数。

### 步骤 2：类型检查

```bash
cd frontend
npx tsc --noEmit
```

### 步骤 3：lint 检查

```bash
npx next lint
```

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `AgentKillResponse` 接口定义正确 | 包含 `id: string` 和 `status: "killed"` |
| AC-02 | `killAgentRun` 函数存在 | 可被 `import { killAgentRun } from "@/lib/agent"` 导入 |
| AC-03 | TypeScript 编译通过 | `npx tsc --noEmit` 无错误 |
| AC-04 | ESLint 检查通过 | `npx next lint` 无新增 warning |
| AC-05 | 不破坏现有代码 | 现有导入和函数调用不受影响 |
