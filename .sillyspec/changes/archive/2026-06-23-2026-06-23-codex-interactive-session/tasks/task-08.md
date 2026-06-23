---
author: qinyi
created_at: 2026-06-24 00:13:45
id: task-08
title: frontend `/runtimes` Codex 改走 interactive panel 与 create/inject/reopen 路径
priority: P0
estimated_hours: 6
depends_on: [task-06, task-07]
blocks: [task-09, task-10]
requirement_ids: [FR-01, FR-02, FR-05, FR-06, FR-07]
decision_ids: [D-003@v1, D-005@v1, D-007@v1]
allowed_paths:
  - frontend/src/components/daemon/runtime-session-dialog.tsx
  - frontend/src/components/daemon/runtime-session-helpers.tsx
  - frontend/src/components/daemon/interactive-session-panel.tsx
  - frontend/src/components/daemon/runtime-session-dialog.test.tsx
  - frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx
---

# task-08: frontend `/runtimes` Codex 改走 interactive panel 与 create/inject/reopen 路径

> 所属变更：2026-06-23-codex-interactive-session；Wave 5；阻塞 task-09（Codex dialog 卡片复用）与 task-10（文档收敛/跨层验证）。
> 依据文档：design.md §4.1、§5.7、§11；requirements.md FR-01/02/05/06/07；decisions.md D-003@v1 / D-005@v1 / D-007@v1；模块文档 frontend_components.md。
> 前置依赖：task-06（daemon 已按 provider 取 executable + Codex recovery 不再抛 UnsupportedProviderError）、task-07（backend `reopen_session` 已放开 `{"claude","codex"}`）。本任务在它们完成后才有意义，否则 Codex create/inject/reopen 会触发 daemon/backend 拒绝。

## 修改文件

| 文件 | 改动类型 | 职责 |
| --- | --- | --- |
| `frontend/src/components/daemon/runtime-session-dialog.tsx` | 撤销 quick-chat 分流 | 删除 `isCodexRuntime` 分支与对 `QuickChatSessionSection` 的引用；Codex runtime 与 Claude runtime 走同一 interactive 渲染路径（SessionsSidebar + attach/idle/history 三态） |
| `frontend/src/components/daemon/runtime-session-helpers.tsx` | 放开 Codex 可用 provider 与 reopen | `SUPPORTED_SESSION_PROVIDERS` 恢复 `["claude","codex"]`；`canResumeSession` / `resumeDisabledTitle` 支持 `provider === "codex"`；`QuickChatSessionSection` 保留但不再被 runtime 主路径引用 |
| `frontend/src/components/daemon/interactive-session-panel.tsx` | 仅核对/最小适配 | 确认 `createSession` / `injectSession` 已按 `provider` 参数化（现状已支持），无需新增 Codex 专属逻辑；如 focusProvider=codex 时 provider 下拉需含 codex，验证 `providers` 传入正确 |
| `frontend/src/components/daemon/runtime-session-dialog.test.tsx` | 改测试 | 删除「codex runtime → quick-chat」用例，改为「codex runtime → createSession({provider:'codex'}) 不走 quick-chat」；改 codex ended 用例为可点继续对话 + 调 reopenSession |
| `frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx` | 补测试 | 新增 codex provider 路径用例：首发 createSession({provider:'codex'})、多轮 injectSession、不调用 quickChat |

## 覆盖来源

