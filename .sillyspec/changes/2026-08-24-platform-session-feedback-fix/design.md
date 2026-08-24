---
author: qinyi
created_at: 2026-08-24 10:30:00
scale: medium
---

# 设计文档（Design）— 平台会话实时反馈修复

## 背景

用户在 Web 平台会话中实测发现两类体验缺陷：

1. **长时间 shell 命令无进程/输出反馈**：Agent 执行 Bash 工具（如构建、测试、迁移生成）时，Web 会话侧看不到命令是否正在运行、当前输出是什么、是否已结束。
2. **Agent 自动进入 plan 模式后无确认入口**：Agent 通过 `EnterPlanMode` 进入计划阶段后，平台会话侧没有弹出计划摘要供用户确认/修改/取消，用户与 Agent 都不知道下一步由谁推进。

此外，用户反馈现有 **askuser 弹窗不可最小化**，大弹窗容易完全遮挡会话内容，体验差。

根本原因：平台后端/前端已有 `agent_session:{id}` Redis Pub/Sub + SSE 实时通道（用于 `log`/`tokens`/`messages`/`permission_request`/`gate_status_changed` 等事件），但 **plan 模式进入事件** 和 **Bash 命令进度事件** 尚未定义、未上报、未消费。

## 设计目标

1. **Bash 命令实时反馈**：在 Web 会话中显示 Bash 命令的执行状态（running / completed / failed）、命令行、实时 stdout/stderr 片段、退出码、运行时长。
2. **Plan 模式强确认**：Agent 进入 plan 模式时，在 Web 会话中弹出计划摘要卡片，用户可「确认计划 / 需要修改 / 取消」；用户决策经后端回传给 Agent，Agent 据此继续、修订或终止计划。
3. **AskUser 弹窗可最小化**：现有 askuser / permission 弹窗支持最小化为右下角浮动胶囊，点击可还原，不遮挡会话内容。
4. **最小侵入**：复用现有 session SSE 通道与事件分发机制，不新增独立通道，不改动 Agent SDK 行为。

## 非目标

- 不实现 Bash 命令的远程中断/取消（本次只做展示）。
- 不改造 plan 模式在 Agent 侧的实现逻辑（只增加事件上报与平台侧确认回调）。
- 不重构现有 `permission_request` / `session_dialog_request` 数据模型（askuser 最小化仅改前端展示层）。
- 不修改 SillySpec CLI 本身的进度同步协议（platform_sync 的 `/changes/*/progress` 等端点保持不变）。
- 不引入新的持久化表存储 plan/bash 事件（事件走 Redis Pub/Sub + 可选落 AgentRunLog，历史回放走现有日志流）。

## 拆分判断

本变更涉及 backend、daemon、frontend 三个子项目，但三个功能点（Bash 反馈、Plan 确认、askuser 最小化）共用同一事件通道与前端会话面板，耦合度高、不宜拆分为独立变更。任务数预计在 8-10 个，不走批量模式。

## 总体方案

### Phase 1：后端事件扩展

在 `backend/app/modules/daemon/run_sync/service.py` 的 `publish_submitted_messages` 中，扩展 `agent_session:{id}` 频道事件类型：

- **`plan_mode_entered`**：Agent 进入 plan 模式时发布。payload 包含计划摘要（objective、tasks 列表、design 摘要）。
- **`bash_status`**：Bash 命令开始/结束/失败时发布。payload 包含命令行、状态、退出码、运行时长。
- **`bash_chunk`**：Bash 命令 stdout/stderr 有新增输出时发布。payload 包含 chunk 内容、channel（stdout/stderr）、是否为最后一片段。

新增后端 REST 端点：

- `POST /api/daemon/sessions/{session_id}/plan-response`：接收用户对 plan 的决策（confirm / revise / cancel），写入会话状态并通过 WebSocket Hub 通知 daemon。

### Phase 2：daemon 事件上报

在 `sillyhub-daemon/src/interactive/session-manager.ts` 的 turn 事件流中：

