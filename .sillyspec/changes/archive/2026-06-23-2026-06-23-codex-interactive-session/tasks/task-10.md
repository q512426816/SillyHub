---
author: qinyi
created_at: 2026-06-24 00:13:45
id: task-10
title: 同步模块文档、收敛 quick fix 变更并完成跨层验证
priority: P0
estimated_hours: 3
depends_on: [task-06, task-07, task-08, task-09]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, FR-09, FR-10]
decision_ids: [D-001@v1, D-002@v1, D-003@v1, D-004@v1, D-005@v1, D-006@v1, D-007@v1, D-008@v1, D-009@v1, D-010@v1]
allowed_paths:
  - .sillyspec/docs/sillyhub-daemon/modules/daemon.md
  - .sillyspec/docs/backend/modules/daemon.md
  - .sillyspec/docs/SillyHub/modules/frontend_components.md
  - .sillyspec/docs/SillyHub/modules/frontend_lib.md
  - .sillyspec/knowledge/uncategorized.md
---

# task-10: 同步模块文档、收敛 quick fix 变更并完成跨层验证

## 修改文件

| 文件 | 改动类型 | 摘要 |
| --- | --- | --- |
| `.sillyspec/docs/sillyhub-daemon/modules/daemon.md` | 编辑 | 反映 provider driver 抽象：`SessionManager` 从单一 Claude SDK driver 改为 `drivers: Partial<Record<'claude'\|'codex', InteractiveDriver>>` registry；`_startInteractiveSession` 按 provider 取 executable；`_routeSessionResume` 按 provider 路由 recovery；`onTurnMessage/onTurnResult` 类型放宽为 driver message/result |
| `.sillyspec/docs/backend/modules/daemon.md` | 编辑 | `SessionService.reopen_session()` provider gate 从 `{claude}` 扩为 `{claude, codex}`；`DaemonSessionResumeUnsupported` 文案更新；`AgentSession.agent_session_id` 对 Codex 的语义明确为 Codex thread id；`RunSyncService.submit_messages` flat message 契约 |
| `.sillyspec/docs/SillyHub/modules/frontend_components.md` | 编辑 | `RuntimeSessionDialog` Codex runtime 改走 `InteractiveSessionChatSection`（D-005）；`QuickChatSessionSection` 标注不再作为 `/runtimes` Codex 主路径，仅作全局能力保留；`canReopenSession` 支持 `provider==="codex"`；`AskUserDialogCard` 支持 Codex 归一化 payload（D-010） |
| `.sillyspec/docs/SillyHub/modules/frontend_lib.md` | 编辑 | `InteractiveProvider="claude"\|"codex"` 路径描述更新；`quickChat/streamQuickChat/getQuickChatResult` 标注非 runtime 主路径；`reopenSession/createSession/injectSession` 交互式主路径说明 |
| `.sillyspec/knowledge/uncategorized.md` | 编辑 | 收敛/纠正 2026-06-23 "Codex 对话不能走 interactive SessionManager" 条目（已过时）；补充本变更沉淀的通用经验（provider driver 抽象、Codex app-server JSON-RPC、fail-closed 审批策略） |

## 覆盖来源

| 来源 | 在本任务中的体现 |
| --- | --- |
| design §5.8 模块文档更新清单 | 5 份文档同步要点全部落地 |
| design §4 总体方案 / §5.5 一致性矩阵 | daemon/backend/frontend 文档反映 provider driver 抽象 + parity 矩阵 |
| design §6 生命周期契约表 | 文档反映 create/inject/interrupt/end/reopen/recovery 全链路 |
| design §8 测试计划 + §8.4 集成验收 | 跨层验证命令清单 + 7 步集成验收 |
| plan.md task-10 + 全局验收标准 | 文档与最终代码一致 + 三层测试通过 |
| codex-runtime-conversation-fix（临时变更） | 收敛/归档，纠正已过时的 quick-chat 主路径描述 |
| FR-01~FR-10 | 文档要点逐条对应 |
| D-001@v1~D-010@v1 | 每份文档更新点显式标注覆盖决策 |