| 需求/决策 | 来源条款 | 本任务落实点 |
| --- | --- | --- |
| FR-01 Codex 创建 interactive session | requirements.md FR-01；design §5.7 | Codex runtime 首条消息调 `createSession({provider:"codex"})`，不再走 `quickChat` |
| FR-02 Codex 同 session 多轮 | requirements.md FR-02；design §5.7 | Codex 第二条消息调 `injectSession(sessionId,prompt)`，不开 quick-chat run |
| FR-05 end 与历史回看 | requirements.md FR-05 | Codex active/running 可点结束；ended Codex session 进入 `SessionHistoryView` 只读回看 |
| FR-06 reopen 与 recovery | requirements.md FR-06；design §5.7.2 | ended/failed Codex session（有 `agent_session_id`）「继续对话」按钮可用并调 `reopenSession` |
| FR-07 不走 quick-chat | requirements.md FR-07；D-005@v1 | Codex runtime 渲染 `InteractiveSessionChatSection`，不渲染 `QuickChatSessionSection`；测试断言不调用 quick-chat API |
| D-003@v1 backend 复用 session 控制面 | decisions.md D-003 | frontend 不引入 Codex 专属会话 API，全部走 `createSession/injectSession/interruptSession/endSession/reopenSession` |
| D-005@v1 `/runtimes` Codex interactive 主路径 | decisions.md D-005 | 撤销 `codex-runtime-conversation-fix` 的 quick-chat 分流，Codex 与 Claude 同一链路 |
| D-007@v1 reopen 要求 thread id | decisions.md D-007 | `canResumeSession` 对 codex 要求 `agent_session_id` 非空；无 threadId 的 codex session 继续按钮置灰并提示「会话未建立，无法续聊」 |

## 实现要求

参照 design.md §5.7「Frontend 取消 Codex quick-chat 分流」：

1. **RuntimeSessionDialog 撤销分流（D-005）**：删除 `runtime-session-dialog.tsx` 中 `isCodexRuntime` 变量及其驱动的所有分支：
   - 删除 `const isCodexRuntime = runtimeProvider === "codex";`
   - 删除 effect 中 `|| isCodexRuntime` 对 `reloadSessions` 的跳过（恢复 Codex runtime 也加载历史会话列表）
   - 删除 header 中 `isCodexRuntime` 的副标题文案分支（统一显示「历史仅显示该运行时的会话，新建会话使用此提供方」）
   - 删除 header 中 `{!isCodexRuntime && (...)}` 的「刷新会话」按钮条件包裹（对所有 provider 显示）
   - 删除 JSX 中 `isCodexRuntime ? <QuickChatSessionSection provider="codex" /> : (...)` 三元，统一走 `SessionsSidebar` + `InteractiveSessionChatSection`/`SessionHistoryView` 三态结构
   - 移除 `QuickChatSessionSection` 的 import（runtime-session-dialog.tsx 不再引用）；如 helpers 仍导出该组件可保留导出但不在此文件 import
   - `focusProvider={runtime?.provider ?? undefined}` 对 Codex 传 `"codex"`，由 helpers/panel 决定默认 provider
2. **SUPPORTED_SESSION_PROVIDERS 恢复 codex（D-005 / D-003）**：`runtime-session-helpers.tsx` 中 `InteractiveSessionChatSection` 的 `onlineProviders` 计算把 `SUPPORTED_SESSION_PROVIDERS` 从 `["claude"]` 改回 `["claude","codex"]`；删除注释中「Codex 走下方 QuickChatSessionSection」「不能混入 createSession」的过时说明，改为「Codex 与 Claude 均走 interactive SessionManager」。
3. **canReopenSession / 继续对话按钮支持 codex（D-007）**：
   - `canResumeSession(session)`：provider 条件从 `=== "claude"` 放宽为 `=== "claude" || === "codex"`，其余（`agent_session_id` 非空 + 状态 ended/failed）不变
   - `resumeDisabledTitle(session)`：删除 `if (session.provider !== "claude") return "codex 暂不支持续聊";` 分支；改为 provider 非 claude/codex 才提示不支持（当前仅这两种 provider，实际该分支可简化为「会话未建立，无法续聊」兜底）；保留无 `agent_session_id` 时「会话未建立，无法续聊」
