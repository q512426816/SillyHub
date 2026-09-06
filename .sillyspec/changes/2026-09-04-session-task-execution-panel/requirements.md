---
author: qinyi
created_at: 2026-09-05 00:02:21
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在 sessions 页或 /runtimes 弹窗中查看会话、与 agent 对话的人；任务面板的目标使用者 |
| daemon | 本地守护进程，上报 agent_task_status 事件（本变更不改动它） |
| backend | 接收上报、持久化任务记录、提供快照端点与 SSE 转发 |
| 前端会话面板 | 渲染任务执行面板，消费快照与 SSE 事件 |

## 功能需求

### FR-01: 任务执行面板常驻折叠形态
覆盖决策：D-001@v1, D-004@v1
Given 用户打开任一会话（sessions 页 page 模式 / runtimes 弹窗 dialog 模式 / mobile）
Then 会话头部区（AgentLogCard 同层）显示「任务执行」折叠条，折叠态一行摘要：运行中任务数、任务总数（成功 X/失败 Y）、轮次数
When 用户点击折叠条
Then 面板展开显示三个页签：任务清单 / 运行中 / 轮次历史；再点收起
When 面板展开且内容超限
Then 面板内部滚动（max-height），不挤压输入区可用性

### FR-02: 任务清单页签（持久化 + 实时）
覆盖决策：D-001@v1, D-006@v1
Given 会话面板挂载（含刷新/重连后）
Then 从 `GET /sessions/{id}/tasks` 拉取快照渲染任务清单（每行：状态圆标/任务名/摘要/耗时/tokens/工具数，终态定格显示）
When SSE 推送 `agent_task_status` 事件
Then 面板按 task_id 实时 upsert 对应行（running 脉动、终态定格）
When 该会话有 `plan_mode_entered` 事件
Then 任务清单顶部显示计划 objective 总纲（内存态）

### FR-03: 运行中页签（实时三类卡复用）
覆盖决策：D-001@v1
Given 会话有运行中的 agent 任务 / Bash 命令 / 团队任务
Then 运行中页签渲染现有 agent-task-card / bash-progress-card / team-task-block 组件（与 ActivityCatalog 同源数据）
When 无任何运行中任务
Then 显示空态提示

### FR-04: 轮次历史页签
覆盖决策：D-001@v1
Given 会话存在历史轮次（listSessionRuns 数据）
Then 轮次页签显示紧凑列表（轮次号/状态/耗时/tokens/发送者）
When 收到 `turn_completed` 事件信号
Then 列表刷新（refreshSignal 模式）

### FR-05: 任务状态服务端持久化
覆盖决策：D-001@v1, D-006@v1
Given daemon 上报 `agent_task_status`（POST /sessions/{id}/agent-task-status）
Then backend 在转发 SSE 的同时 upsert `agent_session_task` 行（(session_id, task_id) 唯一）：无则插入（started_at=now），有则刷新字段
When 已定格终态（completed/failed/stopped）的任务再收到 running 事件
Then 不回退终态（终态定格）
When 任务进入终态
Then 写 finished_at
When 会话被删除
Then 该会话任务行级联删除

### FR-06: 任务快照端点
覆盖决策：D-006@v1
Given 已鉴权用户请求 `GET /api/daemon/sessions/{id}/tasks`（鉴权与 runs 端点同款：get_agent_session + TaskRunAgentUser）
Then 返回 `list[AgentSessionTaskRead]`（按 updated_at desc 最近 200 条；字段含 run_id/progress/message 等 18 项，对齐事件契约）
When 无任务数据
Then 返回 `[]`（不报错）

### FR-07: 多引擎降级空态
覆盖决策：D-003@v1
Given 引擎不上报任务事件（如 pi 无 task 帧）
Then 任务清单显示空态文案，面板不报错、不阻塞对话流
And 会话其余功能行为与现状一致

## 非功能需求

- 兼容性：新表/新端点纯增量；未上报任务的会话行为不变；ActivityCatalog 旧入口保留；旧 daemon 不受影响。
- 可回退：面板组件可整体隐藏（摘掉挂载点即回现状）；upsert 失败不影响 SSE 转发主链路（持久化旁路，异常只记日志）。
- 可测试：终态定格/快照 200 条/重连恢复/空态均有自动化用例（后端 pytest + 前端 vitest）。
- 性能：upsert 单行更新 + 唯一索引；不做事件流水表；快照限 200 条。
- 规范：SSE 复用既有 fetch-sse 会话连接（不新建连接）；样式走 brand-* 语义阶双主题；api-types 由 pnpm gen:types 生成。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01~FR-05 | 内容四项全要（实时状态/TODO 清单/轮次总览/持久化） |
| D-002@v1 | —（非目标约束） | 会话列表侧不做摘要 |
| D-003@v1 | FR-07 | 多引擎空态降级 |
| D-004@v1 | FR-01 | 形态=头部折叠面板（⚠️ 自主决策待用户复核） |
| D-005@v1 | 全部 | 设计整体确认（⚠️ 自主决策待用户复核） |
| D-006@v1 | FR-02, FR-05, FR-06 | 数据模型对齐事件契约（run_id/progress/message 入库） |
