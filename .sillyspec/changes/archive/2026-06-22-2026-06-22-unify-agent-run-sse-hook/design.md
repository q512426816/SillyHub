---
author: qinyi
created_at: 2026-06-22T11:06:00+08:00
---

# Design — 统一 Agent Run SSE 客户端

变更：`2026-06-22-unify-agent-run-sse-hook`
原型：`prototype-unify-agent-run-sse.html`
决策台账：`decisions.md`（D-001/D-002/D-003）

## 1. 背景

`/workspaces/{id}/agent` 页面对应日志 `agent-run-25116cfa.log`：scan run 中 AskUserQuestion 触发（日志 958 行 tool_call），但页面没弹审批卡片，5 分钟后 daemon 兜底超时（日志 960 行 `permission request timeout (5min fallback)`）。

根因（已诊断）：前端存在**两套并行 SSE 客户端**，能力是超集关系却并存：
- `frontend/src/lib/agent.ts:117` `streamAgentRunLogs`（函数式）：`onmessage` 在 `:137` `if (typeof parsed.timestamp !== "string" || !parsed.timestamp) return;` 把无 timestamp 的 `permission_request`/`permission_resolved` 事件**直接丢弃**，且无 permission 回调。
- `frontend/src/lib/agent-stream.ts` `AgentRunStreamClient`（class）：已具备重连退避、持久化日志预取、`parseSessionPermissionEvent` 解析、`onPermissionRequest`/`onPermissionResolved` 回调、`log_id` 去重、`lastLogId` 续传 —— 是前者的**严格超集**。

类型层已共享（`StreamLogEvent`/`DoneEventData` 定义在 `agent.ts:105,112`，`agent-stream.ts` 复用）。底层差异是假差异，纯粹是两个实现并存。后端链路正常（`backend/app/modules/agent/service.py:790-792` `stream_run_logs` 订阅 `agent_session:{id}` 频道，`:828` 把 permission 事件透传为 SSE data）。`AgentLogViewer` 也已支持审批卡片（`agent-log-viewer.tsx:364-387` `permissionRequests`/`onPermissionResolved` prop，卡片内部自调 `respondSessionPermission`）。

4 个调用点重复严重（3 处 `onMessage` 回调体几乎一字不差；3 套 pending_input 状态管理重复）：

| 调用点 | 客户端 | logs | perms | input |
|---|---|---|---|---|
| 根 `page.tsx:287`（Bootstrap/scan） | `AgentRunStreamClient` | ✅ | ✅ | ✅ bsInput* |
| `agent/page.tsx:397` | `streamAgentRunLogs` | ✅ | ❌ | ✅ input* |
| `changes/[cid]/page.tsx:523` | `streamAgentRunLogs` | ✅ | ❌ | — |
| `changes/[cid]/page.tsx:599` | `streamAgentRunLogs` | ✅ | ❌ | — |

## 2. 设计目标

- 合并两套 SSE 客户端为单一实现，消除 4 处状态管理 + SSE 生命周期重复。
- 修复 `/agent` 与 `changes/[cid]` 页 AskUserQuestion 审批卡片不弹出（顺带修 changes 页 task 执行中的同类问题）。
- 调用点收敛为一行 JSX（`<AgentRunPanel>`）。
- 顺带统一三处 pending_input 人工指导 UI/交互（命名/样式/行为一致）。

## 3. 非目标

- **不改后端**（backend `agent` 模块、`daemon` 模块）—— SSE/REST 契约零改动。
- **不改 `sillyhub-daemon`** —— permission 事件发布链路不变。
- **不改 `AgentLogViewer`** —— 已支持 permissionRequests，本次只喂数据。
- **不接管"已完成 run 的历史展开"**（如 `agent/page.tsx` expandedLogs + 下载按钮）—— 保持现有一次性 `getAgentRunLogs` + 直接 `<AgentLogViewer>`（纯历史非流式 + 定制 actions）。
- **不做版本兼容**（规则7，未上线），`streamAgentRunLogs` 直接删除。

## 4. 拆分判断

不拆分、不走批量模式。单一内聚重构（1 hook + 1 面板组件 + 4 调用点替换 + 删 1 函数 + 测试），全部在 frontend 模块内、围绕同一 hook 收敛。详见 brainstorm Step5。

## 5. 总体方案

### 5.1 分层