4. **QuickChatSessionSection 保留但退出主路径**：`QuickChatSessionSection` 及其依赖（`quickChat`/`streamQuickChat`/`getQuickChatResult` import）在 helpers 中保留导出（design §2.2 非目标：不删除 quick-chat 全局能力），但 `runtime-session-dialog.tsx` 不再引用。helpers 文件顶部注释更新：quick-chat 仅作 brownfield 回归保留，不再是 runtime Codex 主路径。
5. **interactive-session-panel.tsx 核对（最小改动）**：该组件已按 `provider` state 调 `createSession({provider: provider as InteractiveProvider, ...})` 和 `injectSession(sessionId, prompt)`，对 codex 无天然排斥。本任务只需：
   - 确认 `defaultProvider` / `providers` props 在 Codex runtime 传入时含 `"codex"`（由 helpers 的 `focusProvider` + `onlineProviders` 保证）
   - 若 `focusProvider="codex"` 且 codex 在线，`defaultProvider` 应解析为 `"codex"`（现状 `focusProvider ?? attachSession?.provider ?? (claude优先) ?? onlineProviders[0]` 已满足）
   - 不新增 Codex 专属 UI；provider 下拉、token 显示、turn 状态徽章对 codex 复用
6. **测试改写（TDD 先行）**：
   - `runtime-session-dialog.test.tsx`：
     - 删除用例「codex runtime → 使用 quick-chat 面板发送，不走 interactive streamSession」
     - 新增用例「codex runtime → 渲染 interactive 面板，首发调 createSession({provider:'codex'}) 且不调 quickChat」：渲染 codex runtime dialog，验证出现「交互式会话」header（而非「Codex 快速对话」），`listAgentSessions` 被调用（历史加载恢复），输入发送后 `createSession` 以 `{provider:'codex', prompt}` 被调，`quickChat`/`streamQuickChat` 均未被调用
     - 改写用例「codex ended session → 只读 + disabled 继续对话 with codex title」为「codex ended session（有 agent_session_id）→ 继续对话可点 → reopen→attach」：断言按钮 `disabled === false`，点击后 `reopenSession` 以 session id 被调，随后 `streamSession` 建立
     - 新增用例「codex ended session 无 agent_session_id → 继续对话置灰，title=会话未建立」
   - `__tests__/interactive-session-panel.test.tsx`：
     - 新增「codex provider 首发 → createSession({provider:'codex'})」：`setupPanel({providers:['claude','codex'], defaultProvider:'codex'})`，发送后断言 `createSession` 被 `expect.objectContaining({provider:'codex'})` 调用
     - 新增「codex 多轮 → injectSession，SSE 仅 1 次」：首发后 turn_completed，第二条走 injectSession
     - 新增「codex 路径全程不调用 quickChat」（mock 中加 `quickChat: vi.fn()` 并断言未调，或依赖 importActual 不 mock quickChat 时其真实实现会发 fetch，改用 spy 断言 not.toHaveBeenCalled）
7. **文案中文化**：所有新增/修改的 UI 文案与 title 提示保持中文（项目规则）；不引入英文术语除非专业必要。

## 接口定义

本任务不新增对外接口，仅调整现有组件内部逻辑与 helper 返回值。关键契约：

| 符号 | 位置 | 现状（quick-chat 分流期） | 目标 |
| --- | --- | --- | --- |
| `SUPPORTED_SESSION_PROVIDERS` | runtime-session-helpers.tsx `InteractiveSessionChatSection` 内 | `["claude"]` | `["claude","codex"]` |
| `canResumeSession(session)` | runtime-session-helpers.tsx | `provider === "claude" && agent_session_id && (ended\|failed)` | `(provider === "claude" \|\| provider === "codex") && agent_session_id && (ended\|failed)` |
| `resumeDisabledTitle(session)` | runtime-session-helpers.tsx | codex → 「codex 暂不支持续聊」 | 删除 codex 专属分支；无 agent_session_id → 「会话未建立，无法续聊」 |
| `RuntimeSessionDialog` Codex 渲染分支 | runtime-session-dialog.tsx | `isCodexRuntime ? <QuickChatSessionSection> : <interactive 三态>` | 删除三元，统一 interactive 三态 |
| `reloadSessions` effect 跳过条件 | runtime-session-dialog.tsx | `if (!open \|\| !runtimeId \|\| isCodexRuntime) return;` | `if (!open \|\| !runtimeId) return;` |
| `createSession` 调用 | interactive-session-panel.tsx | `createSession({provider: provider as InteractiveProvider, ...})` | 不变（provider state 由 defaultProvider=codex 注入） |
| `reopenSession` 调用 | runtime-session-dialog.tsx `handleContinue` | `reopenSession(session.id)`（已与 provider 无关） | 不变（backend task-07 已放开 codex） |
| `QuickChatSessionSection` 导出 | runtime-session-helpers.tsx | 导出且被 dialog 使用 | 保留导出，dialog 不再 import |

