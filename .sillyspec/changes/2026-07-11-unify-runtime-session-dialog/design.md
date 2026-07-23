---
author: qinyi
created_at: 2026-07-11 23:30:50
scale: large
---

# 设计文档（Design）— 统一 runtimes 会话弹窗与变更会话样式 + 修复 attach 历史消息渲染

## 1. 背景

`/runtimes?session=...` 弹窗的会话区（`RuntimeSessionDialog`）与 `/workspaces/.../changes/...` 变更详情页的会话区（`ChangeSessionSection`）是两套独立实现，样式与交互都不一致：

- **左侧列表**：runtimes 是「会话ID(shortId) + 提供方 + 轮数 + 删除按钮」、无边框贴边 `border-r`；变更会话是「标题 + 状态 + 作者 + 轮数 + 时间」、独立圆角卡片、蓝色选中边框（`border-l-[3px] border-blue-600`）、顶部「新建会话」按钮。
- **右侧**：runtimes 在 attach 续聊时顶部多一个「返回历史」按钮栏；变更会话直接是会话面板。
- **状态处理**：runtimes 点 ended/failed 会话走 `SessionHistoryView` 只读回看，需再点「继续对话」才 reopen；变更会话所有会话点开直接 attach 续聊。

同时 runtimes 弹窗 attach 历史会话时，消息区有渲染 BUG：`[SYSTEM:thinking_tokens] 48 [THINKING] ...` 这类原始标记泄漏到正文，且内容重复显示（「你哈啊 你哈啊」「无论是写代码…」出现两次）。

**根因**：attach 历史预填走 `logsToTurns`（`runtime-session-helpers.tsx:587`），它直接拼接 `entry.content_redacted`，**没有像实时 SSE 的 `renderLogContent`（`interactive-session-panel.tsx:894`）那样过滤 thinking/SYSTEM/AskUserQuestion 标记**；内容重复则源于 attach 建立 SSE 后与 `initialTurns` 预填的去重不充分。

此外，删除会话当前是**物理删除**（`delete_agent_session` 硬删会话行，仅保留 run/log），用户要求改为**逻辑删除**（软删，会话行保留、可审计）。

## 2. 设计目标

1. runtimes 弹窗会话区样式与交互对齐变更会话（左侧圆角卡片列表 + 蓝色选中 + 顶部新建；右侧去掉返回栏直接挂面板；ended/failed 点开直接续聊）。
2. 抽公共 `SessionListLayout` 组件，runtimes 弹窗与变更会话复用，杜绝两套列表样式分叉。
3. 修复 attach 历史消息渲染 BUG（thinking/SYSTEM 标记过滤 + 内容去重）。
4. 删除会话改为逻辑删除（`deleted_at` 软删），run/log 历史保留。
5. `list_agent_sessions` 补 `title` 字段，使列表能显示「标题」而非裸 id。

## 3. 非目标（YAGNI）

- 不做会话搜索 / 排序 / 批量删除 / 软删项恢复 UI（用户未要求）。
- 不改 `sillyhub-daemon`（daemon 侧 session 逻辑不动，仅 backend 软删）。
- 不改 runtimes 弹窗的 URL `?session=` 恢复点机制（page.tsx 已正确）。
- 不把 `SessionHistoryView` / `SessionsSidebar` helper 删除（保留供潜在其他引用；弹窗内不再用）。
- 不要求历史兼容（CLAUDE.md 规则 10，migration 可直接加）。

## 4. 拆分判断

单变更，不拆分。所有改动围绕「会话弹窗」强耦合：前端样式重构依赖后端 `title` 字段，BUG 修复与样式同文件，软删与列表过滤同表。仅平台用户单一角色，无跨页面状态流转，不满足拆分条件。不走批量模式（非 N 个相似实体）。

## 4.5 决策/方案选择（D-xxx）

