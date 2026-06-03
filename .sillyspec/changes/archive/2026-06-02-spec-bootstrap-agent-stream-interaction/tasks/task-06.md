---
id: task-06
title: 更新前端 API 类型和用户输入 API
priority: P0
estimated_hours: 2
author: qinyi
created_at: 2026-06-02T10:00:00
depends_on:
  - task-01
  - task-05
blocks:
  - task-07
  - task-08
allowed_paths:
  - frontend/src/lib/spec-workspaces.ts
  - frontend/src/lib/agent.ts
  - frontend/src/lib/__tests__/spec-workspaces.test.ts
  - frontend/src/lib/__tests__/agent.test.ts
---

# task-06: 更新前端 API 类型和用户输入 API

## 修改文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `frontend/src/lib/spec-workspaces.ts` | 将 `BootstrapResult` 从同步 CLI 输出模型改为异步 AgentRun stream 模型。 |
| 修改 | `frontend/src/lib/agent.ts` | 扩展 AgentRun 日志 channel 类型，新增用户指导输入提交 API。 |
| 新增或修改 | `frontend/src/lib/__tests__/spec-workspaces.test.ts` | 验证 bootstrap API wrapper 的 URL、method 和响应类型约定。 |
| 新增或修改 | `frontend/src/lib/__tests__/agent.test.ts` | 验证用户输入 API wrapper 的 URL、method、JSON body 和响应类型约定。 |

## 实现要求

1. 在 `frontend/src/lib/spec-workspaces.ts` 中更新 `BootstrapResult`，使其匹配新的 `POST /api/workspaces/{workspace_id}/spec-bootstrap` 响应：
   - `agent_run_id: string`
   - `stream_url: string`
   - `status: AgentRunStatus`
   - `spec_root: string`
   - `message: string`
2. `BootstrapResult.status` 应复用 `frontend/src/lib/agent.ts` 已有的 `AgentRunStatus` 类型，使用 `import type { AgentRunStatus } from "@/lib/agent";`，避免重复维护状态联合类型。
3. 删除或替换旧同步 bootstrap 字段的类型定义：`agent_exit_code`、`command`、`stdout`、`stderr`、`validation_passed`、`errors`、`warnings`、`sync_status`。不要在 API wrapper 中伪造这些旧字段。
4. 保持 `bootstrapSpecWorkspace(workspaceId)` 的函数名和调用路径不变，只更新返回类型。task-07 会负责更新 Workspace 详情页调用方。
5. 在 `frontend/src/lib/agent.ts` 中抽出并导出日志 channel 类型，例如 `AgentRunLogChannel`，至少覆盖：
   - `stdout`
   - `stderr`
   - `tool_call`
   - `pending_input`
   - `user_input`
6. 将 `AgentRunLogEntry.channel` 和 `StreamLogEvent.channel` 改为复用同一个 `AgentRunLogChannel` 类型。
7. 新增用户输入请求和响应类型：
   - `AgentRunInputRequest`
   - `AgentRunInputResponse`
8. 新增 `submitAgentRunInput(workspaceId, runId, input)` 函数，调用 `POST /api/workspaces/{workspaceId}/agent/runs/{runId}/input`，请求体为 `{ content: string }`，响应为 `{ run_id: string; accepted: boolean }`。
9. 继续使用项目现有 `apiFetch<T>()` 封装；不要引入新的 fetch helper、React Query、SSE helper 或状态管理。
10. 不修改页面、组件或文档。本任务只提供前端 API 层契约，task-07/task-08 负责 UI 消费。

## 接口定义

### `frontend/src/lib/spec-workspaces.ts`

```typescript
import { apiFetch } from "@/lib/api";
import type { AgentRunStatus } from "@/lib/agent";

export interface BootstrapResult {
  agent_run_id: string;
  stream_url: string;
  status: AgentRunStatus;
  spec_root: string;
  message: string;
}

export async function bootstrapSpecWorkspace(
  workspaceId: string,
): Promise<BootstrapResult> {
  return apiFetch<BootstrapResult>(
    `/api/workspaces/${workspaceId}/spec-bootstrap`,
    { method: "POST" },
  );
}
```

### `frontend/src/lib/agent.ts`