- 检测到 plan skill / `EnterPlanMode` 触发 → 调用 `HubClient.notifyPlanModeEntered(sessionId, summary)` 上报后端。
- 检测到 Bash tool_use 开始 → 调用 `HubClient.notifyBashStatus(sessionId, running=True, command=...)`。
- Bash 输出 chunk → 调用 `HubClient.notifyBashChunk(sessionId, chunk)`。
- Bash 结束 → 调用 `HubClient.notifyBashStatus(sessionId, running=False, exit_code=...)`。

后端收到 daemon HTTP 上报后，触发 `publish_submitted_messages` 或新增 `publish_session_event` 将事件发布到 Redis session channel。

### Phase 3：前端消费与渲染

在 `frontend/src/lib/daemon.ts` 的 `streamSession` / `SessionStreamEnvelope` 中新增事件类型解析：

- `plan_mode_entered` → 渲染 `PlanApprovalCard`。
- `bash_status` / `bash_chunk` → 渲染 `BashProgressCard`。

新增组件：

- `frontend/src/components/daemon/plan-approval-card.tsx`：计划确认卡片，支持确认/修改/取消。
- `frontend/src/components/daemon/bash-progress-card.tsx`：Bash 进度卡片，显示命令、spinner、实时输出、退出码。
- 改造现有 askuser / permission 弹窗组件，支持最小化为右下角浮动胶囊。

### Phase 4：测试

- backend：新增 `backend/app/modules/daemon/tests/test_session_plan_bash_events.py`，验证事件发布与 plan-response 端点。
- daemon：新增 `sillyhub-daemon/tests/session-plan-bash-events.test.ts`，验证事件上报。
- frontend：新增 `frontend/src/components/daemon/__tests__/plan-approval-card.test.tsx`、`bash-progress-card.test.tsx`、askuser 最小化测试。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `backend/app/modules/daemon/schema.py` 新增 `PlanModeEnteredEvent` / `BashStatusEvent` / `BashChunkEvent` / `PlanResponseRequest` DTO | producer=daemon 上报 → backend router 校验 → Redis publish；consumer=frontend SSE 解析 |
| 新增 | `backend/app/modules/daemon/router.py` 新增 `POST /api/daemon/sessions/{session_id}/plan-response` | producer=frontend PlanApprovalCard 提交 → backend session/service 写入 → WebSocket Hub 通知 daemon |
| 修改 | `backend/app/modules/daemon/run_sync/service.py` | 扩展 `publish_submitted_messages`，新增 plan/bash 事件发布到 `agent_session:{id}` |
| 修改 | `backend/app/modules/daemon/session/service.py` | 新增 `handle_plan_response` 方法，管理 plan 确认状态与 daemon 通知 |
| 新增 | `sillyhub-daemon/src/hub-client.ts` 新增 `notifyPlanModeEntered` / `notifyBashStatus` / `notifyBashChunk` | producer=session-manager turn 事件 → HTTP POST backend → 触发 Redis publish → consumer=frontend |
| 修改 | `sillyhub-daemon/src/interactive/session-manager.ts` | 在 turn 事件流中识别 plan / Bash 并调用上报方法 |
| 新增 | `frontend/src/components/daemon/plan-approval-card.tsx` | Plan 确认 UI |
| 新增 | `frontend/src/components/daemon/bash-progress-card.tsx` | Bash 进度 UI |
| 修改 | `frontend/src/lib/daemon.ts` | `streamSession` 与 `SessionStreamEnvelope` 新增 `plan_mode_entered` / `bash_status` / `bash_chunk` 事件解析 |
| 修改 | `frontend/src/components/daemon/session-panel.tsx` | 接入 PlanApprovalCard、BashProgressCard 渲染与 plan-response 提交 |
| 修改 | `frontend/src/components/permissions/ask-user-dialog-card.tsx` 或等效 askuser 弹窗组件 | 增加最小化/还原状态与浮动胶囊 UI |
| 新增 | `backend/app/modules/daemon/tests/test_session_plan_bash_events.py` | 后端事件发布与 plan-response 测试 |
| 新增 | `sillyhub-daemon/tests/session-plan-bash-events.test.ts` | daemon 事件上报测试 |
| 新增 | `frontend/src/components/daemon/__tests__/plan-approval-card.test.tsx` | Plan 卡片渲染与交互测试 |
| 新增 | `frontend/src/components/daemon/__tests__/bash-progress-card.test.tsx` | Bash 卡片渲染测试 |