## 实现要求

本任务不改任何实现代码，只做三类工作：**文档同步**、**quick fix 收敛**、**跨层验证**。

### 1. 同步 5 份文档反映最终架构

每份文档按以下要点更新（写入对应段落的「契约摘要」「关键逻辑」「变更记录/索引」等小节）：

#### 1.1 `sillyhub-daemon/modules/daemon.md`

- **provider driver 架构（D-001@v1, D-009@v1）**：在「关键逻辑」增加 driver registry 说明 —— `SessionManager` 通过 `this._getDriver(provider)` 选择 `ClaudeSdkDriver` 或 `CodexAppServerDriver`，不再硬编码 Claude；`InputQueue` 队列类型从 `SDKUserMessage` 改为 provider-neutral `UserTurnInput`。
- **executable 按 provider 取（D-002@v1）**：`_startInteractiveSession` 用 `this._agentPaths.get(provider)` 取 executable，无对应 executable 时记录 `interactive_${provider}_executable_not_found` 并 fail lease。
- **recovery 按 provider 路由（D-007@v1）**：`_routeSessionResume` 从 message/session record 归一化 provider 后交给 `SessionManager.restoreAndReconnect(record)`，不再写死 Claude。
- **message/result 类型放宽（D-004@v1）**：`onTurnMessage/onTurnResult` 参数从 Claude SDK 类型放宽为 driver message/result，对 Codex flat message 直接 `submitMessages()`。
- **审批/dialog parity（D-006@v1, D-008@v1）**：`SessionManager` 提供 provider-neutral review/dialog helper；Codex server request 复用 `PermissionResolver`，按 `ask_user_only` 策略 allow-through 或走前端审批卡。
- **变更记录**追加一行：`2026-06-23-codex-interactive-session | SessionManager provider driver 化，接入 CodexAppServerDriver，Codex interactive 复用 AgentSession 生命周期`。

#### 1.2 `backend/modules/daemon.md`

- **Codex reopen（D-003@v1, D-007@v1）**：在「契约摘要」更新 `SessionService` 描述 —— `reopen_session()` provider gate 从 `session.provider != "claude"` 改为 `session.provider not in {"claude", "codex"}`；`DaemonSessionResumeUnsupported` 文案改为 "only claude/codex interactive sessions can be resumed"。
- **thread id 语义**：`AgentSession.agent_session_id` 对 Claude 保存 SDK session id，对 Codex 保存 Codex thread id；reopen lease metadata 补齐 `session_id/agent_session_id/provider/claim_token`。
- **flat message 契约（D-004@v1）**：`RunSyncService.submit_messages()` 接收 Codex flat message（`event_type` + `content` + `metadata` + `session_id`），Codex driver 不把 app-server schema 泄漏到 backend。
- **审批/dialog 通道（D-006@v1, D-008@v1）**：backend 继续以 `PERMISSION_REQUEST/RESPONSE` 作 provider-neutral 通道；Codex `dialog_kind` 标记 `codex_request_user_input` / `mcp_elicitation`。
- **变更记录**追加一行：`2026-06-23-codex-interactive-session | SessionService.reopen_session 放开 Codex，flat message 与 dialog_kind 通道对 Codex 生效`。

#### 1.3 `SillyHub/modules/frontend_components.md`

- **顶部「最近变更」**：从 `codex-runtime-conversation-fix（/runtimes Codex 会话改走 quick-chat 路径）` 改为 `2026-06-23-codex-interactive-session（/runtimes Codex 会话改回 interactive AgentSession 主路径，quick-chat 不再作 runtime Codex 主路径）`（D-005@v1）。
- **组件清单表** `daemon/runtime-session-dialog.tsx` 行：说明改为 `/runtimes 会话弹窗；Claude Code 与 Codex 均走 interactive AgentSession（createSession/injectSession/reopenSession）`。
- **对外接口表**：
  - `RuntimeSessionDialog` Props 说明改为 `按 provider 走 interactive 主路径；Codex 不再分流到 QuickChatSessionSection`（D-005@v1）。
  - `QuickChatSessionSection` 行标注 `全局能力保留，不再作为 /runtimes Codex interactive 主路径入口`（D-005@v1）。
