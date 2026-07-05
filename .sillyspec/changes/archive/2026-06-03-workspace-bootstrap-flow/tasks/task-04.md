---
id: task-04
title: 详情页 load 查询进行中 scan run 并自动恢复 SSE 回显 + done 后刷新计数
priority: P0
estimated_hours: 4
depends_on: []
blocks: [task-07]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
  - frontend/src/lib/agent.ts
author: WhaleFall
created_at: 2026-06-03 15:21:55
---

# task-04 详情页 load 查询进行中 scan run 并自动恢复 SSE 回显 + done 后刷新计数

进入 `workspaces/[id]` 详情页时，自动查询该 workspace 是否有「正在进行的 Bootstrap / scan run」（`change_id == null` 且 `status` 为 `pending`/`running`），若有则用 `AgentRunStreamClient` 重新连接 SSE，把日志回显接管过来；run `done` 后刷新「项目组组件」计数。对应 design.md 决策 2 与 plan.md task-04。

## 修改文件（精确路径）

- `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`（核心：抽 `connectBootstrapStream`，`load()` 查 run 并恢复回显）
- `frontend/src/lib/agent.ts`（**必须改**：`AgentRun` 接口缺 `change_id` 字段，需补充；并新增 `listWorkspaceAgentRuns` 封装或直接复用 `listAgentRuns`，见「接口定义」）

## 实现要求

### 1. agent.ts：补 `change_id` 字段 + 列出 workspace runs 的封装

- 现状：`agent.ts` 已有 `listAgentRuns(workspaceId, taskId?)` → `Promise<AgentRun[]>`，命中后端 `GET /api/workspaces/{id}/agent/runs`。
- 现状：`AgentRun` 接口**不含 `change_id`**。必须新增可空字段 `change_id: string | null`（后端 AgentRun 模型有该字段；不加则无法筛 Bootstrap run）。
- 封装策略二选一（推荐 A，改动最小）：
  - **A（推荐）**：直接复用 `listAgentRuns(workspaceId)`（不传 `taskId`），在 page.tsx 内基于返回数组筛选。无需新增函数。
  - **B**：如需语义清晰，新增 `listWorkspaceAgentRuns(workspaceId): Promise<AgentRun[]>` 作为 `listAgentRuns(workspaceId)` 的别名导出。
- 本蓝图以 A 为准实现，B 仅作可选。无论 A/B，`change_id` 字段必须补齐。

### 2. page.tsx：抽出 `connectBootstrapStream(runId)` 辅助函数

把 `handleBootstrap` 内「new AgentRunStreamClient → onStatusChange → onMessage → onDone → connect(accessToken)」这段连接逻辑抽成一个组件内函数 `connectBootstrapStream(runId: string)`，供 `handleBootstrap` 与 `load` 共用，避免两处重复维护 SSE 回调。

- 抽出后 `handleBootstrap` 改为：调用 `bootstrapSpecWorkspace` 拿到 `result.agent_run_id` → `setActiveBootstrapRunId` / `setBootstrapStatus` → `connectBootstrapStream(result.agent_run_id)`。
- `connectBootstrapStream` 内部沿用现有 onMessage 去重逻辑、`pending_input` 处理、onDone 中 `setBootstrapStatus("completed")` + `client.disconnect()` + `void load()`。
- 注意：现有 onMessage 回调闭包里写死了 `run_id: result.agent_run_id`，抽函数后改用入参 `runId`。

### 3. load() 中查询进行中 run 并恢复回显

在 `load()` 成功拿到数据后（或并入 `Promise.all`），新增：

- 调用 `listAgentRuns(workspaceId)`（失败 `.catch(() => [])`，不阻断主加载）。
- 从结果筛出 `r.change_id == null` 的项（Bootstrap/scan run，无关联 change），按 `created_at` 倒序取最近一条。
- 若该 run 存在且 `r.status === "pending" || r.status === "running"`：
  - **去重保护**：若 `streamClientRef.current` 已存在或 `activeBootstrapRunId === r.id`，则跳过（避免重复连接）。
  - 否则 `setActiveBootstrapRunId(r.id)` / `setBootstrapStatus(r.status)` / 清空 `bootstrapLogs` → 调 `connectBootstrapStream(r.id)`。
- 若无符合条件的进行中 run：不做任何 SSE 连接（不动现有面板状态）。

### 4. 按钮禁用确认（无需新增代码，确认即可）

`handleBootstrap` 触发按钮 disabled 已含 `!!activeBootstrapRunId`（page.tsx 第 387 行），恢复路径设置 `activeBootstrapRunId` 后按钮自动禁用，按钮文案显示「Bootstrap 运行中...」。**确认此判断覆盖恢复场景，无需改动。**

