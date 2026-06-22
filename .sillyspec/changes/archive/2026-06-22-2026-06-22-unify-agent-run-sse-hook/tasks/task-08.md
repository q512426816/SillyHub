---
id: task-08
title: 删除 streamAgentRunLogs + 清理残留 import
priority: P0
estimated_hours: 1
depends_on: [task-05, task-06, task-07]
blocks: [task-09]
requirement_ids: [FR-01]
decision_ids: []
allowed_paths:
  - frontend/src/lib/agent.ts
created_at: 2026-06-22T11:24:44+08:00
author: qinyi
---

# task-08 — 删除 streamAgentRunLogs + 清理残留 import

## 修改文件

| 操作 | 文件 | 说明 |
|---|---|---|
| 修改 | `frontend/src/lib/agent.ts` | 删除 `streamAgentRunLogs` 函数（:117-162）；删除随之孤立的 import `getApiBaseUrl`、`useSession`；**保留** `StreamLogEvent`（:105）/`DoneEventData`（:112）类型 export |

> 本任务 `allowed_paths` 仅限 `frontend/src/lib/agent.ts`。两处页面文件的 `streamAgentRunLogs` import 清理由 task-06（`agent/page.tsx:33`）与 task-07（`changes/[cid]/page.tsx:41`）各自负责；本任务仅**复核**，不再编辑这两页（防止串改）。

## 覆盖来源

- **FR-01（单一 SSE 客户端）**：`streamAgentRunLogs` 从 `agent.ts` 删除后，`AgentRunStreamClient`（`agent-stream.ts`）成为唯一底层 SSE 客户端；4 个调用点（task-05/06/07 已完成迁移）统一经由 `useAgentRunStream` → `AgentRunStreamClient`。
- design.md §6 文件变更清单「修改 `frontend/src/lib/agent.ts` | 删 `streamAgentRunLogs`（:117-162）」
- design.md §3 非目标「不做版本兼容（规则7，未上线），`streamAgentRunLogs` 直接删除」
- design.md §9 兼容策略「其唯一调用方（3 处）全部迁移到 AgentRunPanel 后才删，`tsc` 保证无遗漏引用」
- design.md §10 R-04「删 streamAgentRunLogs 后漏改调用方 → 编译错误 | 删除前 `grep streamAgentRunLogs` 确认无残留；`pnpm typecheck` 兜底」
- plan.md §调用点搜索记录「execute task-08 前重新 grep 确认无新增调用方」

## 实现要求

### 删除范围（agent.ts）

1. **删除函数体**：`:117-162` 整段 `export function streamAgentRunLogs(...) { ... return es; }`（含函数签名、内部 `EventSource` 构造、`onmessage` / `done` / `onerror` 三个回调、`:163` 末尾空行收敛）。
2. **删除孤立的 import**（删除函数后这两个 import 在 agent.ts 内不再被引用）：
   - `agent.ts:1` `import { apiFetch, getApiBaseUrl } from "./api";` → 改为 `import { apiFetch } from "./api";`（`getApiBaseUrl` 仅 `streamAgentRunLogs:125` 用；`apiFetch` 仍被其他函数用 → 保留）
   - `agent.ts:2` `import { useSession } from "@/stores/session";` → **整行删除**（`useSession` 仅 `streamAgentRunLogs:126` 用，agent.ts 其他函数无引用）
3. **保留 export 列表中的类型**：
   - `StreamLogEvent`（`agent.ts:105`）—— 被 `agent-stream.ts:2,29,58,95,131,192,236` 和（迁移后）`use-agent-run-stream.ts` 依赖
   - `DoneEventData`（`agent.ts:112`）—— 被 `use-agent-run-stream.ts`、`agent-stream.ts`（done 事件处理）依赖
   - 这两个类型是 SSE 数据契约，**不得删、不得改名、不得挪位置**（下游已 `import { type StreamLogEvent } from "./agent"`）。
