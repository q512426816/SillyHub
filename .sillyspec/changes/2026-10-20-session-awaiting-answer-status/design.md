---
author: flow-machine-draft
created_at: 2026-10-22T15:59:16.975Z
---
# 设计记录（Design Record）— 2026-10-20-session-awaiting-answer-status

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

用户要求在左侧会话状态里补一个「等待你回答」类型（agent 调 AskUserQuestion 等回答）显示问号。现状：等待回答期间 run 仍是 running，`sessionStatusIndicator` 显示转圈「正在执行」，用户看不出交互已停在自己身上；活性 blocked 只在 10~30s tailer 链路上才可能反映、且与等审批共用琥珀点，无「提问」语义。

做法（零新基建、纯加法）：
1. 后端列表端点在既有 `current_run_status` 注入块之后，批量查 `session_dialog_requests`（status='pending'，浏览器/刷新后仍存在）注入 `AgentSessionRead.pending_dialog_kind`（窗口函数取每会话最新一行）。不新增端点——列表行数据面最省的一次请求即覆盖所有会话（含未打开的）。
2. 前端 `sessionStatusIndicator` 新增 `kind: "question"` 形态（问号字形，warning 色系），判定序插在 failed/ended 之后、current_run_status 之前——等待回答压过 running 转圈，终态仍权威优先；`SessionStatusSlot` 增加问号渲染分支。
3. `AgentSessionRead`（前端类型）加可选 `pending_dialog_kind?: string | null`；旧数据/旧服务端缺省 None → 零回归。

选列注入而非新查询链的理由：左栏一次列表请求已载回全部行，问号状态只需一个标量；独立 `fetchPendingDialogs`（workspace 聚合）在 portal 多 scope 下还要额外合并与轮询，且列表已在 10s/30s 轮询 + 信号失效链上，标量随行返回天然同步。信号面坐享上一变更 2026-10-20-session-status-live-sync：run 状态迁移已发哑信号触发列表 refetch，问答状态转换（request_approval 写入/respond 回答）在既有轮询窗口内收敛。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `GET /api/daemon/sessions` 响应 `AgentSessionRead` 新增可选字段 `pending_dialog_kind: str | null`（默认 None）；无新端点、无新查询参数；其余字段零变化。
- 前端 `AgentSessionRead`（`lib/daemon/session-lists.ts`）新增可选 `pending_dialog_kind?: string | null`；`sessionStatusIndicator` 增加第 5 个可选入参 `pendingDialogKind`（新增导出以便纯函数单测），`SessionStatusIndicator` 联合类型新增 `{ kind: "question"; label: string }`；组件 props 零变化。
- 生成物：`api-types.ts` 由 `gen:types` 同步（后端 OpenAPI 新增字段）——提交生成物。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。列表查询以 DB 当前态为准：pending 行按 `status='pending'` 过滤、回答后转 answered → 下次 refetch 自然消失；问号只由该标量驱动，无本地状态机，乱序 SSE 信号仅触发整表 refetch，不产生错误累积。窗口函数按 `created_at DESC, rn=1` 取最新，多对话并存（理论上的连续提问）显示最新 kind，语义稳定。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   只读注入：端点仅 SELECT `session_dialog_requests`，不写该表；与 daemon 侧写入（handle_permission_request/respond_permission）并发时，SELECT 看到的是某一已提交快照——最坏情况显示偏差一个事务周期（下次轮询/信号修正），不会写坏数据。无锁、无版本面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。会话切换只是重新渲染；回答/取消（answered/cancelled）→ 标量消失 → 问号回归转圈或留白，均幂等。左栏组件卸载后迟到响应由 react-query 既有语义丢弃。后端字段默认 None，旧客户端无感。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会。查询以本页列表项 id 集合为 IN 条件，天然按当前用户/当前 scope 收口（列表端点本身已 user/workspace/change 过滤）；不按 workspace 全局聚合，不会把别的 scope 的对话请求带进来。多实例下每实例各自查 DB（一致）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：列表刷新频率下新增一次 IN 查询的负载。评估：与既有 owner_name/current_run_status/terminating_at 注入同构（同一查询函数内多次 IN 批查），单表 `idx_session_dialog_requests_status` + session_id 索引齐备；10s/30s 轮询与事件驱动共用的仍是同一次列表查询，增量成本可忽略。

另一风险：`dialog_kind` 语义扩容（如未来出现非「等用户回答」的持久化对话类型）会误显示问号——以「所有持久化 pending 对话即等用户回答」为当前契约（模型注释明示：普通 canUseTool 审批不落行，落行的都是 may wait indefinitely for a human answer）。若未来出现例外，在该注入点按 kind 白名单收窄即可，改动局部。

试过但放弃的方案：
- 前端用 `fetchPendingDialogs`（workspace 聚合端点）在 portal 侧合并——portal 有 workspace/change/quicklog 三 scope，要各自请求+合并+多一轮轮询，且未打开会话也在左栏，聚合端点按 workspace 粒度不匹配行级展示。放弃。
- 复用活性 `blocked` 区分——blocked 是 tailer 10s 推导的通用「停住」态，无法区分等审批/等回答/其它阻塞，且本地 CLI 会话 30s 轮询下最坏 ~40s 才可见。放弃。
- 在 run 表加列——写路径多、语义错位（等待是对话请求状态而非 run 状态）。放弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/schema.py | `AgentSessionRead` 新增 `pending_dialog_kind` 非 ORM 字段 |
| 修改 | backend/app/modules/daemon/router/session_crud.py | 列表端点批查 pending 对话注入该字段（窗口函数取最新） |
| 新增 | backend/app/modules/daemon/tests/test_sessions_list_pending_dialog.py | 注入/answered 不注入/无对话 None/批查用例 |
| 修改 | frontend/src/lib/api-types.ts | 生成物同步（gen:types）——字段经 `AgentSessionRead = Omit<components["schemas"]["AgentSessionRead"],…>` 自动进入消费类型（session-lists.ts 零改动） |
| 修改 | frontend/src/components/sessions/session-list-panel.tsx | 指示器新增 question 形态 + 判定序 + 导出供单测 + 槽渲染问号 |
| 新增 | frontend/src/components/sessions/__tests__/session-status-indicator.test.tsx | 问号形态/优先级/零回归用例 |