**分流逻辑删除点清单（runtime-session-dialog.tsx）**：
- L130 `const isCodexRuntime = runtimeProvider === "codex";` — 删
- L157 `if (!open || !runtimeId || isCodexRuntime) return;` → 去掉 `|| isCodexRuntime`
- L159 effect deps `isCodexRuntime` — 去掉
- L288-291 header 副标题三元 — 统一文案
- L293 `{!isCodexRuntime && (...)}` 刷新按钮条件 — 去掉条件
- L305-309 `isCodexRuntime ? <QuickChatSessionSection> : (...)` — 删除三元，保留 else 分支
- import 行 L31 `QuickChatSessionSection` — 从 import 列表移除

## 边界处理

1. **Claude 行为不变（FR-10）**：撤销分流后 Claude runtime 的 attach/idle/history 三态、SSE、interrupt、end、reopen 路径完全保持；现有 Claude 用例（用例 1-4、6）必须继续通过，不得因删除 `isCodexRuntime` 影响非 codex 分支。
2. **quick-chat 组件保留可用**：`QuickChatSessionSection` 不删除，仍从 helpers 导出；若其它页面（未来）或 brownfield 回归需要可继续使用。helpers 中 `quickChat`/`streamQuickChat`/`getQuickChatResult` 的 import 保留（供 QuickChatSessionSection 使用），但 dialog 不再引用这些 API。
3. **ended/failed Codex 无 threadId（D-007）**：`canResumeSession` 对 codex 仍要求 `agent_session_id` 非空。历史脏数据中 create 未成功（`agent_session_id=null`）的 failed codex session，继续按钮置灰，title 显示「会话未建立，无法续聊」，不伪造恢复、不调 reopenSession。
4. **历史列表恢复加载**：撤销分流后 Codex runtime 也会调 `listAgentSessions` 并按 `runtime_id` 过滤显示历史会话；需确认 `listAgentSessions` mock 在 codex 用例中返回合理数据，避免列表为空误判。
5. **initialSessionId URL 恢复点（D-003）**：`initialSessionId` 对 codex runtime 同样生效——若 URL `?session=<id>` 指向一个活跃的 codex session 且属于当前 runtime，open 后应自动 attach（走 `InteractiveSessionChatSection` attach 模式建 SSE + 轮询 active）。撤销分流后该路径对 codex 自然可用，无需额外分支。
6. **provider 下拉与 focusProvider**：Codex runtime 打开时 `focusProvider="codex"`，helpers 解析 `defaultProvider="codex"`，panel provider 下拉锁定/默认 codex；若该 runtime 不在线（`status !== "online"`）则 `hasOnlineProvider=false`，发送禁用，placeholder 提示「没有在线守护进程」——与 Claude 离线行为一致。
7. **attach 轮询与 SSE 复用**：codex session attach/reopen 后的 `getAgentSession` 轮询（ATTACH_POLL_MS=1500）与 `streamSession` SSE 对 codex 复用，不新增 codex 专属恢复逻辑；轮询到 active 即启用输入，超时/failed 回退只读。

## 非目标

- 不删除 `QuickChatSessionSection` 全局能力及 `quickChat`/`streamQuickChat`/`getQuickChatResult` API（design §2.2）。
- 不改 backend（task-07 已完成 reopen 放开）与 daemon（task-06 已完成 provider executable + recovery）。
- 不新增 Codex 专属审批/对话 UI；Codex dialog 卡片归一化由 task-09 处理。
- 不改 `interactive-session-panel.tsx` 的 SSE 事件处理、turn 状态机、token 显示逻辑（对 codex 复用）。
- 不调整 dialog 卡片渲染细节（如 AskUserDialogCard 在 codex 下的展示）——留 task-09。
- 不动 `lib/daemon.ts` 的 API 签名（`InteractiveProvider` 已含 codex，`createSession`/`injectSession`/`reopenSession` 已 provider 化）。
- 不处理 `codex-runtime-conversation-fix` 变更的 archive（由 task-10 收敛）。