- **D-001 样式重构路径 = 抽公共 SessionListLayout（方案 C）**：新增 `SessionListLayout` 公共组件，runtimes 弹窗与变更会话两处复用。备选 A（runtime-session-dialog 内部重写）放弃——两套样式继续分叉；备选 B（复用 ChangeSessionSection）放弃——runtimes 无 changeId/workspaceId 且需删除按钮/URL 恢复，强行参数化会污染变更组件。方案 C 长期最 DRY，工作量略高但抽象收益明确。
- **D-002 ended/failed 会话 = 点开先 reopen 再 attach**：用户要「直接续聊」。Grill F-1 发现 panel attach 轮询仅识别 active/failed，ended 直接 attach 会卡超时。故 handleSelect 对 ended/failed 先 `reopenSession` 转 reconnecting/active 再 attach。备选（panel 内自动 reopen）放弃——污染 panel 通用逻辑。
- **D-003 删除 = 逻辑删除（deleted_at 软删）**：用户明确「不能物理删除」。`AgentSession` 加 `deleted_at`，delete 改 `UPDATE deleted_at`，list/get 过滤。备选（is_deleted bool）放弃——项目惯例用 timestamp；备选（归档表）放弃——过度设计。
- **D-004 消息过滤 = 抽共享 sanitizeSessionLogContent**：`renderLogContent`（实时 SSE）与 `logsToTurns`（attach 预填）共用同一过滤纯函数。备选（仅 logsToTurns 内联过滤）放弃——逻辑重复易再分叉。
- **D-005 列表字段 = 标题+状态+提供方+轮数+时间（无作者）**：用户拍板。runtimes 弹窗为平台级会话（都是自己的），无「成员」概念，故 secondaryText 用「提供方·轮数」而非变更会话的「作者·提供方」。`SessionListEntry.secondaryText` 由调用方拼，组件不强统一。
- **D-006 list title 复用 list_change_sessions 逻辑**：`list_agent_sessions` 补 title 时抽共享 helper（首条 user_input 摘要前 30 字），两端点共用，避免分叉（C-6/R-7）。

## 5. 总体方案

分 4 个 Phase，前后端解耦，可并行起步但前端 Phase 3 依赖后端 Phase 1 的 `title` 字段。

### Phase 1 — 后端：软删 + list title

**数据模型**：`AgentSession`（`backend/app/modules/agent/model.py:387`）新增 `deleted_at: datetime | None`（nullable，默认 null）+ 索引 `ix_agent_sessions_deleted_at`。

**Migration**：新增 Alembic revision，`down_revision = "419d34f8e33f"`（开工前 `alembic heads` 再次核实唯一 head）。`upgrade` 加列 + 索引；`downgrade` 删索引 + 删列。

**delete 改软删**（`session/service.py:1513`）：
- active/pending/reconnecting 会话：仍先 best-effort `_end_session_for_delete`（WS SESSION_END + currentRun killed + lease completed），失败仅 warning 不阻断。
- 改 `UPDATE agent_sessions SET deleted_at=now() WHERE id=? AND user_id=?`（**不再** `DELETE` 行，**不再**断 `agent_runs.agent_session_id` 外键——run/log 自然保留可查）。
- 软删后该会话 status 保持原值（不强制改 ended），靠 `deleted_at IS NULL` 过滤可见性。

**list/get 过滤 `deleted_at IS NULL`**：
- `list_agent_sessions`（`service.py:1301` base_filters 追加 `AgentSession.deleted_at.is_(None)`）。
- `list_change_sessions`（`change/router.py:213` where 追加）。
- `get_agent_session`（`service.py:1319`，软删视为不存在 → 抛 `DaemonSessionNotFound` 404）。

**list 补 title**：`list_agent_sessions` 返回值补 `title`（首条 `channel=user_input` 的 AgentRunLog 摘要前 30 字，逻辑与 `list_change_sessions` 一致）。`AgentSessionRead` schema（`daemon/router.py` 响应模型 + 前端 `lib/daemon.ts:1124`）加 `title: string | null`。

### Phase 2 — 前端公共件：SessionListLayout + sanitize

**新增 `SessionListLayout`**（`frontend/src/components/daemon/session-list-layout.tsx`）：
- 标准化列表项类型 `SessionListEntry`：`{ id; title: string | null; statusBadge: "active"|"ended"|"failed"|"pending"|"reconnecting"|string; secondaryText: string; lastActiveAt: string | null }`。
- Props：`{ items; loading; error; selectedId; onSelect; onNewSession; onRetry; onDelete?; headerTitle?; newButtonLabel? }`。`onDelete` 可选——传入则每行右侧渲染删除按钮（runtimes 传），不传则无（变更会话）。
- 渲染：`<aside class="rounded-md border bg-slate-50">` + header（`headerTitle` + 刷新/重试按钮）+ 顶部「新建会话」虚线按钮（`selectedId===null` 时高亮蓝）+ `<ul>` 列表项（`title ?? shortId(id)` + status Badge + `secondaryText` + `lastActiveAt`（MM-DD HH:mm）+ 选中 `border-l-[3px] border-blue-600 bg-blue-50` + 可选删除列）。
- 空态：「暂无会话，新建一个开始提问」；error 态：错误文案 + 重试按钮。