```
4 调用点
  └─ <AgentRunPanel>                 (components/agent-run-panel.tsx, 新增)
      └─ useAgentRunStream()         (lib/use-agent-run-stream.ts, 新增)
          └─ AgentRunStreamClient    (lib/agent-stream.ts, 复用现有 class)
              ├─ logs / status / streaming / error
              ├─ perms (permission_request/resolved + dialog 恢复)
              └─ input (pending_input 回复)
      └─ <AgentLogViewer>            (现有, props 由 panel 注入)
```

### 5.2 Wave 划分（执行阶段细化，plan.md 落地）

- W1 新增 `useAgentRunStream` hook + 单测（不改调用点，独立可测）。
- W2 新增 `AgentRunPanel` + 集成测试（端到端覆盖 permission 卡片 bug）。
- W3 迁移 4 调用点（根 page → agent → changes），每处独立提交 + tsc/lint/test。
- W4 删 `streamAgentRunLogs` + 清理 import，全量验证。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `frontend/src/lib/use-agent-run-stream.ts` | `useAgentRunStream` hook |
| 新增 | `frontend/src/components/agent-run-panel.tsx` | `AgentRunPanel` 面板组件 |
| 新增 | `frontend/src/lib/__tests__/use-agent-run-stream.test.ts` | hook 单测（permission/input/isActive） |
| 新增 | `frontend/src/components/agent-run-panel.test.tsx` | panel 集成测试（perms→卡片渲染） |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` | Bootstrap run 改用 `<AgentRunPanel>`；删 `connectBootstrapStream`/`bootstrapLogs`/`bootstrapPerms`/`bsInput*` |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx` | 活跃 run 改用 `<AgentRunPanel isActive>`；删 `streamAgentRunLogs` 用法 + `input*` 状态 |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` | `:523`+`:599` 合并为单 `<AgentRunPanel>`；删 `eventSourceRef`/`dispatchOwnsSseRef`/`loadHistoryLogs`/`connectLogStream` |
| 修改 | `frontend/src/lib/agent.ts` | 删 `streamAgentRunLogs`（:117-162） |

## 7. 接口定义

### 7.1 `useAgentRunStream`

```ts
// frontend/src/lib/use-agent-run-stream.ts
export interface UseAgentRunStreamOptions {
  /** run 状态 pending/running → 连 SSE；否则仅 prefetch 历史（D-001） */
  isActive: boolean;
  /** run 结束（done 事件）通知父组件 */
  onDone?: (status: string) => void;
  // 注：不设 enabled —— runId=null 已表达"不连接"（useEffect guard），避免 YAGNI（Grill X-001）。
}

export interface AgentRunInputStream {
  values: Record<string, string>;
  submitting: Record<string, boolean>;
  errors: Record<string, string>;
  replied: Set<string>;
  set: (logId: string, value: string) => void;
  /** 调 submitAgentRunInput(workspaceId, runId, {content})，成功标记 replied */
  submit: (logId: string) => Promise<void>;
}

export interface UseAgentRunStreamResult {
  logs: AgentRunLogEntry[];
  status: AgentRunStatus | null;
  streaming: boolean;
  loading: boolean; // prefetch 历史 / 建立连接中（Grill X-004，喂给 AgentLogViewer.loading）
  error: string | null;
  perms: SessionPermissionRequest[];
  /** 本地移除 perm（卡片 onResolved 与 SSE permission_resolved 均调，D-003） */
  dismissPerm: (requestId: string) => void;
  input: AgentRunInputStream;
  clear: () => void;
}