```typescript
export type AgentRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "killed";

export type AgentRunLogChannel =
  | "stdout"
  | "stderr"
  | "tool_call"
  | "pending_input"
  | "user_input";

export interface AgentRunLogEntry {
  id: string;
  run_id: string;
  timestamp: string;
  channel: AgentRunLogChannel;
  content_redacted: string;
}

export interface StreamLogEvent {
  channel: AgentRunLogChannel;
  content: string;
  timestamp: string;
}

export interface AgentRunInputRequest {
  content: string;
}

export interface AgentRunInputResponse {
  run_id: string;
  accepted: boolean;
}

export function submitAgentRunInput(
  workspaceId: string,
  runId: string,
  input: AgentRunInputRequest,
): Promise<AgentRunInputResponse> {
  return apiFetch<AgentRunInputResponse>(
    `/api/workspaces/${workspaceId}/agent/runs/${runId}/input`,
    { method: "POST", json: input },
  );
}
```

如后端在 task-05 最终命名中选择了不同响应字段，优先以后端测试和 OpenAPI/route 实现为准，但前端类型必须保持语义一致：提交用户指导后返回当前 `run_id` 和是否接受输入。

## 边界处理

- `BootstrapResult` 不再表达同步命令结果。调用方若需要日志或终态，必须使用 `agent_run_id` 连接 `streamAgentRunLogs()` 或读取 `/logs`，不要从 bootstrap 响应读取 `stdout/stderr`。
- `bootstrapSpecWorkspace()` 不负责轮询、连接 SSE、刷新 `SpecWorkspace` 或解释 run 终态；这些属于 task-07 的页面交互职责。
- `submitAgentRunInput()` 不在 wrapper 层 trim 或校验空字符串，避免改变用户原始输入；UI 层应在 task-07/task-08 禁用空内容提交，后端仍保留最终校验。
- `submitAgentRunInput()` 必须通过 `apiFetch` 发送 JSON，这样可继承 bearer token、401 refresh、`x-request-id` 和统一 `ApiError` 行为。
- `runId` 和 `workspaceId` 只做 URL 拼接，不在前端 wrapper 层验证归属；后端 task-05 负责校验 run 属于 workspace 且用户具备 `WORKSPACE_WRITE`。
- `AgentRunLogChannel` 扩展后，现有 `stdout/stderr/tool_call` 调用方应继续编译；新增 `pending_input/user_input` 只是让后续 UI 能安全分支展示。
- `streamAgentRunLogs()` 的运行时 JSON parse 行为保持不变。本任务只更新事件类型，不新增运行时 channel 校验，不因未知 channel 关闭 SSE。
- 如果 task-06 完成后 Workspace 详情页仍引用旧 `BootstrapResult.command/stdout/stderr` 字段，不要在本任务修改页面；该消费侧迁移由 task-07 处理。
- 测试中不要真实打开 `EventSource`；用户输入 API 是普通 POST，可以通过 mock `fetch` 或 mock `apiFetch` 验证。
- 保持导入风格一致：项目 API 模块优先使用 `@/lib/api`、`@/lib/...` 路径别名，不新增相对深层路径。

## 非目标

- 不修改 `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`。
- 不修改 `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx`。
- 不实现 bootstrap 日志面板、输入框、pending input UI 或错误提示 UI。
- 不修改后端 endpoint、权限校验、SSE replay 或 Redis publish 行为。
- 不新增完整交互式 session、暂停/恢复协议或 stdin 直连能力。
- 不更新 `.sillyspec/docs/frontend/scan/INTEGRATIONS.md`；文档同步由 task-09 处理。
- 不改变 `streamAgentRunLogs()` 的 URL 结构和 token query 认证方式。

## 参考

- `.sillyspec/changes/2026-06-02-spec-bootstrap-agent-stream-interaction/design.md`
  - 决策 1：`/spec-bootstrap` 异步返回 AgentRun。
  - 决策 4：用户确认/指导先落在 `AgentRunLog` 和 SSE。
  - API 设计：`POST /spec-bootstrap` 与 `POST /agent/runs/{run_id}/input`。
- `.sillyspec/changes/2026-06-02-spec-bootstrap-agent-stream-interaction/plan.md`
  - Wave 3：task-06 依赖 task-01、task-05，阻塞 task-07、task-08。
- `frontend/src/lib/spec-workspaces.ts`
  - 当前 `BootstrapResult` 仍是同步 CLI 输出模型，需要替换。
- `frontend/src/lib/agent.ts`
  - 已有 `AgentRunStatus`、`AgentRunLogEntry`、`StreamLogEvent`、`streamAgentRunLogs()`。