**抽 `sanitizeSessionLogContent`**（`runtime-session-helpers.tsx`）：
```ts
export function sanitizeSessionLogContent(content: string, channel?: string): string
```
把 `renderLogContent`（`interactive-session-panel.tsx:894`）的过滤逻辑（过滤 `[SYSTEM…]/[RESULT…]`/AskUserQuestion/`[TOOL_RESULT] User answered`、stderr→`⚠️`、tool_call→`🔧`、剥 `[ASSISTANT|THINKING|LOG:\w+]` 前缀）抽成纯函数。`renderLogContent` 改调它；`logsToTurns` 对每条 `content_redacted` 先 `sanitize` 再并入 prompt（user_input）或 output。

**logsToTurns 修 BUG**：`runtime-session-helpers.tsx:587`，遍历 entries 时 `const text = sanitizeSessionLogContent(entry.content_redacted ?? "", entry.channel); if (!text) continue;`，再按 channel 分流。

**内容重复修复**：实施时定位 attach 建立 SSE（`interactive-session-panel.tsx:284 establishStream`）后 daemon 是否重放历史 log 与 `initialTurns` 重叠。若重叠：扩展 attach 模式让 `initialTurns` 的 `seenLogIds` 与 SSE 推送的 `log_id` 去重（已在 `onLog` 用 `seenLogIds` 去重，确认 attach 预填的 seenLogIds 与 daemon SSE log_id 同源；若不同源，attach 后丢弃首个 `turn_started` 之前的 log）。execute 时用真实会话复现确认。

### Phase 3 — 前端重构：dialog + change-section

**`RuntimeSessionDialog` 重构**（`runtime-session-dialog.tsx`）：
- 左侧：`<SessionListLayout>` 替换 `SessionsSidebar`，`items = visibleSessions.map(s => ({ id, title: s.title ?? null, statusBadge: s.status, secondaryText: `${getProviderLabel(s.provider)} · ${s.turnCount} 轮`, lastActiveAt: s.last_active_at }))`，传入 `onDelete={handleDelete}`。
- 右侧三态简化为二态：`selected`（任意状态）→ `<InteractiveSessionPanel key={selected.id} attachSessionId={selected.id} initialTurns={logsToTurns(logs)} focusProvider... />`；无 selected → idle 新建态 panel。**删除 `SessionHistoryView` 分支与「返回历史」栏**。
- `handleSelect` 统一：点任意会话 → `setSelected(session)` + 拉 logs 预填。**active/pending/reconnecting 直接 attach 续聊；ended/failed 先调 `reopenSession(session.id)` 把 status 改回再 attach**（Grill F-1：panel attach 轮询仅识别 active/failed，ended 会卡轮询超时 → failed，必须先 reopen 让 status 转回 reconnecting/active）。即把原 `handleContinue` 的 reopen 逻辑合并进 handleSelect，对 ended/failed 自动触发，实现「点开即续聊」。
- header 保留「会话 · {runtime 名}」+「刷新会话」。

**`ChangeSessionSection` 改造**（`change-session-section.tsx`）：
- 左侧内联 `<aside>` 替换为 `<SessionListLayout>`（不传 `onDelete`），`secondaryText = `${s.author?.display_name ?? "未知成员"} · ${getProviderLabel(s.provider)}``。
- 右侧 `InteractiveSessionPanel` 不变。
- **同步加 ended/failed reopen**（Grill F-1）：`handleSelect` 对 ended/failed 先 `reopenSession` 再 setActiveSessionId，修同样的 attach 卡死问题，保持两处一致。

### Phase 4 — 测试 + 验证