- **`AskUserDialogCard`**：如本变更 task-09 改了归一化逻辑，在变更索引追加一行说明 Codex dialog payload 归一化展示（D-010@v1, D-008@v1）。
- **变更索引**追加一行：`2026-06-23-codex-interactive-session | /runtimes Codex 改回 interactive panel，QuickChatSessionSection 降级为非主路径；AskUserDialogCard 支持 Codex request_user_input / MCP elicitation 归一化 payload`。

#### 1.4 `SillyHub/modules/frontend_lib.md`

- **顶部「最近变更」**：更新为 `2026-06-23-codex-interactive-session`。
- **`daemon.ts` 行**（如文档有列）：`InteractiveProvider="claude"\|"codex"`，`createSession/injectSession/interruptSession/endSession/reopenSession` 对 Codex 生效（D-003@v1, D-007@v1）；`quickChat/streamQuickChat/getQuickChatResult` 标注「非 /runtimes Codex interactive 主路径，全局能力保留」（D-005@v1）。
- **注意事项**：`streamQuickChat` 与 `streamAgentRunLogs` 两条 SSE 说明保留，但补一句「Codex runtime 会话改走 interactive session SSE，quick-chat SSE 不再作为 runtime Codex 主入口」。
- **变更索引**追加一行：同上变更摘要。

#### 1.5 `knowledge/uncategorized.md`

- **纠正过时条目**：`## 2026-06-23 — /runtimes Codex 对话不能走 interactive SessionManager` 内容已过时（本变更已把 Codex 纳入 interactive），改写为历史记录 + 指向本变更，或追加「[已被 2026-06-23-codex-interactive-session 覆盖] Codex 现已走 provider driver interactive 路径」。
- **补充通用经验**（至少 3 条，反映本变更沉淀）：
  - provider driver 抽象：把 SessionManager 从「只驱动单一 provider SDK」改为「按 provider 选 driver」，driver 内部各自做 provider 协议 ↔ provider-neutral `UserTurnInput` 转换，session 生命周期层不依赖具体 SDK 类型。
  - Codex app-server stdio JSON-RPC 长驻 driver：`thread/start` + 串行 `turn/start`（一次只一个 running turn，`turn/completed` 后才消费下一条）；`thread/resume(threadId)` 支持 reopen/recovery。
  - fail-closed 审批策略：server request 默认走 `PermissionResolver`，backend 发送失败/超时/session 已结束/driver 被 interrupt 时返回 deny/cancel，**不无条件自动 accept**，避免 Codex 行为比 Claude 更危险。
  - MCP elicitation 复杂场景如实标注：可归一化成现有 question/options UI 的简单 form/url 才阻塞等待用户，不支持的复杂 schema fail-closed 并上报 error log 说明暂不支持。

### 2. 收敛 quick fix 变更

- `codex-runtime-conversation-fix` 是临时降级变更（前端把 Codex 分流到 quick-chat SSE，避免 daemon `UnsupportedProviderError`）。本变更已覆盖其降级路径（Codex 改回 interactive 主路径），需在文档中：
  - 在 `frontend_components.md` / `frontend_lib.md` 的「最近变更」从 quick fix 切换到本变更。
  - 在 `uncategorized.md` 把 quick fix 沉淀的"Codex 不能走 interactive"经验标记为已被覆盖。
- **不归档本变更自身**（task-10 的产出属于本变更的 Wave6 收尾；归档是后续 verify/archive 阶段的事）。
- quick fix 变更目录（`.sillyspec/changes/codex-runtime-conversation-fix/`）是否归档由后续 verify/archive 阶段决定，本任务只在文档中收敛其影响描述。

### 3. 跨层验证命令清单

按 `.sillyspec/.runtime/local.yaml` 子项目约定执行（本任务只跑验证，不改代码；若验证暴露问题，回到对应 task-0x 修复，不在本任务改实现）：

#### 3.1 daemon 层

