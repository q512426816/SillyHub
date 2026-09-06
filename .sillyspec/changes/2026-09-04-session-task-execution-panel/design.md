---
author: qinyi
created_at: 2026-09-04 23:48:13
scale: large
---

# 设计文档（Design）— 会话任务执行面板

## 背景

会话面板（`frontend/src/components/daemon/session-panel.tsx`，page/dialog 双模式巨石组件）目前展示 agent 执行过程信息有两处：「进度」视图（TurnTimeline 完整过程流水，信息密集）和「后台 ▾」下拉（ActivityCatalog，收编子 agent 任务/Bash/团队任务三类卡片，入口深）。用户无法一眼看到当前会话的任务执行进度。

更关键的数据缺口：agent 任务状态（SSE `agent_task_status` 事件）只存在前端组件内存态，**刷新页面或切换会话再回来即丢失**；轮次运行历史（`GET /sessions/{id}/runs`）虽有服务端数据但无聚合展示入口。

用户需求（2026-09-04 澄清，decisions.md D-001）：新增任务执行面板，内容四项全要——①后台任务实时状态 ②执行步骤清单（TODO）③轮次运行历史总览 ④任务记录持久化不丢。

## 设计目标

1. 会话主面板新增**常驻可折叠**的「任务执行」面板：折叠态一行摘要（运行中任务数/任务成败计数/轮次数），展开态三区页签——任务清单（持久化）、运行中（实时）、轮次历史。
2. agent 任务状态**服务端持久化**（新表 `agent_session_task`），刷新/切会话不丢，快照接口 + SSE 实时合并。
3. page（sessions 页）/ dialog（/runtimes 弹窗）/ mobile 三挂载点同一组件，/runtimes 弹窗零回归。
4. 复用现有三类任务卡组件与 SSE 链路，daemon 侧零改动。

## 非目标

- 不改会话列表（左栏）条目，不做列表侧进度摘要（D-002）。
- 不删除/不改「后台 ▾」ActivityCatalog 旧入口（保留，面板为主视图）。
- Bash stdout 流不做服务端持久化（体量大价值低；终态已由 TurnSegment 工具卡呈现）。
- 不新增 daemon→backend 事件类型（现有 `agent_task_status` 上报链路已通，`pi-events.ts` 等引擎差异按 D-003 空态降级）。
- `run_id` 随事件入库（schema.py:1236 事件必填字段），但本期**不做按 run 分组/关联消费**——快照按 `updated_at` 排序展示；按 run 分组视图留作后续增强。

## 拆分判断

单变更，不拆分：三区面板 + 持久化共享同一数据链路（agent_task_status 事件 → 落库 → 快照/实时），拆开独立交付价值低。非批量模式（无同构重复任务）。

## 总体方案

**方案 B：头部折叠面板**（D-004；对照 A 右侧常驻栏 / C 任务视图 tab 的取舍记录于 decisions.md）。UI 对照原型 `prototype-task-execution-panel.html`。

分三个 Wave（供 plan 阶段细化）：

- **Wave 1 后端持久化**：新表 `agent_session_task` + Alembic migration + `AgentSessionTaskRead` DTO + 上报端点同步 upsert + 快照端点 `GET /sessions/{id}/tasks` + 后端测试。
- **Wave 2 前端数据层**：`applyAgentTaskStatusEvent` 归约函数从 session-panel.tsx 抽出为共享模块；新 hook `useSessionTasks`（mount/重连拉快照 + 事件实时合并）；`lib/daemon.ts` 新增 `listSessionTasks`；`pnpm gen:types` 同步 api-types。
- **Wave 3 前端 UI**：新组件 `task-execution-panel.tsx`（折叠条+三页签），挂载 page/dialog/mobile 三处；「运行中」区直接渲染现有 `agent-task-card` / `bash-progress-card` / `team-task-block`；主题走 brand-* 语义阶；组件测试 + session-panel 既有测试回归。

**信息架构（展开态三页签）**：