- 前端：`SessionListLayout` 单测（选中高亮 / 删除回调 / 空态 / error 重试）；`runtime-session-dialog` 交互测试（点 ended 会话直接进 panel 续聊、删除触发 onDelete、新建切 idle）；`logsToTurns` 单测（`[SYSTEM:thinking_tokens]`/`[THINKING]`/AskUserQuestion 标记过滤、user_input/output 分流）；`change-session-section` 回归；`interactive-session-panel` 的 `renderLogContent` 仍调共享函数回归。
- 后端：`test_session_delete_active.py` 断言改「行仍在 + `deleted_at` 非空 + `agent_runs.agent_session_id` 未断」；`list_agent_sessions` / `list_change_sessions` 加软删过滤用例（软删项不返回）；list 返回 `title` 用例（首条 user_input 摘要）。
- 验证：`pnpm test` + `tsc --noEmit` + `uv run ruff check && mypy app && pytest`；playwright 端到端（attach 历史 BUG 消失 + 删除软删 + 样式与变更会话一致）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `frontend/src/components/daemon/session-list-layout.tsx` | 公共会话列表组件（SessionListLayout + SessionListEntry） |
| 新增 | `frontend/src/components/daemon/__tests__/session-list-layout.test.tsx` | 公共组件单测 |
| 修改 | `frontend/src/components/daemon/runtime-session-dialog.tsx` | 左侧换 SessionListLayout、右侧二态化、删只读回看分支 |
| 修改 | `frontend/src/components/daemon/runtime-session-helpers.tsx` | 抽 sanitizeSessionLogContent + logsToTurns 修 BUG |
| 修改 | `frontend/src/components/daemon/interactive-session-panel.tsx` | renderLogContent 改调共享函数；attach 去重 |
| 修改 | `frontend/src/components/changes/change-session-section.tsx` | 左侧改用 SessionListLayout |
| 修改 | `frontend/src/lib/daemon.ts` | AgentSessionRead 加 title/deleted_at |
| 修改 | `backend/app/modules/agent/model.py` | AgentSession 加 deleted_at + 索引 |
| 修改 | `backend/app/modules/daemon/session/service.py` | delete 改软删、list/get 过滤、list 补 title |
| 修改 | `backend/app/modules/daemon/router.py` | list_sessions 响应补 title |
| 修改 | `backend/app/modules/change/router.py` | list_change_sessions 过滤 deleted_at |
| 新增 | `backend/migrations/versions/<rev>_add_agent_sessions_deleted_at.py` | Alembic migration |
| 修改 | `backend/app/modules/daemon/tests/test_session_delete_active.py` | 断言改软删 |
| 新增 | `frontend/src/components/daemon/__tests__/runtime-session-dialog.test.tsx` | 弹窗交互测试 |

## 7. 接口定义

```ts
// session-list-layout.tsx
export interface SessionListEntry {
  id: string;
  title: string | null;       // null → 渲染 shortId(id)
  statusBadge: string;        // active/ended/failed/pending/reconnecting
  secondaryText: string;      // 由调用方拼（提供方/作者 · 轮数）
  lastActiveAt: string | null; // ISO，渲染 MM-DD HH:mm
}

export interface SessionListLayoutProps {
  items: SessionListEntry[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewSession: () => void;
  onRetry: () => void;
  onDelete?: (id: string) => void;  // 可选，传入则渲染删除按钮
  headerTitle?: string;              // 默认"会话历史"
  newButtonLabel?: string;           // 默认"新建会话"
}

// runtime-session-helpers.tsx
export function sanitizeSessionLogContent(content: string, channel?: string): string;
```

后端 `AgentSessionRead` 新增字段：`title: string | null`、`deleted_at: string | null`（前端类型同步）。

## 7.5 生命周期契约表

涉及关键词：session / agent_run / end / complete / delete。

| 实体 | 当前行为 | 本次变更 | 不变量 |
|---|---|---|---|
| active 会话 delete | best-effort end reconciliation（WS SESSION_END + currentRun killed + lease completed）→ 硬删行 + 断 agent_runs.agent_session_id | end reconciliation 不变 → 改 `UPDATE deleted_at`（行保留、外键不断） | run/log 历史保留；daemon 离线时 end 失败仅 warning，软删仍成功 |
| ended/failed 会话 delete | 直接硬删行 + 断外键 | 直接 `UPDATE deleted_at` | 同上 |
| 软删会话可见性 | N/A | `list_agent_sessions` / `list_change_sessions` / `get_agent_session` 过滤 `deleted_at IS NULL` | 软删后列表不可见、get → 404；agent_runs 表该会话的 run 仍可查（agent_session_id 未断） |
| attach 续聊（任意状态） | active→attach；ended/failed→只读回看需 reopen | 统一 attach：active/pending/reconnecting 直接 attach；ended/failed 先 `reopenSession` 转 reconnecting/active 再 attach | attach 不新建 session，复用 selected.id；panel 轮询仅识别 active/failed（F-1），ended 必须先 reopen |

## 8. 数据模型变更

`agent_sessions` 表新增列：

| 列名 | 类型 | nullable | 默认 | 索引 |
|---|---|---|---|---|
| `deleted_at` | `TIMESTAMP WITH TIME ZONE`（PG）/ `DATETIME`（SQLite） | YES | NULL | `ix_agent_sessions_deleted_at` |

无数据回填（新列默认 null = 未删除）。无需 backfill（规则 10 允许重置）。

## 9. 自审