```bash
pnpm --dir sillyhub-daemon test
pnpm --dir sillyhub-daemon typecheck
```

通过标准：SessionManager provider driver registry、`create(provider="codex")`、`restoreAndReconnect(provider="codex")`、按 provider 路由 interrupt、CodexAppServerDriver fake child 覆盖 `thread/start`/`turn/start`/`turn/completed`/`turn/interrupt` 全部通过；Claude 现有 interactive 测试不回退。

#### 3.2 backend 层

```bash
cd backend && uv run pytest app/modules/daemon/tests/test_session_service.py app/modules/daemon/tests/test_session_permissions.py -q
```

通过标准：Codex ended session 可 reopen 并生成 reconnecting session + pending lease；非支持 provider 仍抛 `DaemonSessionResumeUnsupported`；Claude reopen 既有测试不变；permission/dialog 策略回归（`ask_user_only=true` 普通审批 allow-through、`ask_user_only=false` 走前端审批卡）通过。

#### 3.3 frontend 层

```bash
pnpm --dir frontend exec vitest run \
  src/components/daemon/runtime-session-dialog.test.tsx \
  src/components/daemon/__tests__/interactive-session-panel.test.tsx

pnpm --dir frontend exec eslint \
  src/components/daemon/runtime-session-dialog.tsx \
  src/components/daemon/runtime-session-helpers.tsx \
  src/components/daemon/runtime-session-dialog.test.tsx
```

通过标准：Codex runtime 首条消息调用 `createSession({provider:"codex"})` 不走 quick-chat；Codex 多轮调用 `injectSession()`；Codex ended session 可点击继续对话并调用 `reopenSession()`；原 "codex quick-chat" 测试改为 "不走 quick-chat"；AskUserDialogCard Codex payload 归一化测试通过。

#### 3.4 集成验收（design §8.4，本机 Codex CLI 可用时半自动）

1. `/runtimes` 打开 Codex runtime；
2. 发送第一条消息，产生 Codex `AgentSession` 和首个 `AgentRun`；
3. 发送第二条消息，仍在同一 `AgentSession`，新增第二个 `AgentRun`；
4. 运行中点击打断；
5. 结束 session；
6. 从历史列表 reopen；
7. daemon restart 后 recover。

## 接口定义

N/A（文档任务）。每份文档需更新的段落要点已在「实现要求 §1」逐条列出，对应覆盖的决策 ID 标注于括号内。

## 边界处理

1. **文档与代码一致**：文档描述必须与 task-01~task-09 最终代码行为一致；若验证阶段发现代码与 design 偏差，先回对应 task 修代码再同步文档，不为了对齐而在文档里夸大或虚构未实现能力。
2. **不夸大未实现能力**：MCP elicitation 复杂 schema 当前 fail-closed，文档须如实标注「暂不支持复杂 form/schema，仅支持可归一化为 question/options 的简单场景」，不写成「全面支持 MCP elicitation」。
3. **quick-chat 全局能力保留**：文档须明确 `QuickChatSessionSection` / `quickChat` / `streamQuickChat` 作为全局能力仍存在，只是不再作为 `/runtimes` Codex interactive 主路径入口；不写成「已删除 quick-chat」。
4. **Codex 缺 thread id 的 session**：ended/failed Codex session 若缺 `agent_session_id`/threadId，文档须如实标注「不能可靠 reopen，应显示失败且不伪造新 thread」，与 design §9 兼容与迁移一致。
5. **Claude Code 不回退**：文档须显式说明 Claude Code 现有 interactive、审批、AskUserQuestion 行为不变，避免读者误以为 Codex 改动波及 Claude。
6. **过时经验纠正**：`uncategorized.md` 中与 quick fix 相关的"Codex 不能走 interactive"经验必须标记为已被覆盖，避免后续任务误用。

## 非目标

