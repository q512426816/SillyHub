---
author: qinyi
created_at: 2026-06-23T15:24:00+08:00
---

# design: /runtimes 会话弹窗化 + active 续聊

> 变更：`2026-06-23-runtimes-session-dialog`
> 子项目：frontend（Next.js 14 + React 18 + TS + Tailwind + shadcn/Radix）
> 原型：`prototype-runtimes-session-dialog.html`

## 1. 背景

当前 `/runtimes` 页面（`frontend/src/app/(dashboard)/runtimes/page.tsx`）采用「顶部摘要卡 + runtime 卡片列表 + 底部常驻会话区」纵向长布局：

- 会话区（`SessionListSection`）固定占满页面底部，整页很长；
- 点 runtime 卡片「会话」按钮（`handleOpenSession`）是 `setFocusedRuntime` + `scrollIntoView` 滚动到底部会话区，**不是弹窗**；
- 历史回看对所有会话（含 active）走只读 `SessionHistoryView`（`handleSelect` 注释 `ql-20260619-007` 明确写了「active 的 live 续看/追问需 LivePanel 支持 resume，属更大重构」），active 会话点开后**无法继续聊天**。

本次优化三件事：会话区改弹窗、页面主体精简、active 会话支持继续聊天。

## 2. 设计目标

- **FR-1 会话弹窗化**：点 runtime 卡片「会话」→ 弹出该 runtime 专属会话工作台（左历史会话列表 + 右会话区）。
- **FR-2 active 续聊**：弹窗内 active 会话点开后可直接发送续聊（非只读回看）。
- **FR-3 页面精简**：移除底部常驻会话区，runtime 卡片更大更舒展，所有会话统一走弹窗。
- **FR-4 状态恢复**：URL `?session=` 刷新恢复保留（指向活跃会话则自动开弹窗 attach）。

## 3. 非目标

- 不改后端 API / 数据模型 / 会话状态机（纯前端）。
- 不支持同时打开多个 runtime 弹窗（单例，见 D-001）。
- 不新增 codex ended/failed 续聊（仍只读，受现有 `canResumeSession` 限制）。
- 不改 AskUserQuestion 卡片 / 权限审批面板逻辑。
- 不改 runtime 注册 / 心跳 / 启禁用逻辑。

## 4. 拆分判断

三需求点都作用于同一 `page.tsx` + `interactive-session-panel.tsx`，耦合度高、单一交付目标，不满足拆分条件（非 3+ 独立模块 / 无多角色 / 无跨页面流转），非批量模式（任务 < 10 无重复）。单变更推进。

## 5. 总体方案

### Phase-1 新建 `RuntimeSessionDialog` 组件

新建 `frontend/src/components/daemon/runtime-session-dialog.tsx`：

- props: `{ runtime, open, onClose, runtimes }`（见 §7）
- 自管状态：`sessions / selected / logs / attachSession / loading / error / deletingSessionId`
- 用 shadcn `Dialog`（`DialogContent`）承载。**注意（C-1 可行性）**：`DialogContent` 默认 `max-w-lg`(512px) + `p-6` + `grid gap-4`，与「header + 左240px栏 + 右会话区」布局冲突。故 `DialogContent` 仅作定位壳，通过 `className` override 为 `max-w-[900px] w-[90vw] h-[80vh] max-h-[88vh] p-0 overflow-hidden`，内部自管 `<header>` + `<div grid>`（不复用 `DialogHeader`/`DialogFooter` 默认结构，自带关闭按钮）。
- 内部布局 `grid [240px 1fr]`：左 `SessionsSidebar`（过滤 `runtime_id === runtime.id`）+ 右三态渲染（`attachSession → InteractiveSessionChatSection` / `selected → SessionHistoryView` / idle → `InteractiveSessionChatSection` 新建）
- `open` 变 true 时 `listAgentSessions({limit:50})` 加载 + 过滤该 runtime
- 默认态（D-002）：有活跃会话→attach 最近活跃；无→idle 新建空白面板

### Phase-2 active 续聊

`RuntimeSessionDialog.handleSelect` 改造（相对当前 `page.tsx` 的统一只读回看）：

- **active 会话**：`getAgentSessionLogs` → `logsToTurns` 转 `initialTurns` → `setAttachSession(session)` → `InteractiveSessionChatSection` attach 模式（`InteractiveSessionPanel` 建 SSE + 预填 + 轮询到 active + 启用 inject 续发）
- **ended/failed claude**：只读 `SessionHistoryView` + 「继续对话」reopen（`canResumeSession`）
- **ended/failed codex**：只读（无续聊）