- **C-1（migration head）**：`down_revision` 必须挂当前唯一 head `419d34f8e33f`，execute 前先 `alembic heads` 核实（记忆 [[migration-chain-fragmentation-pattern]]：并行变更易撞 head）。
- **C-2（软删 run 外键）**：当前硬删会断 `agent_runs.agent_session_id`，软删后不再断 → 确认 agent_runs 侧无依赖「session 被删则 agent_session_id 应为 null」的查询（应为无，session 存在时本就连着）。
- **C-3（attach ended/failed 需先 reopen，Grill F-1 修正）**：panel attach 轮询仅识别 active/failed（`interactive-session-panel.tsx:314-324`），ended 会卡轮询超时 → failed。因此 dialog 与 ChangeSessionSection 的 handleSelect 对 ended/failed 必须**先 `reopenSession` 再 attach**。若 SDK 上下文已失效 reopen 失败，panel 转 failed + errorMsg「会话恢复失败，可能上下文已失效」——可接受（与现状 reopen 失败一致）。
- **C-4（内容重复根因待证）**：Phase 2 标注的「attach 后 SSE 重放去重」需真实会话复现确认，execute 时若发现根因不同（如 logsToTurns 自身重复拼接），就地修复并在 tasks 记录。
- **C-5（SessionListLayout secondaryText 两边语义）**：runtimes 显示「提供方 · 轮数」，变更会话显示「作者 · 提供方」——由调用方拼，组件不强统一，符合两边场景。
- **C-6（AgentSessionListItem 已有 title，AgentSessionRead 新增）**：确认 `list_change_sessions` 的 title 逻辑可复用到 `list_agent_sessions`（同一 AgentRunLog 摘要），避免两套实现。
- **C-7（delete 软删后清理断外键代码，Grill F-2）**：`session/service.py:1560-1564` 当前 `update(AgentRun).set(agent_session_id=None)` 在软删后必须删除（软删保留行 + 不断外键），execute 时确保移除这段。
- **C-8（ChangeSessionSection reopen 依赖后端 list 返回 status）**：`AgentSessionListItem.status` 已返回，reopen 端点已存在（`reopenSession`），无需后端新增。

## 10. Design Grill 交叉审查发现

执行了三层交叉审查（定义层/一致性层/可行性层），关键发现：

- **F-1（可行性，P0，已修正 design）**：design 初稿说「ended/failed 直接 attach 由 panel 处理」，但读 `interactive-session-panel.tsx:296-329` attach 轮询仅 `active→stop+active` / `failed→stop+failed`，`ended/pending/reconnecting` 继续轮询至超时。直接 attach ended 会话会卡超时回退 failed，无法续聊。**修正**：handleSelect 对 ended/failed 先 `reopenSession` 转 reconnecting/active 再 attach（已改 §5 Phase3 + §7.5 + C-3）。
- **F-2（一致性，P1，已记录 C-7）**：delete 改软删后，现有「断 agent_runs 外键」代码段（`service.py:1560-1564`）与新行为冲突，必须删除。
- **F-3（定义层，P2）**：「内容重复」根因 C-4 标注待 execute 真实复现，不阻塞 design 但 execute 需先验证再改。
- 无跨模块所有权冲突（本次改动均在 daemon session / change / agent 模块内，无跨模块实体变更）。

## 11. 风险登记

| ID | 风险 | 等级 | 缓解措施 | 责任点 |
|---|---|---|---|---|
| R-1 | alembic migration head 与并行变更撞，upgrade head 失败 crash-loop（[[migration-chain-fragmentation-pattern]]） | 高 | execute 前 `alembic heads` 复核唯一 head `419d34f8e33f`，down_revision 挂真实 head | C-1 / T2 |
| R-2 | attach ended/failed 会话卡 panel 轮询超时 | 高 | handleSelect 对 ended/failed 先 `reopenSession` 再 attach（已修正 design） | F-1 / C-3 / T10 / T11 |
| R-3 | 内容重复 BUG 根因未在 design 期完全定位 | 中 | execute 时真实会话复现确认，按根因就地修复 | C-4 / F-3 / T12 |
| R-4 | 软删后遗漏删除断外键代码致 run/log 仍被断开 | 中 | 明确移除 `service.py:1560-1564`，单测断言 `agent_runs.agent_session_id` 未断 | C-7 / T3 / T6 |
| R-5 | reopen 失败（SDK 上下文失效）用户困惑 | 低 | panel 转 failed + 中文 errorMsg「会话恢复失败，可能上下文已失效」 | C-3 |
| R-6 | ChangeSessionSection 改造引入回归 | 中 | `change-session-section` 既有测试回归 + 仅改左侧列表与 handleSelect reopen | T11 / T13 |
| R-7 | `list_agent_sessions` title 与 `list_change_sessions` 逻辑分叉 | 低 | 抽共享 helper 计算首条 user_input 摘要，两处调用同一函数 | C-6 / T5 |