1. 不改任何实现代码（daemon/backend/frontend 源码、测试）。
2. 不归档本变更自身（`2026-06-23-codex-interactive-session`）——归档是 verify/archive 阶段职责。
3. 不决定 quick fix 变更（`codex-runtime-conversation-fix`）是否归档，只在文档中收敛其影响描述。
4. 不新增模块文档文件（只编辑现有 5 份）。
5. 不做 design/requirements/plan 的内容修订（本变更规范文档已冻结，本任务只同步模块文档 + knowledge）。

## 参考

- `design.md` §5.8 模块文档更新清单
- `design.md` §4 总体方案（provider driver 抽象）
- `design.md` §5.1~§5.7 详细设计（driver 契约、SessionManager provider 化、CodexAppServerDriver、daemon 接入、parity 矩阵、backend reopen、frontend 取消分流）
- `design.md` §6 生命周期契约表 + §6.1 事件×状态转换矩阵
- `design.md` §8 测试计划 + §8.4 集成验收
- `plan.md` task-10 定义 + 全局验收标准
- `.sillyspec/.runtime/local.yaml` 子项目测试/lint 命令约定

## TDD 步骤

N/A（文档任务，无新代码）。改为验证清单，见「验收标准」。

## 验收标准

| 编号 | 验收项 | 通过标准 |
| --- | --- | --- |
| AC-DOC-01 | `sillyhub-daemon/modules/daemon.md` 更新 | 反映 provider driver registry（D-001/D-009）、executable 按 provider 取（D-002）、recovery 按 provider 路由（D-007）、message/result 类型放宽（D-004）、审批 parity（D-006/D-008）；变更记录追加本变更行 |
| AC-DOC-02 | `backend/modules/daemon.md` 更新 | reopen gate `{claude,codex}`（D-003/D-007）、thread id 语义、flat message 契约（D-004）、dialog_kind 通道（D-006/D-008）；变更记录追加本变更行 |
| AC-DOC-03 | `frontend_components.md` 更新 | 最近变更切到本变更（D-005）、RuntimeSessionDialog Codex 走 interactive、QuickChatSessionSection 标注非主路径、AskUserDialogCard Codex payload（D-010/D-008）；变更索引追加行 |
| AC-DOC-04 | `frontend_lib.md` 更新 | 最近变更切到本变更、daemon.ts interactive 主路径对 Codex 生效、quick-chat 标注非主路径；变更索引追加行 |
| AC-DOC-05 | `uncategorized.md` 更新 | 纠正"Codex 不能走 interactive"过时条目；补 provider driver / app-server JSON-RPC / fail-closed 审批 / MCP elicitation 限制 4 条通用经验 |
| AC-DOC-06 | quick fix 影响收敛 | frontend_components / frontend_lib / uncategorized 中 codex-runtime-conversation-fix 的"主路径"描述全部切到本变更；quick-chat 全局能力保留的事实写明 |
| AC-VERIFY-01 | daemon 测试通过 | `pnpm --dir sillyhub-daemon test` + `pnpm --dir sillyhub-daemon typecheck` 全绿；Codex driver 用例 + Claude 回归用例均通过 |
| AC-VERIFY-02 | backend 测试通过 | `cd backend && uv run pytest app/modules/daemon/tests/test_session_service.py app/modules/daemon/tests/test_session_permissions.py -q` 全绿；Codex reopen + permission/dialog 回归通过 |
| AC-VERIFY-03 | frontend 测试通过 | `pnpm --dir frontend exec vitest run <两个测试文件>` + `pnpm --dir frontend exec eslint <三个文件>` 全绿；Codex interactive 主路径 + 不走 quick-chat 断言通过 |
| AC-VERIFY-04 | 集成验收 7 步（design §8.4） | 本机 Codex CLI 可用时半自动走完：①打开 Codex runtime ②首条消息产生 AgentSession+AgentRun ③第二条消息同 session 新增 run ④运行中打断 ⑤结束 session ⑥历史 reopen ⑦daemon restart recover；任一步失败回到对应 task-0x 修复 |
| AC-DOC-07 | 全部 FR/D 在文档要点中体现 | FR-01~FR-10、D-001@v1~D-010@v1 均在 5 份文档的更新要点中至少出现一次（见实现要求 §1 各小节括号标注） |