### 5. done 后刷新计数确认（无需新增代码，确认即可）

`onDone` 回调已有 `void load()`（page.tsx 第 223 行），抽入 `connectBootstrapStream` 后保留。`load()` 重新 `listComponents` 并 `setComponentCount`，子组件计数（「项目组组件」卡片，第 360 行 `{componentCount}`）自动更新。**确认 load 刷新链路成立，无需改动。**

## 接口定义

### listAgentRuns（已存在，复用）

```ts
// frontend/src/lib/agent.ts （已存在，签名不变）
export function listAgentRuns(
  workspaceId: string,
  taskId?: string,
): Promise<AgentRun[]>;
// GET /api/workspaces/{workspaceId}/agent/runs[?task_id=...]
```

### AgentRun 字段补充（必须新增 change_id）

```ts
// frontend/src/lib/agent.ts → interface AgentRun
export interface AgentRun {
  id: string;
  task_id: string;
  lease_id: string;
  agent_type: string;
  status: AgentRunStatus;            // 已含 "pending" | "running" | "completed" | "failed" | "killed"
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  output_redacted: string | null;
  spec_strategy: string | null;
  profile_version: string | null;
  diff_summary: string | null;
  change_id: string | null;          // ← 新增：null 表示 Bootstrap/scan run（未关联 change）
  created_at: string;
}
```

> 说明：`AgentRunStatus` 已包含本任务所需的 `"pending" | "running"`，无需改动。

### 可选：listWorkspaceAgentRuns 别名（方案 B，非必须）

```ts
export const listWorkspaceAgentRuns = (workspaceId: string) =>
  listAgentRuns(workspaceId);
```

### connectBootstrapStream(runId) 伪代码（page.tsx 组件内）

```ts
function connectBootstrapStream(runId: string) {
  // 关闭可能存在的旧连接，保证单连接
  closeBootstrapStream();

  const client = new AgentRunStreamClient(workspaceId, runId);
  streamClientRef.current = client;

  client.onStatusChange((status: StreamStatus) => {
    setBootstrapStreamStatus(status);
    if (status === "error") setBootstrapError("连接失败，请重试");
  });

  client.onMessage((event) => {
    setBootstrapLogs((prev) => {
      if (event.log_id != null && prev.some((l) => l.id === event.log_id)) return prev;
      return [
        ...prev,
        {
          id: event.log_id ?? crypto.randomUUID(),
          run_id: runId,                       // ← 用入参，替换原 result.agent_run_id
          timestamp: event.timestamp,
          channel: event.channel,
          content_redacted: event.content,
        },
      ];
    });
    if (event.channel === "pending_input") {
      setPendingInputPrompt(event.content || "");
    }
  });

  client.onDone(() => {
    setBootstrapStatus("completed");
    client.disconnect();
    void load();                               // ← 刷新 componentCount
  });

  const { accessToken } = useSession.getState();
  if (accessToken) {
    client.connect(accessToken);
  } else {
    // accessToken 缺失：不连接，提示并清理引用
    setBootstrapError("会话已失效，请重新登录后查看实时日志");
    streamClientRef.current = null;
  }
}
```

### load() 内恢复逻辑伪代码

```ts
// load() 主数据加载成功后追加：
const runs = await listAgentRuns(workspaceId).catch(() => []);
const scanRun = runs
  .filter((r) => r.change_id == null)
  .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0];

if (
  scanRun &&
  (scanRun.status === "pending" || scanRun.status === "running") &&
  !streamClientRef.current &&            // 去重：已有连接则不重连
  activeBootstrapRunId !== scanRun.id
) {
  setActiveBootstrapRunId(scanRun.id);
  setBootstrapStatus(scanRun.status);
  setBootstrapLogs([]);
  connectBootstrapStream(scanRun.id);
}
```

## 边界处理（至少 5 条）

1. **无进行中 run 不连 SSE**：`listAgentRuns` 返回空、或最近 scan run 不存在时，不调用 `connectBootstrapStream`，不动现有面板状态。
2. **多条 run 取最近 scan run**：先 `filter(change_id == null)` 过滤掉关联 change 的普通 run，再按 `created_at` 倒序取第一条，避免误连历史 run 或非 Bootstrap run。
3. **已 completed/failed/killed 不恢复**：仅 `status` 为 `pending`/`running` 才连接；终态 run 直接忽略，不回显历史日志（详情页只接管「还在跑」的 run）。
4. **accessToken 缺失处理**：`useSession.getState().accessToken` 为空时不调用 `client.connect`，设置 `bootstrapError` 提示重新登录，并将 `streamClientRef.current` 置空，避免悬挂未连接的 client。
5. **组件卸载时断开 stream**：保留现有 `useEffect` cleanup（`streamClientRef.current?.disconnect()` + 置 null），恢复连接同样走 `streamClientRef`，卸载时一并断开，不泄漏 EventSource。
6. **重复进入避免重复连接**：`load()` 恢复前检查 `!streamClientRef.current && activeBootstrapRunId !== scanRun.id`；`connectBootstrapStream` 入口先 `closeBootstrapStream()` 关旧连接，确保任一时刻只有一条 SSE。
7. **listAgentRuns 失败降级**：`.catch(() => [])`，列表查询失败不影响 workspace / specWs / 计数等主数据加载与渲染。

