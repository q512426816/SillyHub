---
author: qinyi
created_at: 2026-08-30 16:32:02
---

# 决策记录（Decisions）

## D-001@v1: 时间口径 = 执行时间口径
- type: term
- priority: P0
- status: accepted
- source: user
- question: 变更/快速修复的「开始时间 / 结束时间 / 耗时」用什么口径计算（变更表本身无这三字段）
- answer: 执行时间口径（用户 AskUserQuestion 确认）。开始 = 该变更/快速修复关联的第一次执行的 started_at；结束 = 最近一次执行的 finished_at；耗时 = 各次执行 duration_ms 累加（纯执行时长，不含中途等待/挂起）。否决「生命周期口径（created_at→archived_at 墙钟跨度）」与「两套都要」。
- normalized_requirement: 时间三元组（开始/结束/耗时）全部从关联 AgentRun 集合实时聚合推导；无任何关联执行时三值显示「—」（不回退 created_at）。
- impacts: [FR-01, task-backend-aggregate, verify-aggregation]
- evidence: backend/app/modules/agent/model.py:115-119（started_at/finished_at）、:250（duration_ms）；用户回答轮次 1

## D-002@v1: token 统计范围 = 派发执行 ∪ 关联会话执行（按 run 去重）
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 变更 token 消耗统计哪些执行（agent_runs.change_id 派发锚点 vs change_session_links 会话锚点 vs 并集；M:N 绑定存在跨变更重复计数）
- answer: 并集去重（用户 AskUserQuestion 确认）。变更侧 = 直接挂 change_id 的 run ∪ 关联会话（change_session_links）内全部 run，按 run id 去重合并。跨变更共享会话时同一份消耗会在多个变更各显示一次——口径特性非 bug，详情页注明。快速修复无派发链路，恒走 quicklog_session_links→agent_sessions→agent_runs 会话链路（代码事实，非选项）。
- normalized_requirement: 聚合 SQL 以 run id 去重合并两个锚点来源；token 四维 + api_requests + num_turns 按去重后集合求和；明细分模型桶沿用 agent_run_model_usage 主源 + 无明细 run 四维列兜底的既有范式（2026-08-29-session-usage-stats D-004 同构）。
- impacts: [FR-02, task-backend-aggregate, verify-aggregation]
- evidence: backend/app/modules/change/model.py:255-296（ChangeSessionLink M:N）、:299-351（QuicklogSessionLink）、agent/model.py:237-244（agent_runs.change_id FK）；用户回答轮次 1

## D-003@v1: 落地方式 = 实时聚合计算字段（零迁移）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: token/时间信息持久化入表（迁移+回填+一致性维护）还是查询时实时聚合
- answer: 实时聚合（用户 AskUserQuestion 确认）。查询时从 agent_runs / agent_run_model_usage 现算，DTO 计算字段，不新建表列、零 migration；数字与最新执行终态一致。列表用批量聚合（一条 SQL 按变更分组）。否决「冗余入表」。
- normalized_requirement: 零 schema 变更；列表聚合单查询批量完成（禁止 N+1）；对齐仓库「计算字段（DTO 层），非表列，零 migration」既有惯例。
- impacts: [FR-02, task-backend-aggregate, task-backend-list, verify-aggregation]
- evidence: 先例 .sillyspec/changes/2026-08-29-session-usage-stats/design.md（同模式）；用户回答轮次 1

## D-004@v1: 展示位置 = 列表 + 详情都要
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: 时间/token 信息在哪里展示
- answer: 列表 + 详情都要（用户 AskUserQuestion 确认）。变更中心「变更」tab 与「快速修复」tab 列表各加摘要列（耗时 + token 总量档）；变更详情页与快速修复抽屉展示完整五指标（输入/输出/缓存读/缓存写/调用次数 + 轮次）+ 分模型明细。对齐运行时页/会话页用量卡先例。
- normalized_requirement: 前端两个列表组件加列（不破坏现有列布局，可用紧凑格式）；详情侧一个可复用用量组件覆盖变更详情与快速修复抽屉两渲染点。
- impacts: [FR-03, FR-04, task-frontend-list, task-frontend-detail]
- evidence: frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx:361-481（变更列定义）、frontend/src/components/changes/quicklog-table.tsx（快速修复列定义）；用户回答轮次 1

