---
author: flow-machine-draft
created_at: 2026-10-22T15:59:16.975Z
---
# 需求规格（Requirements）— 2026-10-20-session-awaiting-answer-status

## 功能需求

### FR-01: 列表端点批量注入等待回答标记（照 current_run_status 的 IN 批查先例，零 N+1），存在 pending 对话请求的会话下发该标记

- `GET /api/daemon/sessions` 列表端点必须在现有 `current_run_status` 注入块之后，对当前页会话 id 批量查 `session_dialog_requests`（status='pending'），把每会话最新的 `dialog_kind` 注入 `AgentSessionRead.pending_dialog_kind`（非 ORM 字段，默认 None 守护存量）；无 pending 对话的会话该字段必须为 None。禁止逐会话 N+1 查询；查询必须限定本页会话 id 集合。
- 注入覆盖所有用户对话题 kind（AskUserQuestion / plan_approval / codex_request_user_input / mcp_elicitation / pi_extension_ui）——它们同为「等用户回答」语义。

#### 场景：等待回答的会话带标记

- Given 某会话存在一条 status='pending' 的 SessionDialogRequest（dialog_kind='AskUserQuestion'）
- When 用户请求会话列表
- Then 该项 `pending_dialog_kind == "AskUserQuestion"`，其余会话为 None

#### 场景：回答后标记消失

- Given 上述对话请求已被回答（status='answered'）
- When 再次请求会话列表
- Then 该项 `pending_dialog_kind` 为 None

#### 场景：零 N+1

- Given 列表页 20 个会话（其中 3 个有 pending 对话）
- When 请求列表
- Then 对话请求查询恰一次（IN 批查），非按会话逐条查询

### FR-02: 左侧状态指示器新增「问号」形态（等待回答），压过 run running 的转圈；终端态 failed/ended 仍权威优先

- `sessionStatusIndicator` 必须新增 `kind: "question"` 形态：`pending_dialog_kind` 非空时返回问号标识（label「等待你回答」，`aria-label` 可访问），渲染为 18px 槽内的「?」字形（warning 色系，与琥珀「在等你」同族但形态可区分）。
- 判定优先级必须为：failed → ended → **pending_dialog_kind（问号）** → current_run_status（pending_approval 琥珀 / pending|running 转圈）→ 活性兜底 → reconnecting → idle+completedUnread；即等待回答时 run 仍为 running 也显示问号，不显示转圈。

#### 场景：等回答压过转圈

- Given 会话 status='active'，current_run_status='running'，pending_dialog_kind='AskUserQuestion'
- When 渲染行首状态槽
- Then 显示问号标识（label「等待你回答」），不显示转圈

#### 场景：终态仍优先

- Given 会话 status='ended'，且（极端残留）pending_dialog_kind 非空
- When 渲染行首状态槽
- Then 仍显示绿点「执行完成」（终态权威优先）

#### 场景：回答后回归转圈

- Given 会话等待回答时显示问号
- When 回答后 pending_dialog_kind 变 None、run 仍 running
- Then 状态槽回归转圈「正在执行」

### FR-03: 无 pending 对话的会话展示零回归（既有五分类不变）

- `pending_dialog_kind` 为 None 时，指示器行为必须与现状逐字节一致：failed 红点 / ended 绿点 / pending_approval 琥珀 / pending|running 转圈 / 活性 working 转圈 / blocked 琥珀 / reconnecting 转圈 / idle+completedUnread 绿点 / 其余留白；类型字段为可选（旧客户端/旧数据不崩）。

#### 场景：既有分类回归

- Given 各会话无 pending 对话（字段 None 或缺省）
- When 渲染全部既有形态用例
- Then 既有断言全绿，无形态漂移

### FR-04: 后端注入与前端指示器有单测覆盖，触及面测试全绿

- 后端必须新增/扩展用例：有 pending 对话注入 kind、answered 后不注入、无对话为 None、批查零 N+1；前端必须扩展 `sessionStatusIndicator` 纯函数用例：问号形态、优先级（压过 running、让位 failed/ended）、None 零回归。触及面（sessions 列表端点、会话列表组件）测试必须全绿。

#### 场景：守卫路径

- Given pending 对话已 answered/cancelled 或会话无对话行
- When 请求列表 / 渲染指示器
- Then 无问号、既有展示不变

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/daemon/tests/test_sessions_list_pending_dialog.py「pending 对话注入 pending_dialog_kind；answered 不注入；无对话 None；IN 批查」
FR-02: frontend/src/components/sessions/__tests__/session-status-indicator.test.tsx「问号形态：pending_dialog_kind 压过 running 转圈、让位 failed/ended、回答后回归转圈」
FR-03: frontend/src/components/sessions/__tests__/session-status-indicator.test.tsx「None 时既有五分类零回归」
FR-04: 不适用：本条即测试要求本身，由 FR-01~03 的测试绑定行与收口 CLI 实测承载