1. **任务清单**：`agent_session_task` 持久化列表（新→旧或旧→新时间序，行=状态圆标+任务名+正在做什么摘要+耗时/tokens/工具数）；有 `plan_mode_entered` 事件时顶部显示计划 objective 总纲（内存态，不持久化——plan 事件重连后由日志回放重建）。
2. **运行中**：实时 running 的 agent 任务 + Bash 命令 + 团队任务，复用现有三类卡组件与内存态数据（ActivityCatalog 同源）。
3. **轮次历史**：`listSessionRuns`（lib/daemon.ts 现有函数）紧凑列表（轮次号/状态/耗时/tokens/发送者），`turn_completed` 信号刷新（SessionUsageBar 的 refreshSignal 模式）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/model.py | 新增 `AgentSessionTask` SQLModel 表（见数据模型节） |
| 新增 | backend/migrations/versions/<rev>_add_agent_session_task.py | 建表 migration（alembic.ini `script_location=migrations`，实际迁移目录是 backend/migrations/versions/）；down_revision 取执行时当前 head（防并行撞 head，见 R-02） |
| 修改 | backend/app/modules/daemon/schema.py | 新增 `AgentSessionTaskRead`（响应 DTO，snake_case 对齐仓内惯例如 SessionRunRead）；数据流：producer=model.py AgentSessionTask 行 → GET 端点序列化 → consumer=前端 api-types 生成类型 |
| 修改 | backend/app/modules/daemon/router.py | ①`notify_agent_task_status`（router.py:2067）在 `publish_session_event` 转发的同时调用 upsert 服务函数（数据流：producer=daemon 上报 AgentTaskStatusEvent → 归一化点=端点模型校验 → 消费方①SSE 转发现有链路 + 消费方②新增 AgentSessionTaskUpsertService 落库）；②新增 `GET /sessions/{session_id}/tasks` 端点，鉴权与 runs 端点同款（`get_agent_session` + `TaskRunAgentUser`，读端点用户访问口径；区别于上报端点的 runtime 归属口径——两道闸门本就不同，自洽）（producer=DB 查询 → AgentSessionTaskRead → consumer=前端） |
| 新增 | backend/app/modules/daemon/agent_task_store.py | upsert 服务函数（insert-or-update + 终态定格语义，与前端归约同构）；session 级联删除清理挂 AgentSessionTask 的 FK cascade |
| 新增 | backend/app/modules/daemon/tests/test_agent_session_tasks.py | upsert 语义（新插/更新/终态定格）+ 快照端点（鉴权/形状/限 200 条）+ 会话删除级联 |
| 新增 | frontend/src/components/daemon/agent-task-store.ts | `applyAgentTaskStatusEvent` + 任务列表归约从 session-panel.tsx（约 L6528）抽出，session-panel 改引用（语义零变化） |
| 新增 | frontend/src/hooks/use-session-tasks.ts | 快照拉取（mount/重连）+ SSE 事件合并 hook；暴露 `applyEvent` 供 session-panel SSE 分发处调用（不新建第二条 SSE 连接） |
| 新增 | frontend/src/components/daemon/task-execution-panel.tsx | 折叠面板组件（摘要行+三页签；运行中区渲染现有三类卡，props 注入） |
| 修改 | frontend/src/components/daemon/session-panel.tsx | 三挂载点插入 TaskExecutionPanel（page：AgentLogCard 同层约 L4098；dialog：约 L5892 一带；mobile 分支同款内联）；SSE 分发处接线 applyEvent |
| 修改 | frontend/src/lib/daemon.ts | 新增 `listSessionTasks(sessionId)`（fetch 快照，命名对齐 `listSessionRuns` 先例 daemon.ts:3785） |
| 生成 | frontend/src/lib/api-types.ts + backend/openapi.json | `pnpm gen:types`（CLAUDE.md 规则 21；先验 node_modules 健康） |
| 新增 | frontend/src/components/daemon/__tests__/task-execution-panel.test.tsx | 三页签渲染/折叠摘要计数/空态（D-003）/事件合并用例 |

## 接口定义

**后端新端点**：

```
GET /api/daemon/sessions/{session_id}/tasks
  鉴权：与 GET /sessions/{id}/runs 同款会话访问校验
  响应：list[AgentSessionTaskRead]，按 updated_at desc 取最近 200 条
```

**AgentSessionTaskRead 字段**（与 AgentTaskStatusEvent 契约字段一一对应，schema.py:1219-1253；snake_case 对齐仓内 DTO 惯例）：
`id` / `session_id` / `run_id` / `task_id` / `task_name` / `status`（running|completed|failed|stopped）/ `progress` / `summary` / `message` / `last_tool_name` / `tool_use_id` / `elapsed_ms` / `total_tokens` / `tool_uses` / `is_async` / `started_at` / `finished_at` / `updated_at`

