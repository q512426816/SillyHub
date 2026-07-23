---
author: qinyi
created_at: 2026-07-11 23:36:30
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在 `/runtimes` 弹窗查看自己的全部会话、新建会话、续聊历史会话、删除（软删）会话 |
| 工作空间成员 | 在变更详情页查看该变更的全部会话（跨成员可见）、新建/续聊 |

## 功能需求

### FR-01: SessionListLayout 公共组件
覆盖决策：方案 C
Given 两处会话列表（runtimes 弹窗 / 变更会话）需要一致的视觉
When 调用方传入标准化 `SessionListEntry[]` + `onSelect`/`onNewSession`/`onRetry`（可选 `onDelete`）
Then 组件渲染圆角卡片（`rounded-md border bg-slate-50`）+ header + 顶部「新建会话」虚线按钮 + 列表项（`title ?? shortId(id)` + status Badge + `secondaryText` + `lastActiveAt` + 选中 `border-l-[3px] border-blue-600 bg-blue-50`）；传入 `onDelete` 时每行渲染删除按钮，不传则无。

Given 列表为空
When 渲染
Then 显示「暂无会话，新建一个开始提问」；error 时显示错误文案 + 重试按钮。

### FR-02: RuntimeSessionDialog 样式对齐 + 二态化
覆盖决策：决策 1/2/3
Given 用户打开 `/runtimes?session=<id>` 弹窗
When 弹窗渲染
Then 左侧使用 `SessionListLayout`（带删除按钮，字段=title/status/提供方·轮数/时间），右侧直接挂 `InteractiveSessionPanel`（无「返回历史」栏）。

Given 用户点击任意状态会话（active/pending/reconnecting/ended/failed）
When handleSelect 触发
Then `setSelected(session)` + 拉 logs 预填 `initialTurns`；active/pending/reconnecting 直接 attach 续聊；**ended/failed 先 `reopenSession` 转 reconnecting/active 再 attach**（panel 轮询仅识别 active/failed）。

Given 用户点击「新建会话」
When 触发
Then 进入 idle 新建态（`focusProvider` 锁定本 runtime 的 provider）。

Given 用户点击某会话的删除按钮
When 触发
Then 调 `deleteAgentSession`（软删），该会话从列表消失，`selected` 若为该项则清空。

### FR-03: ChangeSessionSection 改用公共组件 + ended/failed reopen
覆盖决策：方案 C
Given 变更详情页会话区块
When 渲染
Then 左侧使用 `SessionListLayout`（不传 `onDelete`，`secondaryText`=作者·提供方），右侧 `InteractiveSessionPanel` 不变。

Given 用户点击 ended/failed 会话
When handleSelect 触发
Then 先 `reopenSession` 再 attach（与 FR-02 一致，修同样的卡死问题）。

### FR-04: 消息渲染 BUG 修复（sanitizeSessionLogContent + logsToTurns）
覆盖决策：方案 A（技术默认）
Given attach 历史会话预填 turn
When `logsToTurns(getAgentSessionLogs)` 处理每条 log
Then 对 `content_redacted` 先调 `sanitizeSessionLogContent(content, channel)` 过滤（`[SYSTEM…]`/`[RESULT…]`/AskUserQuestion/`[TOOL_RESULT] User answered` 丢弃、stderr→⚠️、tool_call→🔧、剥 `[ASSISTANT|THINKING|LOG:\w+]` 前缀），再并入 prompt（user_input）或 output。

Given 实时 SSE log
When `renderLogContent` 处理
Then 改调同一 `sanitizeSessionLogContent`，行为与现状完全一致（零回归）。

Given attach 后 SSE 与 initialTurns 可能重叠
When daemon 推送历史 log
Then 通过 `seenLogIds` 去重或跳过首个 `turn_started` 前的重放，**不产生重复内容**（execute 时真实会话复现确认根因，C-4/F-3）。

### FR-05: AgentSession.deleted_at 软删字段
覆盖决策：决策 1（逻辑删除）
Given AgentSession 模型
When migration apply
Then 新增 `deleted_at TIMESTAMP NULL` 列 + `ix_agent_sessions_deleted_at` 索引；现有行 `deleted_at=NULL`（未删除）。

Given migration downgrade
When 执行
Then 删索引 + 删列（可逆）。

### FR-06: delete_agent_session 改软删
覆盖决策：决策 1
Given 用户删除 active/pending/reconnecting 会话
When `delete_agent_session` 执行
Then 先 best-effort `_end_session_for_delete`（WS SESSION_END + currentRun killed + lease completed，失败仅 warning），再 `UPDATE agent_sessions SET deleted_at=now()`；**不再 DELETE 行、不再断 `agent_runs.agent_session_id` 外键**（C-7：删除 service.py:1560-1564 的断外键代码）。

Given 用户删除 ended/failed 会话
When 执行
Then 直接 `UPDATE deleted_at`（不做 end reconciliation）。

### FR-07: list/get 过滤软删
覆盖决策：决策 1
Given 任一用户调 `list_agent_sessions` / `list_change_sessions`
When 查询
Then 仅返回 `deleted_at IS NULL` 的会话；`get_agent_session` 对软删会话抛 `DaemonSessionNotFound`（404）。

### FR-08: list_agent_sessions 补 title
覆盖决策：决策 3
Given `list_agent_sessions` 返回
When 构造响应
Then 每条含 `title`（首条 `channel=user_input` 的 AgentRunLog 摘要前 30 字，复用 `list_change_sessions` 同一逻辑）；无 user_input log 时 `title=null`。

Given 前端 `AgentSessionRead`
When 类型定义
Then 含 `title: string | null` 与 `deleted_at: string | null`。

## 非功能需求

- **兼容性**：跨 Windows/Linux/macOS（规则 12）；前端 vitest + tsc --noEmit 通过；后端 ruff + mypy + pytest 通过（覆盖率 ≥60%）。
- **零回归**：变更会话区块既有行为不回归（除 ended/failed 现在支持直接续聊）；runtimes 弹窗 URL `?session=` 恢复点机制不变。
- **中文 UI**（规则 11）：列表文案、按钮、状态徽标中文。
