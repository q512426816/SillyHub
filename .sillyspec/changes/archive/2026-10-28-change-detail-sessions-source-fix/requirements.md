---
author: flow-machine-draft
created_at: 2026-10-27T20:44:07.964Z
---
# 需求规格（Requirements）— 2026-10-28-change-detail-sessions-source-fix

## 功能需求

### FR-01: 桌面变更详情概览「会话」区数据源改为 GET /changes/{id}/sessions（change_session_links 真实关联），不再取工作区全量会话

- 桌面变更详情页（`workspaces/[id]/changes/[cid]`）概览信息栏「会话」区**必须**以 `listChangeSessions(workspaceId, changeId)`（GET /changes/{id}/sessions，change_session_links M:N 真实关联、跨成员、last_active_at 倒序）为唯一数据源，**禁止**再取 `listWorkspaceAgentSessions(workspaceId)` 工作区全量会话冒充变更关联会话。

#### 场景：工作区存在与变更无关的活跃会话

- Given 工作区下有 3 个活跃会话，其中仅 1 个通过 change_session_links 绑定到变更 A
- When 打开变更 A 的桌面详情页概览 tab
- Then 「会话」区只显示绑定的那 1 个会话，其余 2 个无关会话不出现

#### 场景：变更无任何绑定会话

- Given 变更 B 在 change_session_links 中零关联
- When 打开变更 B 的桌面详情页概览 tab
- Then 「会话」区显示「暂无会话」空态，不回退到工作区全量列表

### FR-02: 「绑定会话（审批结果将通知此会话）」显示同一关联源最新会话，与后端 _notify_bound_session 注入目标同源

- 审批卡「绑定会话」展示值**必须**取自 FR-01 同一 `listChangeSessions` 结果的首条（last_active_at 最新），与后端 `_notify_bound_session` 按 change_session_links 定位注入目标的语义同源；**禁止**以工作区最近活跃会话近似冒充绑定会话。

#### 场景：审批时绑定会话展示

- Given 变更 A 绑定会话 S1（links 最新、active），工作区另有更活跃的无关会话 S2
- When 打开变更 A 审批卡
- Then 「绑定会话（审批结果将通知此会话）」显示 S1 而非 S2

### FR-03: 会话区状态列显示中文标签（进行中/已结束等），不再裸显英文 active/completed

- 「会话」区每条会话的状态**必须**显示中文标签（active→进行中 等既有序列），未知状态值回退显示原文；**禁止**裸显英文枚举值。

#### 场景：active 会话显示中文

- Given 会话区含 status=active 的条目
- Then 状态列显示「进行中」而非「active」

### FR-04: 附件开局会话标题剥离 [附件:...] 内联标记，三处标题提取端点口径一致

- 会话标题提取**必须**剥离附件标记行（`[附件:<uuid>|<kind>|<name>]`，格式权威源 session_attachment/service.py）后取首个非空文本（前 30 字）；首条 user_input 为纯附件（剥离后无剩余文本）时**必须**回退取首个附件的 name 段；该剥离逻辑**必须**以共享 helper 落地并在 change/agent/daemon 三处标题提取端点同步消费，**禁止**任何一处继续原样输出 `[附件:<uuid>` 前缀。存量 title_fallback 持久化列不重算——daemon 侧在读展示时过同一 helper 清洗，保证三处显示口径一致。

#### 场景：附件+正文混合首条输入

- Given 会话首条 user_input 为 `[附件:uuid1|image|IMG_2038.png]\n[附件:uuid2|image|IMG_2037.png]\n\n移动端四个页面布局乱了，帮我修一下`
- When 任一标题提取端点计算该会话标题
- Then 标题为「移动端四个页面布局乱了，帮我修一下」的前 30 字，不含任何 `[附件:` 片段

#### 场景：纯附件首条输入

- Given 会话首条 user_input 仅含 `[附件:uuid1|image|IMG_2038.png]` 一行
- When 标题提取
- Then 标题为 `IMG_2038.png`（首个附件 name 段）

#### 场景：常规纯文本首条输入

- Given 首条 user_input 为普通文本（无附件标记）
- When 标题提取
- Then 行为与现状逐字节一致（前 30 字），零回归

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/changes/detail/__tests__/change-overview-side.test.tsx「仅渲染注入的变更关联会话（slice 前 3）」+ 变更详情页层数据源断言（listChangeSessions 被调、listWorkspaceAgentSessions 不再被调）
FR-02: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid] 页面测试或 change-stage-actions 透传断言「绑定会话取关联源首条而非工作区首条」
FR-03: frontend/src/components/changes/detail/__tests__/change-overview-side.test.tsx「状态列显示中文标签（active→进行中）」
FR-04: backend/app/modules/session_attachment/tests/test_capability.py「session_display_title 剥离附件标记/纯附件回退 name/纯文本零回归」+ backend/app/modules/change/tests/test_change_sessions_cap.py「附件开局标题剥离」+ agent 侧标题测试同款断言 + daemon 读侧清洗测试