## 参考

- 现有 Claude interactive 路径：`runtime-session-dialog.tsx` 三态结构（SessionsSidebar + InteractiveSessionChatSection attach/idle + SessionHistoryView）、`interactive-session-panel.tsx` create/inject/interrupt/end/streamSession。
- `frontend/src/lib/daemon.ts`：`InteractiveProvider = "claude" | "codex"`（L495）、`createSession`（L529，按 `input.provider` POST）、`injectSession`（L553）、`reopenSession`（L873）、`AgentSessionRead.agent_session_id`（L816）。
- design.md §5.7 改动清单 1-4；§11 验收标准前 2 条 + 第 5 条。
- decisions.md D-005（evidence: runtime-session-dialog.tsx）、D-007（evidence: session/service.py，frontend 侧 canResumeSession 对齐）。
- 模块文档 `frontend_components.md` L31/L63/L114（codex-runtime-conversation-fix 记录需在 task-10 更新为「已回退到 interactive」）。

## TDD 步骤

遵循项目「文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收 → 更新文档」顺序：

1. **读现有代码**（已完成）：runtime-session-dialog.tsx、runtime-session-helpers.tsx、interactive-session-panel.tsx、两份测试、lib/daemon.ts 相关签名。
2. **先改测试（红）**：
   - `runtime-session-dialog.test.tsx`：删 quick-chat 用例 → 加 codex create/inject 用例 + 改 codex ended reopen 用例 + 加无 threadId 置灰用例
   - `interactive-session-panel.test.tsx`：加 codex provider create/inject 用例 + 不调 quickChat 断言
   - 运行 `pnpm --dir frontend exec vitest run src/components/daemon/runtime-session-dialog.test.tsx src/components/daemon/__tests__/interactive-session-panel.test.tsx` 确认新测试失败（红）
3. **改组件（绿）**：
   - `runtime-session-dialog.tsx`：按「分流逻辑删除点清单」删 `isCodexRuntime` 全部分支 + 移除 QuickChatSessionSection import
   - `runtime-session-helpers.tsx`：`SUPPORTED_SESSION_PROVIDERS` 恢复 codex；`canResumeSession`/`resumeDisabledTitle` 放开 codex；更新注释
   - `interactive-session-panel.tsx`：仅当测试暴露问题时最小适配（预期无需改）
4. **跑测试（绿）**：重跑上述 vitest 命令，全部通过。
5. **lint/类型**：`pnpm --dir frontend exec eslint src/components/daemon/runtime-session-dialog.tsx src/components/daemon/runtime-session-helpers.tsx src/components/daemon/runtime-session-dialog.test.tsx`；`pnpm --dir frontend exec tsc --noEmit`（如项目配置）。
6. **验收**：对照下方验收标准表格逐条核对。
7. **更新文档**：frontend_components.md 的「最近变更」与组件清单在 task-10 统一更新（本任务不单独改文档，但需在 task-10 蓝图体现「回退 quick-chat 分流」）。

## 验收标准