## D-005@v1: API 形态 = 方案 A（独立用量端点 + 列表内嵌摘要）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 后端 API 形态——独立用量端点+列表摘要（A）vs 全部内嵌详情响应体（B）vs 前端聚合（C）
- answer: 方案 A（用户 AskUserQuestion 确认）。列表 DTO（ChangeSummary / QuicklogEntryListItem）内嵌摘要字段，批量聚合一条 SQL 挂既有富化管道（零 N+1）；完整五指标+分模型明细走两个新独立端点；前端一个可复用用量组件覆盖变更详情页与快速修复抽屉。否决 B（详情响应膨胀、分模型明细无处安放、与先例不一致）与 C（run DTO 仅输入/输出两维，数据面不成立——session-usage-stats 先例已核实）。
- normalized_requirement: 新增 GET /api/workspaces/{wid}/changes/{cid}/usage 与 GET /api/workspaces/{wid}/quicklog-entries/{ql_id}/usage 两端点，响应结构对齐 SessionUsageRead 范式（totals + by_model）外加时间三元组；列表摘要经批量聚合（GROUP BY change_id / ql 维度）填充。
- impacts: [FR-02, FR-03, task-backend-aggregate, task-backend-list, task-backend-endpoints, task-frontend-detail]
- evidence: 先例 .sillyspec/changes/2026-08-29-session-usage-stats/design.md D-004；用户回答轮次 2

## D-006@v1: 软删会话的执行计入统计
- type: boundary
- priority: P2
- status: accepted
- source: design-grill
- question: `agent_sessions.deleted_at` 非空的软删会话，其执行是否计入变更/快速修复用量（UI 会话卡隐藏软删会话，但 agent_runs.agent_session_id 外键刻意 SET NULL 不断链，agent/model.py:767-769）
- answer: 计入。消耗真实发生，用量口径=真实成本；UI 隐藏是展示层整洁考虑，两者不矛盾——详情卡注脚声明（R-07）。孤儿 run（agent_session_id 已置空）经派发锚点 change_id 仍可命中，不丢数。
- normalized_requirement: 聚合集合不过滤 agent_sessions.deleted_at；口径注脚含「已删除会话的执行仍计入」表述。
- impacts: [FR-02, verify-aggregation]
- evidence: design.md 接口定义边界口径段；Design Grill G2（2026-08-30 独立子代理审查）

## D-007@v1: 用量卡取数用 react-query useQuery（非 useEffect）
- type: architecture
- priority: P2
- status: accepted
- source: design-grill
- question: 用量卡组件取数模式——useEffect 自取数（session-usage-bar 先例）还是 react-query useQuery
- answer: useQuery。两个目标渲染点的既有卡片（change-sessions-card.tsx:60 / quicklog-sessions-card.tsx:60）均用 useQuery 且都在 QueryClientProvider 内；session-usage-bar 规避的是会话浮窗零 react-query 约束，本变更两渲染点无此约束。变更详情页「本页禁新增网络请求」注释（[cid]/page.tsx:339）经核实为 last-signal 功能局部语境（禁的是为派生小字段加轮询，同页 sessions 卡已自取数）。
- normalized_requirement: change-usage-card 用 useQuery（queryKey 含 kind+workspaceId+refKey）；不引入轮询。
- impacts: [FR-03, task-frontend-detail]
- evidence: frontend/src/components/changes/detail/change-sessions-card.tsx:4,60、quicklog-sessions-card.tsx:3,60；Design Grill N1（2026-08-30 独立子代理审查）