## 非目标

- 不改后端（不动 `GET /workspaces/{id}/agent/runs`、SSE、scan_generate；后端字段已存在，仅补前端类型）。
- 不改 Bootstrap 弹窗 / 输入弹窗（`workspace-scan-dialog.tsx` 属 task-03；输入区逻辑不动）。
- 不实现 Agent 暂停/恢复协议、断线自动重连退避策略（连接失败仅提示，沿用 `AgentRunStreamClient` 现有行为）。
- 不改 `closeBootstrapPanel` / `handleSubmitInput` 等现有交互逻辑。

## 参考

- 现有 `handleBootstrap` 的 client 连接逻辑：`page.tsx` 第 176–233 行（待抽出的 onStatusChange / onMessage / onDone / connect 模板）。
- onDone 刷新计数：`page.tsx` 第 220–224 行 `void load()`。
- 按钮禁用判断：`page.tsx` 第 387 行 `disabled={bootstrapping || !!activeBootstrapRunId || ...}`。
- 卸载 cleanup：`page.tsx` 第 147–155 行 `useEffect` return。
- 列表接口与类型：`lib/agent.ts` 第 11–25 行 `AgentRun`、第 59–64 行 `listAgentRuns`。
- SSE 客户端：`lib/agent-stream.ts` 的 `AgentRunStreamClient`（`onStatusChange`/`onMessage`/`onDone`/`connect`/`disconnect`）。

## TDD 步骤（前端手动验证为主）

1. **类型先行**：给 `AgentRun` 加 `change_id: string | null`，`tsc --noEmit` 通过，确认无现有用法因新增非可选字段报错（新增字段位于返回类型，调用方不受影响）。
2. **抽函数**：抽出 `connectBootstrapStream`，改 `handleBootstrap` 调用之；手动点击 Bootstrap，验证回显、pending_input、done 行为与抽函数前一致（回归）。
3. **恢复路径**：构造一个 `pending`/`running` 的 scan run（触发 scan-generate 后立刻进入详情页），刷新页面，验证 `load()` 自动连接 SSE、日志续显、按钮禁用、状态 Badge 正确。
4. **去重**：在已恢复连接的页面再次手动触发 `load`（如切 tab 回来 / 二次进入），验证不产生第二条 SSE（断点 / 控制台无重复 EventSource）。
5. **done 刷新**：等 scan run 完成（done 事件），验证 `bootstrapStatus` 变 completed、`load()` 重跑、「项目组组件」计数增加。
6. **降级**：清空 session accessToken 后进入，验证不崩溃、给出错误提示、无悬挂连接。

## 验收标准

| AC | 验收点 | 验证方式 | 通过标准 |
|---|---|---|---|
| AC1 | `AgentRun` 含 `change_id` 且 `listAgentRuns` 可用 | 阅码 + `tsc --noEmit` | 类型含 `change_id: string \| null`，编译通过，无新增类型错误 |
| AC2 | 进入详情页自动恢复进行中 scan run 回显 | 触发 scan→进详情页 | 页面加载后 Bootstrap 面板出现，SSE 续显日志，状态 Badge 显示 running |
| AC3 | 恢复时 Bootstrap 按钮禁用 | 观察按钮 | `activeBootstrapRunId` 存在时按钮 disabled，文案「Bootstrap 运行中...」 |
| AC4 | 仅 pending/running 才恢复，终态不连 | 用已 completed run 进入 | 无 SSE 连接，不回显历史日志，面板不弹出 |
| AC5 | 重复进入不产生重复连接 | 二次 load / 切换回页 | 任一时刻仅一条 EventSource，日志无重复 |
| AC6 | done 后刷新「项目组组件」计数 | 等 run 完成 | onDone 触发 `load()`，componentCount 刷新（子组件创建后数值增加） |
| AC7 | accessToken 缺失安全降级 | 清空 token 进入 | 不崩溃，提示重新登录，无悬挂未连接 client |
| AC8 | 多 run 取最近 scan run | 多条 run（含带 change_id 的） | 仅选 `change_id==null` 中 `created_at` 最新一条恢复 |