| ID | 验收点 | 覆盖 | 验证方式 |
| --- | --- | --- | --- |
| AC-08-01 | Codex runtime 打开弹窗渲染「交互式会话」header，不渲染「Codex 快速对话」header | FR-07, D-005 | 测试：`screen.getByText(/交互式会话/)` 存在；`screen.queryByText(/Codex 快速对话/)` 不存在 |
| AC-08-02 | Codex runtime 首条消息调 `createSession({provider:'codex', prompt})`，不调 `quickChat`/`streamQuickChat` | FR-01, FR-07, D-003, D-005 | 测试：`createSession` called with `expect.objectContaining({provider:'codex'})`；`quickChat` not called；`streamQuickChat` not called |
| AC-08-03 | Codex runtime 第二条消息调 `injectSession(sessionId, prompt)`，SSE 累计仅 1 次，不调 `quickChat` | FR-02, D-003, D-005 | 测试：首发 createSession + turn_completed 后，第二条触发 `injectSession`；`streamSession` called once；`quickChat` not called |
| AC-08-04 | Codex runtime 历史列表正常加载（`listAgentSessions` 被调）并按 `runtime_id` 过滤 | FR-05, D-003 | 测试：codex runtime open 后 `listAgentSessions` called；列表仅显示该 runtime 会话 |
| AC-08-05 | ended Codex session（有 `agent_session_id`）进入只读 `SessionHistoryView`，「继续对话」按钮 `disabled=false`，点击后调 `reopenSession(id)` 并建 SSE attach | FR-06, D-007 | 测试：按钮 enabled；click → `reopenSession` called with id；`streamSession` called with id；出现「交互式会话」 |
| AC-08-06 | ended/failed Codex session 无 `agent_session_id` 时「继续对话」置灰，title 含「会话未建立」，点击不调 `reopenSession` | FR-06, D-007 | 测试：`disabled===true`；`getAttribute('title')` 匹配 /会话未建立/；click 后 `reopenSession` not called |
| AC-08-07 | `canResumeSession` 对 `provider==='codex' && agent_session_id && (ended\|failed)` 返回 true；对无 agent_session_id 返回 false | FR-06, D-007 | 单测或通过 dialog 用例间接覆盖 |
| AC-08-08 | Claude runtime 全部既有用例（用例 1-4、6）保持通过，无回归 | FR-10 | 测试：runtime-session-dialog.test.tsx 中 claude 用例全绿 |
| AC-08-09 | `QuickChatSessionSection` 组件仍从 helpers 导出（未被删除），但 runtime-session-dialog.tsx 不再 import | D-005 非目标 | grep：`QuickChatSessionSection` 在 helpers 有 export；dialog 文件无该 import |
| AC-08-10 | Codex active session 可点结束（`endSession`），ended 后历史可回看 | FR-05 | 通过 interactive-session-panel 既有 end 用例覆盖（provider 无关）；或在 dialog 加 codex end 用例 |
| AC-08-11 | ESLint + tsc 对三个改动文件无新增错误 | — | `pnpm --dir frontend exec eslint <files>` 通过 |
| AC-08-12 | 全程不调用 quick-chat API（`quickChat`/`streamQuickChat`/`getQuickChatResult`）于 Codex runtime 主路径 | FR-07, D-005 | 测试断言三个 quick-chat mock 均 not.toHaveBeenCalled |

## 风险与注意

- **依赖时序**：本任务必须在 task-06（daemon Codex executable + recovery）与 task-07（backend reopen 放开）合并后执行，否则 Codex createSession 会被 daemon `UnsupportedProviderError` 拒、reopen 被 backend `DaemonSessionResumeUnsupported` 拒。若超前执行，测试需 mock 掉这些拒绝，但真实集成会失败。
- **测试 mock 残留**：`runtime-session-dialog.test.tsx` 的 `beforeEach` 仍 mock 了 `quickChat`/`streamQuickChat`/`getQuickChatResult`，改写后这些 mock 可保留（供断言 not.toHaveBeenCalled）但不应再被主路径触发；注意 `streamQuickChat` 的默认 onDone microtask 不会误触发。
- **provider 下拉锁定**：Codex runtime 下若同时有 Claude runtime 在线，`onlineProviders` 会含两者，provider 下拉可选；`focusProvider="codex"` 仅设默认，用户可切到 claude——此为合理行为（与 Claude runtime 下可切 provider 对称），不阻断。
- **历史脏数据**：quick-chat 期产生的 Codex run 无 `AgentSession`（走的是 batch quick-chat），不会出现在 `listAgentSessions`（按 AgentSession 过滤），撤销分流后历史列表不会混入 quick-chat run，无需特殊清理。