> 字段取舍说明（design-grill C-01/C-02 修正）：`run_id` 为事件必填字段（schema.py:1236）随事件入库；`progress` 当前后端无总量基准恒 null（agent-task-card.tsx:17-18 注释佐证）、`message` 为终态消息——两者列保留以对齐契约防未来漂移，UI 本期不展示 progress。

**前端 hook 签名**（示意）：

```ts
useSessionTasks(sessionId: string, opts?: { onReconnect?: () => void }): {
  tasks: AgentSessionTaskView[];      // 快照与事件合并后的视图列表
  applyEvent: (e: AgentTaskStatusEvent) => void;  // session-panel SSE 分发处调用
  loading: boolean;
}
```

**TaskExecutionPanel props**（示意）：`sessionId` / `runningTasks`（现有内存态 agent_tasks running 子集）/ `bashProgress` / `teamMissions` / `runsRefreshSignal`——运行中区纯展示注入，不新建数据链路。

## 生命周期契约表

本变更涉及 session/daemon 关键词，任务生命周期契约如下（task 状态机：`running → completed | failed | stopped`，终态定格）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| agent_task_status 上报 | daemon（hubClient.notifyAgentTaskStatus） | backend（POST /sessions/{id}/agent-task-status，router.py:2067） | **必需：session_id, run_id, task_id, task_name, status**（schema.py:1235-1239 必填五项）；其余 progress/summary/message/last_tool_name/elapsed_ms/total_tokens/tool_uses/tool_use_id/async 均为 Optional（schema.py:1240-1253） | agent_session_task 行 upsert：无则插入（started_at=now，status=running）；有则刷新；终态写 finished_at 且**定格**（终态后再收 running 不回退） |
| 任务快照拉取 | frontend（useSessionTasks） | backend（GET /sessions/{id}/tasks，新端点） | session_id（路径） | 无状态变化（读最近 200 条） |
| SSE agent_task_status 转发 | backend（publish_session_event） | frontend（会话 SSE 流，既有链路） | 同上报契约（by_alias） | 前端任务清单/运行中区实时更新（applyEvent 归约） |
| SSE turn_completed | backend（session service，既有） | frontend（既有 SSE 流） | runId, status | 轮次历史区刷新信号（refreshSignal） |

表内事件与任务映射：上报/落库 → Wave 1 任务 + 测试任务；快照/SSE 消费 → Wave 2/3 任务 + 前端测试。既有事件（turn_completed、bash_*）本变更只消费不改造。

## 数据模型

新表 `agent_session_task`（daemon 模块）：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| session_id | UUID FK→agent_session.id, ondelete CASCADE | 索引；随会话删除级联清理 |
| run_id | UUID, index, not null | 事件必填（schema.py:1236）；索引支撑后续按 run 分组增强，本期不建硬 FK（避免与 agent_runs 删除链耦合） |
| task_id | str(255) | 与 session_id 组成唯一约束 |
| task_name | str(512) | |
| status | str | running / completed / failed / stopped |
| progress | int null | 事件契约字段（int，schema.py:1240）；当前恒 null（无总量基准），列保留对齐契约 |
| summary | TEXT null | 「正在做什么」摘要，逐次覆盖 |
| message | TEXT null | 终态消息（前端归约现消费此字段，session-panel.tsx:6543） |
| last_tool_name | str(255) null | |
| tool_use_id | str(255) null | |
| elapsed_ms | int null | |
| total_tokens | int null | |
| tool_uses | int null | |
| is_async | bool default false | 事件契约 `async` |
| started_at | timestamptz null | 首次插入时置 now |
| finished_at | timestamptz null | 终态时置 now |
| created_at / updated_at | timestamptz | |

不新增事件日志表（不做逐事件流水回放，upsert 单行足够支撑清单展示；R-03 控制写放大）。

## 兼容策略