- `.sillyspec/docs/frontend/scan/INTEGRATIONS.md`
  - API 模块通过 Next.js rewrite 访问 `/api/*`。
  - SSE 使用 `EventSource` query token，普通 API 使用 `apiFetch` bearer token。
- `.sillyspec/docs/frontend/scan/CONVENTIONS.md`
  - API 模块内联定义类型。
  - 请求类型使用 `Input` / `Request` 后缀，响应类型使用 `Response` 后缀。
  - 统一通过 `apiFetch<T>()` 发起请求。

## TDD 步骤

1. 新增或更新 `frontend/src/lib/__tests__/spec-workspaces.test.ts`。
   - mock `global.fetch`，调用 `bootstrapSpecWorkspace("ws-1")`。
   - 断言请求 URL 包含 `/api/workspaces/ws-1/spec-bootstrap`。
   - 断言 method 为 `POST`。
   - 返回包含 `agent_run_id`、`stream_url`、`status`、`spec_root`、`message` 的 JSON，断言函数原样返回。
2. 新增或更新 `frontend/src/lib/__tests__/agent.test.ts`。
   - mock `global.fetch`，调用 `submitAgentRunInput("ws-1", "run-1", { content: "Use defaults and continue." })`。
   - 断言请求 URL 包含 `/api/workspaces/ws-1/agent/runs/run-1/input`。
   - 断言 method 为 `POST`。
   - 断言 `content-type` 为 `application/json`。
   - 断言 body JSON 等于 `{ "content": "Use defaults and continue." }`。
   - mock 响应 `{ "run_id": "run-1", "accepted": true }`，断言函数原样返回。
3. 更新 `frontend/src/lib/spec-workspaces.ts` 的类型和 import，确保没有残留旧 bootstrap 同步字段类型。
4. 更新 `frontend/src/lib/agent.ts` 的 channel 类型、日志 entry 类型、stream event 类型和 `submitAgentRunInput()`。
5. 运行目标测试：

```bash
cd frontend
pnpm test -- src/lib/__tests__/spec-workspaces.test.ts src/lib/__tests__/agent.test.ts
```

6. 如果只执行 task-06，暂不要求完整 `pnpm typecheck` 通过，因为现有 Workspace 详情页仍消费旧 `BootstrapResult` 字段，迁移由 task-07 处理。task-10 会在 task-07/task-08 完成后运行完整 typecheck。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 检查 `BootstrapResult` 类型 | 只包含新的 run/stream 字段：`agent_run_id`、`stream_url`、`status`、`spec_root`、`message`。 |
| AC-02 | 检查 `BootstrapResult.status` | 复用 `AgentRunStatus`，没有重复声明另一套 run 状态联合类型。 |
| AC-03 | 检查 `bootstrapSpecWorkspace()` | 函数名和路径保持不变，仍 POST `/api/workspaces/{workspaceId}/spec-bootstrap`。 |
| AC-04 | 搜索旧 bootstrap 字段 | `frontend/src/lib/spec-workspaces.ts` 中不再声明 `command/stdout/stderr/validation_passed/agent_exit_code` 等同步字段。 |
| AC-05 | 检查日志 channel 类型 | `AgentRunLogEntry.channel` 和 `StreamLogEvent.channel` 都复用 `AgentRunLogChannel`。 |
| AC-06 | 检查新增 channel | `AgentRunLogChannel` 至少包含 `pending_input` 和 `user_input`，且保留 `stdout/stderr/tool_call`。 |
| AC-07 | 检查用户输入请求类型 | 存在 `AgentRunInputRequest`，字段为 `content: string`。 |
| AC-08 | 检查用户输入响应类型 | 存在 `AgentRunInputResponse`，字段为 `run_id: string` 和 `accepted: boolean`。 |
| AC-09 | 检查 `submitAgentRunInput()` | POST `/api/workspaces/{workspaceId}/agent/runs/{runId}/input`，使用 `apiFetch` 和 `json: input`。 |
| AC-10 | 运行目标测试 | `pnpm test -- src/lib/__tests__/spec-workspaces.test.ts src/lib/__tests__/agent.test.ts` 通过。 |
| AC-11 | 检查变更范围 | 除 frontmatter `allowed_paths` 列出的文件外，没有修改页面、后端或文档。 |