## 接口定义

### 后端 → 前端 SSE 事件

```python
class PlanModeEnteredEvent(BaseModel):
    event: Literal["plan_mode_entered"] = "plan_mode_entered"
    session_id: uuid.UUID
    run_id: uuid.UUID
    summary: PlanSummary  # objective, tasks: list[str], design_snippet: str | None
    requested_at: str  # ISO 8601 UTC

class BashStatusEvent(BaseModel):
    event: Literal["bash_status"] = "bash_status"
    session_id: uuid.UUID
    run_id: uuid.UUID
    command: str
    status: Literal["running", "completed", "failed"]
    exit_code: int | None = None
    elapsed_ms: int | None = None

class BashChunkEvent(BaseModel):
    event: Literal["bash_chunk"] = "bash_chunk"
    session_id: uuid.UUID
    run_id: uuid.UUID
    command: str
    channel: Literal["stdout", "stderr"]
    content: str
    is_final: bool = False
```

### 前端 → 后端 Plan 响应

```python
class PlanResponseDecision(str, Enum):
    confirm = "confirm"
    revise = "revise"
    cancel = "cancel"

class PlanResponseRequest(BaseModel):
    decision: PlanResponseDecision
    feedback: str | None = None  # revise/cancel 时必填
```

### daemon → 后端 HTTP 上报

```typescript
interface NotifyPlanModeEnteredBody {
  session_id: string;
  run_id: string;
  summary: { objective: string; tasks: string[]; design_snippet?: string };
}

interface NotifyBashStatusBody {
  session_id: string;
  run_id: string;
  command: string;
  status: "running" | "completed" | "failed";
  exit_code?: number;
  elapsed_ms?: number;
}

interface NotifyBashChunkBody {
  session_id: string;
  run_id: string;
  command: string;
  channel: "stdout" | "stderr";
  content: string;
  is_final: boolean;
}
```

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| plan_mode_entered | daemon → backend → Redis → frontend | frontend | session_id, run_id, summary, requested_at | 会话进入 plan_pending 态，前端渲染 PlanApprovalCard |
| bash_status(running) | daemon → backend → Redis → frontend | frontend | session_id, run_id, command, status | Bash 命令开始，前端渲染/更新 BashProgressCard |
| bash_chunk | daemon → backend → Redis → frontend | frontend | session_id, run_id, command, channel, content | 追加实时输出到 BashProgressCard |
| bash_status(completed/failed) | daemon → backend → Redis → frontend | frontend | session_id, run_id, command, status, exit_code | Bash 命令结束，卡片显示最终状态 |
| plan_response | frontend → backend → WebSocket → daemon | daemon | session_id, run_id, decision, feedback | plan_pending → confirmed/revise/cancel，Agent 收到反馈后继续/修订/终止 |

## 数据模型

本次不新增持久化表。Plan/bash 事件通过 Redis Pub/Sub 实时推送，历史回放依赖现有 `AgentRunLog` 流。

可选增强（若未来需要持久化 plan 决策）：在 `AgentRun` 表新增 `plan_response` JSON 列。本次不做，避免 schema 变更。

## 兼容策略