export function useAgentRunStream(
  workspaceId: string,
  runId: string | null,
  options: UseAgentRunStreamOptions,
): UseAgentRunStreamResult;
```

### 7.2 `AgentRunPanel`

```tsx
// frontend/src/components/agent-run-panel.tsx
export interface AgentRunPanelProps {
  workspaceId: string;
  runId: string | null;
  isActive: boolean;
  // —— AgentLogViewer 定制（显式列 + ...rest 兜底，D-002）——
  title: string;
  emptyText?: string;
  summary?: React.ReactNode;
  actions?: React.ReactNode;
  compact?: boolean;
  variant?: "panel" | "embedded";
  maxHeightClass?: string;
  isLive?: boolean;
  // —— 生命周期回调 ——
  onDone?: (status: string) => void;
  onClose?: () => void;
}
```

内部：调 `useAgentRunStream(workspaceId, runId, { isActive, onDone })` → 把 `logs`/`perms`/`input` 注入 `<AgentLogViewer>`：
- `permissionRequests={perms}`
- `onPermissionResolved={(id) => dismissPerm(id)}`（D-003：卡片自调 respondSessionPermission，此处仅本地移除）
- `inputControls={适配后的 input}`：`AgentRunInputStream` 字段语义对齐 `AgentLogInputControls`，panel 负责字段映射（values→inputValues / submitting→submittingInputs / errors→inputErrors / replied→repliedInputs / set→onChange / submit→onSubmit），使三处 pending_input UI 收敛为同一契约（Grill X-002）。
- `loading={loading}`
- 其余定制 prop 透传

> token 来源：hook 内部 `useSession.getState().accessToken`，无 token 时 set error 不连（复刻 `page.tsx:335-341` 现有模式，Grill X-005）。

### 7.3 生命周期契约表（消费现有，后端零改动）

> 本次涉及 `agent_run` / `session` / `lifecycle` 关键词，但**均为前端消费现有后端契约**，不改后端事件/DTO。

| 事件/接口 | 发起→接收 | 必需字段 | hook 处理 | 本次改动 |
|---|---|---|---|---|
| `permission_request` | daemon→backend→SSE(`agent_session:{id}`) | session_id, run_id, request_id, tool_name, input, (dialog_kind?, dialog_payload?) | onPermissionRequest → perms 增（按 request_id 去重） | 消费现有，不改 |
| `permission_resolved` | daemon→backend→SSE | session_id, request_id, decision, reason? | onPermissionResolved → dismissPerm | 消费现有 |
| `done` | backend→SSE(`agent_run:{id}`) | status, exit_code | onDone → status + 通知父 | 消费现有 |
| GET `/dialogs` | hook→backend | sessionId | isActive 时 getAgentRun 取 session_id → fetchPendingDialogs 恢复 | 消费现有 |
| POST `.../permissions/{rid}/response` | 卡片→backend | decision, (message?, dialog_result?) | 卡片自调 respondSessionPermission（D-003） | 不改（卡片自洽） |
| POST `.../runs/{rid}/input` | hook→backend | content | input.submit 调 submitAgentRunInput | 消费现有 |

字段来源：`SessionPermissionRequest`/`SessionPermissionResolved`（daemon.ts:360/385）、`respondSessionPermission`（daemon.ts:398）、`fetchPendingDialogs`（daemon.ts:481）、`submitAgentRunInput`（agent.ts:182）、`AgentRunInputRequest`（agent.ts:166）。

## 8. 数据模型

无。不改任何表结构（AgentRun/AgentRunLog/AgentSession 现状保留）。

## 9. 兼容策略（brownfield）

- **未使用 AgentRunPanel 的页面**：行为完全不变（本次只新增 + 迁移已知 4 调用点）。
- **streamAgentRunLogs 删除**：本项目未上线（规则7），直接删；其唯一调用方（3 处）全部迁移到 AgentRunPanel 后才删，`tsc` 保证无遗漏引用。
- **回退路径**：`git revert`（纯前端重构，无 DB/迁移）。
- **不改的 API/表**：所有后端 REST/SSE 契约、SQLModel 表均不变。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | hook 生命周期：runId 切换时旧连接未正确 disconnect，导致事件串流/内存泄漏 | P1 | useEffect cleanup 内 `client.disconnect()`；`runId`/`isActive` 变化触发重连；单测覆盖 runId 切换 |
| R-02 | `changes/[cid]` 两触发点（dispatch `:523` + connectLogStream `:599`）合并为单实例后，行为与原 `isRunActive`/`loadHistoryLogs` 路径不一致 | P1 | 严格对照原逻辑（:590-594 非活跃只拉历史）；AgentRunPanel isActive={isRunActive}；集成测试覆盖 dispatch 新 run 场景 |
| R-03 | AgentRunPanel prop 透传膨胀（AgentLogViewer 定制项多） | P2 | 显式列关键 prop + `...rest` 兜底；接受 trade-off（D-002） |
| R-04 | 删 streamAgentRunLogs 后漏改调用方 → 编译错误 | P2 | 删除前 `grep streamAgentRunLogs` 确认无残留；`pnpm typecheck` 兜底 |
| R-05 | pending_input UI 三处统一时样式回归 | P2 | execute 时逐处核对渲染一致；保留现有 AgentLogInputControls 契约 |
| R-06 | changes/[cid] dispatch 后 `activeRunId` 来源于 agentStatus（异步 refresh），与现状 dispatch 立即连新 run（:515-553）有间隙 | P2 | execute 时 changes 页用 localRunId 兜底（dispatch 返回 run_id 立即 set），或 activeRunId 计算兼容 dispatch 立即值（Grill X-003） |

## 11. 决策追踪

- **D-001@v1**（非活跃 run 边界）→ 覆盖于 §5.1（isActive 语义）、§7.1（接口）、§7.3（仅活跃连 SSE）。已解决。
- **D-002@v1**（抽象层次 = hook + 面板）→ 覆盖于 §5.1（分层）、§6（文件清单）、§7.2（AgentRunPanel props）。已解决。
- **D-003@v1**（决策 API 不归 hook）→ 覆盖于 §7.1（dismissPerm 而非 resolvePermission）、§7.3（卡片自调）。已解决。

无未解决决策，无剩余风险（R-01..R-05 均有应对）。

## 12. 自审

- ✅ 需求覆盖：合并两套客户端（§5）、修 permission bug（§1/§7.3）、4 调用点统一（§6）、pending_input 纳入 + UI 统一（§7.1 input/§6 调用点）—— 全覆盖。
- ✅ Grill 覆盖：design 引用 D-001/D-002/D-003 全部当前版本（§5/§7/§11）。
- ✅ 约束一致性：符合 CONVENTIONS.md（前端 lib/*.ts API 层 + apiFetch、vitest 测试、TS strict）；ARCHITECTURE.md（Next.js App Router、lib/ API 客户端、components/ 共享组件）。
- ✅ 真实性：所有文件路径/行号/类型/API 签名来自真实代码（agent.ts/agent-stream.ts/daemon.ts/agent-log-viewer.tsx/page.tsx），新增文件标注"新增"。
- ✅ YAGNI：不接管历史展开、不改后端、不做版本兼容；决策 API 维持卡片自洽（D-003，避免重复封装）。
- ✅ 验收标准：可测试 —— hook 单测（permission/input/isActive/runId切换）、panel 集成测试（perms→卡片）、调用点 tsc/lint/test 全过（§5.2 W3/W4）。
- ✅ 非目标清晰：§3 显式列出 5 项不做。
- ✅ 兼容策略：§9 说明回退路径 + 不改的 API/表。
- ✅ 风险识别：§10 列 R-01..R-05 含对策。
- ✅ 生命周期契约表：§7.3 已生成（agent_run/session/lifecycle 关键词命中），均为消费现有契约、后端零改动，字段对齐真实 DTO。

自审全部通过，进入下一步。

## 13. Design Grill 结果（Step12 交叉审查）

status: **passed**（无 P0/P1 结构性矛盾；5 个 P2 已修正/登记）

### Cross-Check Matrix

| ID | 层级 | 交叉点 | 证据 A | 证据 B | 结论 | 处理 |
|---|---|---|---|---|---|---|
| X-001 | 定义层/YAGNI | `enabled` prop 多余 | design §7.1 `enabled?` | `runId=null` 已表达不连（useEffect guard） | 去掉 enabled | 已修正 §7.1 |
| X-002 | 一致性 | AgentRunInputStream 命名 vs AgentLogInputControls | design §7.1 `input.values` | `agent-log-viewer.tsx:379` inputValues | 字段名不同 | panel 负责映射，§7.2 已补说明 |
| X-003 | 可行性 | changes dispatch 后 activeRunId 异步 | design §6 changes 改造 | `changes/[cid]/page.tsx:578,515-553` | dispatch 立即连 vs derived runId 间隙 | 登记为 R-06 |
| X-004 | 一致性 | panel.loading 无来源 | design §7.2 `loading?` | hook 返回无 loading | 缺失 | 已修正 §7.1 加 `loading` |
| X-005 | 可行性 | hook token 来源未明 | design §7.1 | `page.tsx:335-341` useSession | 遵循现有模式 | 已补 §7.2 说明 |

### Unresolved Blockers

无 P0/P1。P2 全部已修正（X-001/X-002/X-004/X-005）或登记风险（X-003→R-06），不阻塞 plan。