复用 `InteractiveSessionPanel` 的 `attachSessionId` 双模式 + `key={attachSession?.id ?? "live"}` 切换重 mount 清旧 SSE。

### Phase-3 页面精简（`page.tsx`）

- 移除底部常驻 `SessionListSection` 及 `sessionSectionRef` / scroll 逻辑
- 新增 `dialogRuntime` state，`handleOpenSession` 改为 `setDialogRuntime(runtime)`
- runtime 卡片放宽高度限制、grid 调整，更舒展
- 15s runtime 轮询保留；session 列表加载下沉到弹窗内

### Phase-4 URL 恢复（D-003）

`page.tsx` mount 读 `?session=` → `getAgentSession` 查 `runtime_id` → 若活跃：`setDialogRuntime(对应 runtime)` 并在弹窗内 attach；否则清 param 不开弹窗（沿用现有降级逻辑）。

**时序约定（C-3 边界）**：`?session=` 的写入/清除职责——
- 写入：会话新建 / 续聊成功时由 `InteractiveSessionChatSection.onSessionCreated` 写入（活跃会话作为恢复点保留在 URL）；
- 清除：弹窗 `onClose`（用户主动关闭 = 放弃恢复点）→ `clearSessionParam`；URL 指向非活跃/不存在时降级清除。
- 语义：会话进行中刷新浏览器（React state 丢失但 URL `?session=` 仍在）→ 自动开弹窗 attach 恢复；用户主动关弹窗 → 清 param，刷新不再自动弹出。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `frontend/src/components/daemon/runtime-session-dialog.tsx` | runtime 专属会话工作台弹窗，自管会话列表 + 三态渲染 |
| 新增 | `frontend/src/components/daemon/runtime-session-helpers.tsx` | 提取 `SessionsSidebar` / `SessionHistoryView` / `InteractiveSessionChatSection` / `logsToTurns` / `canResumeSession` / `isActiveSession` / `resumeDisabledTitle` / `ACTIVE_SESSION_VIEW_STATUSES` 等为命名导出，供 page 与 dialog 复用（提取 `InteractiveSessionChatSection` 是为避免 `page.tsx ↔ runtime-session-dialog.tsx` 循环依赖） |
| 修改 | `frontend/src/app/(dashboard)/runtimes/page.tsx` | 移除底部常驻会话区；helper 改从 helpers 文件 import；接 `dialogRuntime` + URL 恢复；卡片布局调大 |
| 修改 | `frontend/src/app/(dashboard)/runtimes/page.test.tsx` | 移除常驻会话区断言，新增弹窗打开 / active attach 断言 |
| 新增 | `frontend/src/components/daemon/runtime-session-dialog.test.tsx`（co-located，与 `page.test.tsx` 约定一致） | 弹窗渲染、active attach 续聊、ended 继续对话、关闭清理 |

**helper 提取说明**：`SessionsSidebar` / `SessionHistoryView` / `logsToTurns` / `canResumeSession` / `isActiveSession` / `resumeDisabledTitle` 当前定义在 `page.tsx` 内部（非 export）。为供 `runtime-session-dialog.tsx` 复用并避免 `page.tsx ↔ dialog` 循环依赖，提取到独立 `runtime-session-helpers.tsx`。`PROVIDER_META` / `shortId` 等小工具可一并下沉或就地保留。

## 7. 接口定义

`RuntimeSessionDialog` props（TypeScript）：

```ts
interface RuntimeSessionDialogProps {
  runtime: DaemonRuntimeRead | null; // null = 关闭
  open: boolean;
  onClose: () => void;
  runtimes: DaemonRuntimeRead[]; // 全部 runtime，供会话区选 provider
}
```

复用（不改签名）：

- `InteractiveSessionChatSection({ runtimes, attachSession?, initialTurns?, onCloseAttach?, focusProvider?, onSessionCreated?, onSessionReset? })`
- `InteractiveSessionPanel({ providers, defaultProvider, ..., attachSessionId?, initialTurns?, onSessionCreated?, onSessionReset? })`
- `listAgentSessions({limit})` / `getAgentSession(id)` / `getAgentSessionLogs(id)` / `deleteAgentSession(id)` / `reopenSession(id)`（均来自 `lib/daemon.ts`）

