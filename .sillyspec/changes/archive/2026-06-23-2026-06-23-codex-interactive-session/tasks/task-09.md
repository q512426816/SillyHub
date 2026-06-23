---
author: qinyi
created_at: 2026-06-24 00:13:45
id: task-09
title: frontend 复用 AskUserDialogCard 展示 Codex dialog payload 并补齐交互测试
priority: P1
estimated_hours: 4
depends_on: [task-05, task-08]
blocks: [task-10]
requirement_ids: [FR-09]
decision_ids: [D-006@v1, D-008@v1, D-010@v1]
allowed_paths:
  - frontend/src/components/ask-user-dialog-card.tsx
  - frontend/src/components/daemon/interactive-session-panel.tsx
  - frontend/src/lib/daemon.ts
  - frontend/src/components/daemon/__tests__/**
  - frontend/src/components/ask-user-dialog-card.test.tsx
---

# task-09: frontend 复用 AskUserDialogCard 展示 Codex dialog payload 并补齐交互测试

## 修改文件

| 文件 | 类型 | 改动概述 |
| --- | --- | --- |
| `frontend/src/components/ask-user-dialog-card.tsx` | 修改（小） | 确认 `parseQuestions` 已 provider 无关；为 Codex `dialog_kind` 值（`codex_request_user_input` / `mcp_elicitation`）补类型注释；兜底提示文案对 Codex fail-closed 场景保持中性中文文案；不新增 Codex 专属分支。 |
| `frontend/src/components/daemon/interactive-session-panel.tsx` | 修改（小） | 确认 `onPermissionRequest` 分发只按 `dialog_kind` 存在性收卡，不依赖具体 kind 值，从而天然支持 Codex 归一化后的 dialog；如 dispatch 含隐式 kind 白名单需放开。 |
| `frontend/src/lib/daemon.ts` | 修改（注释/类型） | `SessionPermissionRequest.dialog_kind` 注释补 Codex 取值（`codex_request_user_input`、`mcp_elicitation`）；`dialog_payload` 注释说明 Codex 走 task-05 归一化后与 Claude 同构的 `questions/options`。不改运行时逻辑。 |
| `frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx` | 修改/新增 | 补 Codex dialog 卡片渲染、作答回写、resolved 移除测试。 |
| `frontend/src/components/ask-user-dialog-card.test.tsx` | 修改/新增 | 补 `dialog_kind=codex_request_user_input`、`mcp_elicitation` 的渲染与提交断言；补 Codex schema 归一化后 payload 与 Claude 同构用例。 |

> 说明：task-05（daemon 层）负责把 Codex `item/tool/requestUserInput` 与可归一化 MCP elicitation 转成与 Claude `AskUserQuestion` 同构的 `questions/options` payload，并经 backend `permission_service` 以 `permission_request` + `dialog_kind` + `dialog_payload` 形态 publish。task-08 已让 Codex 走 interactive session 的 permission/dialog SSE 通道。本任务只做前端复用与测试，不改 daemon 归一化逻辑、不改 backend 持久化。

## 覆盖来源

| 来源 | 章节 | 关键约束 |
| --- | --- | --- |
| requirements.md | FR-09 | daemon 归一化为 `AskUserDialogCard` 可渲染的 `questions/options`；frontend 展示卡片；用户回答后 daemon 还原 Codex `{answers:{[questionId]:{answers:string[]}}}`；复杂 MCP elicitation fail-closed 并记录。 |
| design.md §5.3 第5点 | requestUserInput/MCP elicitation 归一化 | `item/tool/requestUserInput` → `dialog_kind=codex_request_user_input`；`mcpServer/elicitation/request` → `dialog_kind=mcp_elicitation`；只对可归一化的简单 form/url 阻塞等待，复杂 schema fail-closed。 |
| design.md §5.7 | frontend 改动 | `AskUserDialogCard` 必要时支持归一化后的 Codex dialog payload 展示（D-010@v1）。 |
| decisions.md D-006@v1 | permission/dialog 策略一致性 | Codex 与 Claude 共用 provider-neutral permission/dialog hook，前端交互面一致。 |
| decisions.md D-008@v1 | permission/dialog hook 在 SessionManager 层 | hook 以 sessionId/currentRunId/requestId 为核心，前端复用 `permission_request/permission_resolved` SSE。 |
| decisions.md D-010@v1 | Codex dialog payload 双向归一化 | daemon 归一化为 `AskUserDialogCard` 可渲染结构，前端无需识别 Codex schema。 |

## 实现要求

1. **复用而非新建**：禁止新建 Codex 专属卡片。`AskUserDialogCard` 现有 `parseQuestions` 只依赖 `questions[].question/header/multiSelect/options[].label/description/preview`，已是 provider 无关；task-05 归一化后 Codex payload 必须命中这组字段，前端零条件分支即可渲染。
2. **dialog_kind 透传**：`interactive-session-panel.tsx` 的 `onPermissionRequest` 当前以 `if (!req.dialog_kind) return;` 收卡——只看是否存在 kind，不看具体值。需确认没有对 `dialog_kind === "ask_user"` 的隐式白名单（如有需放开为"任意非空 dialog_kind"）。Codex 的 `codex_request_user_input`、`mcp_elicitation` 与 Claude 的 `ask_user` 一视同仁渲染为 `AskUserDialogCard`。
3. **响应回写路径不变**：用户作答后仍走 `respondSessionPermission(session_id, request_id, "allow", undefined, { answers: [...] })`。还原 Codex `{answers:{[questionId]:{answers:string[]}}}` 的 schema 映射是 daemon/backend（task-05）的职责，前端只产出与 Claude 同构的 `answers` 数组，不在前端做 Codex schema 还原。
4. **MCP elicitation 简单 form/url**：task-05 把可归一化（单/多选、文本输入）的 elicitation 转成同构 `questions/options`，前端表现与 `requestUserInput` 一致；复杂 schema 由 daemon fail-closed，不会产生待答卡片，前端无需特殊处理。
5. **fail-closed 前端表现**：复杂 MCP elicitation fail-closed 时 daemon 已发 error flat message 并 deny，session 继续或失败由 driver 决定；前端不渲染卡片，日志区按现有 error/tool 渲染规则显示。本任务只验证"不产生卡片"与"不崩溃"。
6. **类型与注释**：`lib/daemon.ts` 的 `dialog_kind` / `dialog_payload` JSDoc 补 Codex 取值说明，使后续维护者明确 kind 来源。不放宽运行时校验。
7. **UI 文案中文**：卡片 header「智能体提问」、提交按钮「提交回答」、兜底「无法解析提问内容…」保持中文；`dialog_kind` badge 直接显示后端传入的 kind 字符串（`codex_request_user_input` / `mcp_elicitation` / `ask_user`），不做翻译（专业标识）。

## 接口定义

### 前端消费的 dialog payload（task-05 归一化后，与 Claude 同构）

```ts
// frontend/src/components/ask-user-dialog-card.tsx 已定义
interface DialogOption { label: string; description?: string; preview?: string }
interface DialogQuestion { question: string; header?: string; multiSelect?: boolean; options: DialogOption[] }
interface DialogPayload { questions: DialogQuestion[] }
```

### SessionPermissionRequest（Codex 场景字段值）

| 字段 | Claude (`ask_user`) | Codex requestUserInput | Codex MCP elicitation（可归一化） |
| --- | --- | --- | --- |
| `dialog_kind` | `"ask_user"` | `"codex_request_user_input"` | `"mcp_elicitation"` |
| `dialog_payload` | `{questions:[...]}` | task-05 归一化为 `{questions:[...]}` | task-05 归一化为 `{questions:[...]}` |
| `tool_name` | `"AskUserQuestion"` | Codex 工具名 | MCP server 名 |

### 渲染与响应回写流程

```
backend publish permission_request(dialog_kind, dialog_payload)
  → SSE onPermissionRequest(req)
  → req.dialog_kind 非空 → 加入 pendingRequests 队列（按 request_id 去重）
  → <AskUserDialogCard request={req}> 渲染（parseQuestions 读 dialog_payload.questions）
  → 用户作答 → handleSubmit
  → respondSessionPermission(session_id, request_id, "allow", undefined, {answers:[{question,header?,answer}]})
  → backend 转发 daemon → task-05 还原 Codex schema → app-server response
  → backend publish permission_resolved(request_id) → SSE onPermissionResolved → 移除卡片
```

> 提交的 `answers` 数组结构与 Claude 完全一致；Codex schema 还原（`{answers:{[questionId]:{answers:string[]}}}`）在 daemon 侧完成，前端不感知。

## 边界处理

1. **复杂 MCP elicitation 不可渲染**：daemon fail-closed，前端收不到 `dialog_kind` 卡片；若 daemon 仍发了不可解析的 `dialog_payload`（questions 缺失/空/非数组），`AskUserDialogCard` 已有兜底分支渲染「无法解析提问内容（dialog_payload 缺失或格式不符），请刷新页面重试」，不崩溃。本任务补一条用例断言该兜底对 Codex kind 同样生效。
2. **超时**：AskUserDialogCard 无前端倒计时（设计明确 backend 对 AskUser/dialog 不设 5min 超时）；卡片长期等待用户。session 被 end/interrupt 时 `onSessionEnded` 清空 `pendingRequests`，避免死卡。本任务验证 session ended 时 Codex 待答卡被清空。
3. **多 question**：Codex `requestUserInput` 可能含多个 question；`AskUserDialogCard` 已支持多 question 逐个作答，全部作答后提交按钮才启用。补一条多 question Codex 用例。
4. **空 options**：某 question 的 options 为空 → `parseQuestions` 跳过该条；若全部跳过则 `questions.length === 0` 走兜底分支。验证 Codex payload options 为空时不渲染半残卡片。
5. **与 Claude AskUserQuestion 一致**：同一份 `AskUserDialogCard` 组件、同一 `respondSessionPermission` 调用、同一 SSE 移除逻辑；Codex 卡片除 `dialog_kind` badge 文本不同外，UI 与交互与 Claude 完全一致。验证 Claude 既有测试不回归。
6. **request_id 去重**：SSE 重连或 `fetchPendingDialogs` 恢复可能重复推送同一 Codex dialog；`onPermissionRequest` 已按 `request_id` 去重，补一条重复推送断言。
7. **ended/failed 不回显**：session 终态时面板已过滤 `pendingRequests` 渲染（`view.status !== "ended" && !== "failed"`），Codex 卡片同样不回显。

## 非目标

- 不新增 Codex 专属审批/对话 UI 组件（design 非目标 §2.2）。
- 不改 daemon 对 Codex payload 的归一化逻辑（task-05 负责 D-010@v1 双向归一化）。
- 不改 backend `permission_service` 持久化与 publish（task-08 已完成 permission/dialog 通道）。
- 不在前端做 Codex `{answers:{[questionId]:{answers:string[]}}}` schema 还原（daemon 职责）。
- 不处理普通 command/file/permission 审批卡（FR-08，由 `/runtimes` 审批面板负责，无 `dialog_kind`）。
- 不改 quick-chat 相关代码（task-05 / task-07 负责）。

## 参考

- 现有 Claude `AskUserQuestion` 流程：`frontend/src/components/ask-user-dialog-card.tsx`（`parseQuestions` + `handleSubmit` + `respondSessionPermission`）。
- 面板 dialog 收发：`frontend/src/components/daemon/interactive-session-panel.tsx` 的 `onPermissionRequest` / `onPermissionResolved` / `handleDialogResolved` / `fetchPendingDialogs` effect / `onSessionEnded` 清空。
- 类型定义：`frontend/src/lib/daemon.ts` 的 `SessionPermissionRequest`、`respondSessionPermission`、`parseSessionPermissionEvent`、`fetchPendingDialogs`。
- 现有测试基线：`frontend/src/components/ask-user-dialog-card.test.tsx`（单选/多选/手动输入/提交/兜底）、`frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx`（含 `dialog_kind:"ask_user"` 渲染用例，约 862-905 行）。

## TDD 步骤

1. **先写测试（ask-user-dialog-card.test.tsx 新增 describe/it）**：
   - `dialog_kind:"codex_request_user_input"` + 标准 `{questions:[...]}` payload → 渲染问题文本、选项、badge 显示 `codex_request_user_input`。
   - 同上 → 单选作答 → 提交 → 断言 `respondSessionPermission` 被以 `(sess, req, "allow", undefined, {answers:[{question,answer}]})` 调用。
   - `dialog_kind:"mcp_elicitation"` + 多 question + multiSelect → 多选作答 → 提交 answers 数组。
   - `dialog_kind:"codex_request_user_input"` + `dialog_payload` 缺 questions → 渲染兜底「无法解析提问内容…」不崩溃。
   - `dialog_kind:"codex_request_user_input"` + 某 question options 为空 → 该条被跳过；全空走兜底。
2. **先写测试（interactive-session-panel.test.tsx 新增 it）**：
   - 模拟 SSE 推送 `permission_request` 且 `dialog_kind:"codex_request_user_input"` → 面板渲染 `AskUserDialogCard`（可见问题文本）。
   - 用户提交后 → `permission_resolved` SSE → 卡片移除。
   - 模拟 session ended SSE → Codex 待答卡被清空。
   - 重复推送同 `request_id` 的 Codex dialog → 只渲染一张卡。
3. **跑测试确认红**：`pnpm --dir frontend exec vitest run src/components/ask-user-dialog-card.test.tsx src/components/daemon/__tests__/interactive-session-panel.test.tsx`。
4. **最小实现**：根据红的用例，在 `ask-user-dialog-card.tsx` / `interactive-session-panel.tsx` / `daemon.ts` 做注释/类型/可能的 dispatch 放开（若现有代码已 provider 无关，多数用例应直接转绿，仅补注释）。
5. **跑测试确认绿** + `pnpm --dir frontend exec eslint <allowed_paths>`。
6. **回归**：确保 Claude `ask_user` 既有用例全绿。

## 验收标准

| 编号 | 验收点 | 验证方式 | 覆盖 |
| --- | --- | --- | --- |
| AC-1 | `dialog_kind="codex_request_user_input"` 的 permission_request 能被 `AskUserDialogCard` 渲染（问题/选项/header/badge 可见） | vitest 断言 DOM 文本 | FR-09, D-010@v1 |
| AC-2 | `dialog_kind="mcp_elicitation"` 简单 form/url 归一化 payload 渲染表现与 requestUserInput 一致 | vitest 渲染断言 | FR-09, D-010@v1 |
| AC-3 | 用户作答后调用 `respondSessionPermission(sess, req, "allow", undefined, {answers:[...]})`，answers 结构与 Claude 同构 | vitest mock 断言调用参数 | FR-09, D-008@v1 |
| AC-4 | `permission_resolved` SSE 到达后卡片移除；session ended SSE 清空 Codex 待答卡 | vitest 模拟 SSE + DOM 断言 | FR-09, D-006@v1 |
| AC-5 | 重复 request_id 的 Codex dialog 只渲染一张卡 | vitest 去重断言 | FR-09 |
| AC-6 | 复杂/空 options/缺 questions 的 Codex payload 走兜底分支，不崩溃 | vitest 断言兜底文案 | FR-09, D-010@v1（fail-closed 前端表现） |
| AC-7 | 多 question Codex dialog 全部作答后提交按钮才启用 | vitest disabled 断言 | FR-09 |
| AC-8 | Claude `ask_user` 既有测试全部不回归 | vitest 全量 ask-user-dialog-card + panel 测试绿 | FR-09, D-006@v1 |
| AC-9 | `lib/daemon.ts` 的 `dialog_kind`/`dialog_payload` JSDoc 补 Codex 取值说明 | code review | D-008@v1 |
| AC-10 | `pnpm --dir frontend exec eslint` 对 4 个 allowed path 通过 | lint 命令 | 非功能 |