1. **后端**：新增 SSE 事件类型 `event` 字段为字符串，旧前端代码忽略不认识的事件，无崩溃风险。
2. **daemon**：新增 `HubClient` 方法为纯新增，旧 daemon 不调用，行为不变。
3. **前端**：新增事件解析分支有守卫（先判断 `event` 字段），不认识的事件走原 `log` 处理。
4. ** brownfield 会话**：老会话没有 plan/bash 事件，表现与现在一致。
5. **askuser 最小化**：默认展开态与现有行为一致，最小化是新增能力。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | daemon 识别 plan/Bash 事件的时机不准确，导致事件漏报或重复 | P1 | 在 session-manager turn 事件流的关键节点加日志，单测覆盖三种触发路径；重复事件由前端按 `(run_id, command, event)` 去重 |
| R-02 | plan 确认状态在 backend-daemon 之间不同步 | P1 | plan-response 端点写会话状态后通过现有 WebSocket Hub 发送 `plan_resolved` 消息；daemon 收到后才让 Agent 继续 |
| R-03 | bash_chunk 高频推送导致前端卡顿 | P2 | 后端/daemon 对 chunk 做 100ms 节流 + 单条 content 上限 8KB；前端 BashProgressCard 用虚拟滚动/截断展示 |
| R-04 | askuser 最小化后用户忘记回复 | P2 | 最小化胶囊显示未决数量角标 + 标题闪烁提示；30 分钟后超时回退为普通弹窗 |
| R-05 | 新增 SSE 事件与现有 `permission_request` 事件混淆 | P2 | 事件 `event` 字段唯一命名：`plan_mode_entered` / `bash_status` / `bash_chunk`；前端专用解析分支 |

## 决策追踪

- **D-001@v1**：plan 模式采用强确认交互（类似 askuser 弹窗），前端弹出计划摘要卡片，用户必须选择 confirm / revise / cancel 后 Agent 才继续。
  - type: architecture
  - status: accepted
  - source: user
  - question: plan 模式需要强确认还是弱提示？
  - answer: 强确认，类似 askuser。
  - normalized_requirement: 当 session 收到 `plan_mode_entered` 事件时，必须渲染可交互的 PlanApprovalCard，且 Agent 在收到 `plan_response` 前不得继续执行。
  - impacts: FR-02, task-02, task-06, task-07, verify-02
  - evidence: 用户回答轮次 2026-08-24 10:05

- **D-002@v1**：平台会话反馈修复采用方案 A（复用现有 SSE 事件通道最小侵入）。
  - type: architecture
  - status: accepted
  - source: user
  - question: 选择哪种技术方案？
  - answer: 方案 A，复用现有 Redis `agent_session:{id}` 频道，新增 plan/bash 事件类型。
  - normalized_requirement: 新增事件必须走现有 session SSE 通道，不新建独立通道。
  - impacts: FR-01, FR-02, task-01, task-04, task-05
  - evidence: 用户回答轮次 2026-08-24 10:18

- **D-003@v1**：askuser 弹窗支持最小化，最小化后收缩为右下角浮动胶囊，点击可还原。
  - type: boundary
  - status: accepted
  - source: user
  - question: askuser 弹窗体验优化需求
  - answer: 可最小化，方便用户看会话其他内容。
  - normalized_requirement: 所有 askuser / permission 弹窗必须支持最小化状态，最小化后不遮挡会话主内容。
  - impacts: FR-03, task-08, verify-03
  - evidence: 用户补充需求 2026-08-24 10:22

## 自审

1. **章节齐全性**：背景、目标、非目标、拆分判断、总体方案、文件变更清单、接口定义、生命周期契约表、数据模型、兼容策略、风险登记、决策追踪、自审均已包含。
2. **生命周期契约表**：涉及 session/daemon/agent_run 关键词，已生成契约表，覆盖 plan/bash/plan_response 四类事件。
3. **原型核对**：变更目录已生成 `prototype-platform-session-feedback.html`，满足「建议生成」级别。
4. **字段数据流**：文件变更清单中对新增 DTO 与接口已标注 producer→consumer 数据流。
5. **YAGNI 检查**：非目标中明确排除了远程中断、CLI 协议改造、新持久化表等范围外需求。
6. **⚠️ 自审存疑**：`plan_response` 经 WebSocket Hub 通知 daemon 的具体消息类型（复用 `SessionControl` 还是新增 `PlanResponse`）需在 plan 阶段与现有 protocol.ts 对照后最终确定。