- 新表/新端点纯增量，无 API/表结构破坏性变更；不上报任务的会话 GET /tasks 返回 `[]`，面板显示空态（D-003）。
- `applyAgentTaskStatusEvent` 抽出为共享模块属等值重构，ActivityCatalog 行为不变（既有 session-panel 测试为回归闸门）。
- 未升级的 daemon（不上报 agent_task_status 的引擎）行为与现状完全一致。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | session-panel.tsx 6567 行巨石组件改动引发回归（/runtimes 弹窗零回归是硬约束） | P0 | 只加挂载点与事件接线；归约函数等值抽出；Wave 3 跑全部既有 session-panel 测试 |
| R-02 | alembic 并行变更撞 revision 多 head（已知坑，knowledge INDEX） | P1 | migration 的 down_revision 在 execute 时锚定当时 head；与本仓其它活跃变更（2026-09-04-conflict-resolve-entry 等）改库表时协调 |
| R-03 | 任务高频上报造成 DB 写放大 | P1 | upsert 单行更新 + (session_id, task_id) 唯一索引；不做事件流水表；事件天然频率受 daemon 侧节流约束 |
| R-04 | dialog 模式纵向空间挤压 | P2 | 折叠态仅一行；展开态 max-height 内部滚动（原型对照） |
| R-05 | 多引擎任务事件缺失（pi 无 task 帧） | P2 | 空态文案降级（D-003），不报错 |
| R-06 | pnpm gen:types 遇 node_modules 半坏误报（CLAUDE.md 规则 21） | P2 | 生成前 `pnpm exec tsc --version` 验健康 |
| R-07 | ⚠️ 自审存疑：plan_mode_entered 总纲不持久化，重连后依赖日志回放重建是否可靠（现有 PlanApprovalCard 同链路，未验证回放路径） | P2 | plan 阶段核对 plan_mode_entered 的历史回放机制；不可靠则总纲降级为「仅活跃轮显示」 |

## 决策追踪

| 决策 | 状态 | 覆盖 |
|---|---|---|
| D-001@v1 内容四项全要 | accepted | 设计目标 1/2、三区信息架构、FR-01~04 |
| D-002@v1 会话列表侧不做摘要 | accepted | 非目标第 1 条 |
| D-003@v1 多引擎空态降级 | accepted | 非目标第 4 条、兼容策略、R-05 |
| D-004@v1 形态选方案 B（⚠️ 自主决策待用户复核） | accepted | 总体方案、Wave 3、R-04 |
| D-005@v1 设计整体确认（⚠️ 自主决策待用户复核） | accepted | 本文档全文 |
| D-006@v1 design-grill 修正：数据模型对齐事件契约 | accepted | 数据模型/接口定义/生命周期契约表/非目标第 5 条 |

未解决事项：D-004/D-005 为自主模式下的推荐选择（用户未实时响应），最终汇报标注可否决；R-07 待 plan 阶段查证。

## 自审（Self-Review）

- ✅ 章节齐全：背景/目标/非目标/拆分/方案/清单（含数据流标注）/接口/生命周期契约表/数据模型/兼容/风险/决策追踪/自审。
- ✅ 生命周期契约表已含（session/daemon 关键词命中），事件→任务映射声明。
- ✅ 文件清单覆盖 backend/frontend/测试，字段数据流（producer→归一化→consumer）逐行交代；纯主仓变更，无跨仓段。
- ✅ 原型已生成（prototype-task-execution-panel.html，布局级变化属必须生成档）。
- ✅ 决策 D-001~D-006 全部引用；D-004/D-005 的自主决策属性如实标注。
- ✅ design-grill（独立子代理）P1 修正已合入（D-006）：①数据模型/DTO 补 `run_id`（事件必填）/`progress`/`message` 三列；②非目标「契约无 run_id」错误论据改写为「入库但不做关联消费」；③生命周期契约表必需字段改为 schema.py 真实必填五项；④迁移路径更正 `backend/migrations/versions/`；⑤函数名更正 `listSessionRuns`、新函数命名 `listSessionTasks`；⑥DTO 改 snake_case 对齐仓内惯例。
- ✅ 自审存疑 3（鉴权口径）已由 grill C-04 关闭：读端点（get_agent_session+TaskRunAgentUser）与写端点（runtime 归属）两道闸门本就不同，表述自洽。
- ⚠️ 自审存疑 1：`plan_mode_entered` 历史回放链路未实证（R-07，留 plan 核对）。
- ⚠️ 自审存疑 2：dialog/mobile 挂载点行号取自调研快照，execute 时以实际代码为准（行号仅导航用途）。