4. **保留其余所有函数与类型**：`AgentRun`/`AgentRunLogEntry`/`createAgentRun`/`getAgentRun`/`listAgentRuns`/`getAgentRunLogs`/`formatRunProviderLabel`/`killAgentRun`/`submitAgentRunInput`/`listDaemonRuntimes`/`listWorkspaceAgentSessions`/Mission 系列等一律不动。

### grep 前置检查（删除前必做）

在编辑 `agent.ts` **之前**先运行，确认上游迁移已让所有调用点消失：

```bash
grep -rn streamAgentRunLogs frontend/src
```

预期结果（task-05/06/07 完成后）：

| 位置 | 期望状态 |
|---|---|
| `frontend/src/lib/agent.ts:117`（定义） | 本任务即将删 |
| `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx:33`（import） | task-06 已删 |
| `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx:397`（调用） | task-06 已删 |
| `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx:41`（import） | task-07 已删 |
| `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx:523`（调用 dispatch） | task-07 已删 |
| `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx:599`（调用 connectLogStream） | task-07 已删 |
| 根 `page.tsx`（Bootstrap） | 本来就用 `AgentRunStreamClient`，不涉及 |

**若 grep 仍出现 `streamAgentRunLogs` 的调用/import（除 `agent.ts:117` 定义本身外）→ 停止，不删**，回报残留位置让对应 task 补迁移。

### import 清理复核（agent.ts:1-2）

删除函数后用 tsc / lint 兜底确认无 `getApiBaseUrl` / `useSession` 残留引用：

```bash
cd frontend && pnpm typecheck
```

### 调用点 import 清理复核（仅 grep 验证，不编辑）

```bash
grep -n streamAgentRunLogs frontend/src/app/\(dashboard\)/workspaces/\[id\]/agent/page.tsx
grep -n streamAgentRunLogs frontend/src/app/\(dashboard\)/workspaces/\[id\]/changes/\[cid\]/page.tsx
```

预期：两文件均无匹配。如有残留 import（task-06/07 漏删 import 行），**不代为编辑**（超出 allowed_paths），回报对应 task。

## 边界处理

1. **grep 前置检查失败（有残留调用/import）** → 立即停止删除，报告残留位置（文件:行号），交还对应 task（task-05/06/07）补迁移；**不得强行删函数**（否则 tsc 必崩，且违反 R-04）。
2. **保留类型 `StreamLogEvent` / `DoneEventData`** → 删除函数时严格只动 `:117-162`，不得误删 `:105-115`；写完用 `grep -n "export interface StreamLogEvent\|export interface DoneEventData" frontend/src/lib/agent.ts` 复核两行仍在。
3. **tsc 验证无悬空引用** → 删除后跑 `cd frontend && pnpm typecheck`，若报 `getApiBaseUrl is declared but never used` / `useSession is declared but never used` → 按本文「删除范围 §2」清理 import；若报其他符号未定义 → 说明误删，回退检查。
4. **`EventSource` 是否在 agent.ts 他处用** → 已确认 grep `EventSource` 在 agent.ts 命中 `:123, :129, :156` 全部位于 `streamAgentRunLogs` 函数体内，删除函数后 agent.ts 不再出现 `EventSource`，无需额外处理（`EventSource` 是浏览器全局，非 import）。
5. **函数删除后 export 列表** → 删除后 `agent.ts` 的 export 仍包含全部对外 API（createAgentRun/getAgentRun/listAgentRuns/getAgentRunLogs/formatRunProviderLabel/killAgentRun/submitAgentRunInput/listDaemonRuntimes/listWorkspaceAgentSessions/createMission/getMission/cancelMission + 类型 AgentRun/AgentRunStatus/AgentRunLogEntry/AgentRunLogChannel/StreamLogEvent/DoneEventData/AgentRunInputRequest/AgentRunInputResponse/DaemonRuntime/WorkspaceAgentSession/CreateMissionInput/MissionWorkerRun/Mission 等）；无外部模块依赖 `streamAgentRunLogs` 的导出（依赖已被 task-05/06/07 迁移掉）。
6. **根 `page.tsx`（Bootstrap run）本任务不涉及** → 它用 `AgentRunStreamClient`（class），不 import `streamAgentRunLogs`（plan.md 调用点搜索记录已注明）；无需在根 page.tsx 做任何改动。
7. **行号漂移** → 设计/计划引用的 `:117-162` 为当前快照行号；实际编辑以函数签名 `export function streamAgentRunLogs(` 起到 `return es; }` 止为准（Edit 工具按唯一文本匹配，不依赖行号）。