## 7.5 生命周期契约表

本变更涉及 session / daemon / lifecycle 关键词，但**不改后端契约**，仅前端在弹窗内复用现有会话生命周期。前端 attach 续聊复用的现有契约如下（均为 `lib/daemon.ts` 既有，本次**不变更字段**）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| create session | frontend | backend | provider, prompt, model | idle → active (首 turn) |
| attach session (SSE) | frontend | backend | sessionId | reconnecting → active |
| submit message (inject) | frontend | backend | sessionId, prompt | active → active (新 turn) |
| turn result (SSE) | backend | frontend | runId, status, output | running → completed/failed |
| reopen session | frontend | backend | sessionId | ended/failed → active |
| delete session | frontend | backend | sessionId | * → (deleted) |
| session end | frontend | backend | sessionId, reason | active → ended |

> active 续聊 = attach + inject 链路，无新契约。

## 8. 数据模型

无后端变更。`AgentSessionRead` / `DaemonRuntimeRead` 数据结构不变。

## 9. 兼容策略

本项目未上线，数据可清空（CLAUDE.md 规则 7）。前端纯组件重构，无 API / 表结构变更。

- 回退路径：弹窗组件独立，移除 `RuntimeSessionDialog` 即可回退为原常驻会话区形态（本次直接替换，不保留双形态）。
- 不改变的 API：`lib/daemon.ts` 全部签名。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | active 会话 attach 时，预填 historical turns 与 SSE 推送的进行中 turn 合并冲突 | P1 | 复用 `upsertTurn` 的 `run_id` 去重 + `TERMINAL_TURN_STATUSES` 幂等；测试覆盖 attach 后历史/进行中混合 |
| R-02 | 弹窗关闭时 SSE / 轮询泄漏 | P1 | RuntimeSessionDialog unmount / 关闭触发 `InteractiveSessionPanel` 的 cleanup effect（closeStream + clearInterval）；测试断言关闭后无残留连接 |
| R-03 | URL `?session=` 恢复指向非活跃会话时卡死 | P2 | 降级：清 param 不开弹窗（沿用现有降级逻辑） |
| R-04 | 多个 runtime 快速切换弹窗导致状态串 | P2 | 单例 `dialogRuntime` + `key={runtime.id}` 强制重 mount；切换即清旧 |
| R-05 | 移除常驻会话区 + active 改走 attach 后，原 `page.test.tsx` 多处断言失效 | P1 | plan 逐条重写：①`max-h-[680px]`/`max-h-[520px]` class 断言（卡片调高、列表移入弹窗）；②「会话」按钮聚焦态 `会话 · MyClaude`+「显示全部」（改弹窗 header）；③active 只读无发送断言（D-004 改为 active→attach 可发送）；④URL 恢复测试需等 Dialog open 后再断言 attach |

## 11. 决策追踪

- **D-001@v1 弹窗单例** → 覆盖于 FR-1 / Phase-3（`dialogRuntime` 单值）
- **D-002@v1 弹窗打开默认态** → 覆盖于 Phase-1（有活跃 attach 最近活跃，无 idle 新建）
- **D-003@v1 URL `?session=` 恢复** → 覆盖于 Phase-4
- **D-004@v1 active 续聊复用 attach** → 覆盖于 FR-2 / Phase-2

详见 `decisions.md`。无未解决决策。

## 12. 自审

- [x] 文件变更清单完整（含 helper 提取文件 + 测试）
- [x] 生命周期契约表已含（复用现有，无新契约）
- [x] 非目标明确（不改后端 / codex 续聊 / 多弹窗）
- [x] active 续聊可行性已验证（attach 模式存在 + key 重 mount + run_id 去重幂等）
- [x] 风险 P1（attach 合并 / 泄漏）均有测试应对
- [x] helper 提取方案明确（独立文件避免循环依赖）
- [x] Design Grill 交叉审查：修正 C-1（DialogContent 尺寸/布局约束）、C-2（helper 含 `InteractiveSessionChatSection` 防循环依赖）、C-3（`onClose` 清 param 时序）；C-4（测试逐条重写）/ C-5（最近活跃排序兜底）留 plan 细化
- [ ] 待 plan 细化：helper 提取精确边界、卡片布局 class、URL 恢复时序、listAgentSessions 排序兜底