## 非目标

- **不改 agent.ts 其他函数**（Mission 系列、daemon runtime、agent run CRUD 等一律不动）。
- **不碰 `AgentRunStreamClient`**（`agent-stream.ts` 不在 allowed_paths，本任务只消费其依赖的 `StreamLogEvent` 类型）。
- **不编辑两页面文件**（`agent/page.tsx`、`changes/[cid]/page.tsx` 的 import 清理归 task-06/07；本任务只 grep 复核）。
- **不改后端 / daemon**（REST/SSE 契约零改动，见 design §3）。
- **不做版本兼容 / deprecated 标记**（规则7，未上线，直接删 —— design §3 明确）。
- **不删 `StreamLogEvent` / `DoneEventData` 类型**（下游依赖，保留 export）。

## 参考

- design.md §1（两套客户端根因）、§3（不做版本兼容）、§6（文件清单）、§9（兼容策略）、§10 R-04（grep 前置 + tsc 兜底）
- requirements.md FR-01（单一 SSE 客户端）
- plan.md §Wave 4（task-08/09）、§调用点搜索记录、§覆盖矩阵（FR-01 ← task-05/06/07/08）
- 源码：`frontend/src/lib/agent.ts`（:1-2 import、:105/112 类型、:117-162 待删函数）、`frontend/src/lib/agent-stream.ts:2`（消费 `StreamLogEvent`）

## 验收标准

| # | 检查项 | 命令 / 证据 | 期望 |
|---|---|---|---|
| 1 | grep 无残留调用/import | `grep -rn streamAgentRunLogs frontend/src` | **无任何输出**（含定义、import、调用全部为空） |
| 2 | 删除前 grep 前置确认 | 删除前的 grep 输出 | 仅剩 `agent.ts:117`（定义本身）一行，其余 5 处已被 task-05/06/07 清掉 |
| 3 | tsc 通过 | `cd frontend && pnpm typecheck` | exit 0，无 `streamAgentRunLogs`/`getApiBaseUrl`/`useSession` 相关报错 |
| 4 | lint 通过 | `cd frontend && pnpm lint` | exit 0，无 unused import 警告（`getApiBaseUrl`/`useSession` 已清理） |
| 5 | `StreamLogEvent` 类型仍在 | `grep -n "export interface StreamLogEvent" frontend/src/lib/agent.ts` | 命中 `:105`（或删除函数后等价位置） |
| 6 | `DoneEventData` 类型仍在 | `grep -n "export interface DoneEventData" frontend/src/lib/agent.ts` | 命中 `:112`（或等价位置） |
| 7 | `agent.ts` 不再含 `EventSource` | `grep -n EventSource frontend/src/lib/agent.ts` | 无输出（全部随函数删除） |
| 8 | `agent.ts:1` import 行已收敛 | Read agent.ts 第 1-2 行 | `import { apiFetch } from "./api";`（无 `getApiBaseUrl`）；无 `useSession` import 行 |
| 9 | 下游依赖未断 | `grep -rn "type StreamLogEvent" frontend/src` | 仍命中 `agent-stream.ts:2`、（迁移后）`use-agent-run-stream.ts`（即类型仍被正常消费） |
