---
author: qinyi
created_at: 2026-09-04 23:29:31
---

# 决策记录（Decisions）

## D-001@v1: 任务执行面板内容范围（四项全要）
- type: term
- priority: P0
- status: accepted
- source: user
- question: 「任务执行面板」要展示哪些内容？
- answer: 用户多选全选四项——①后台任务实时状态（子 agent 任务/Bash/团队任务，现状藏在「后台 ▾」下拉）②执行步骤清单 TODO（类 Claude Code 步骤列表，现状无结构化数据）③轮次运行历史总览（每轮状态/耗时/token，数据已有只差展示）④任务记录不丢（现状 agent 任务数据纯前端内存态，刷新/切会话即丢）
- normalized_requirement: 会话面板新增任务执行面板，聚合展示：后台任务实时状态、agent 执行步骤 TODO 清单、轮次运行历史汇总；且任务数据服务端持久化，刷新页面/切换会话再回来不丢
- impacts: [FR-01, FR-02, FR-03, FR-04]
- evidence: AskUserQuestion 第 1 轮回答（2026-09-04 23:29，用户四项全选）

## D-002@v1: 范围边界——会话列表侧不做进度摘要
- type: boundary
- priority: P2
- status: accepted
- source: code
- question: 左栏会话列表条目是否也要展示任务进度摘要？
- answer: 用户原话聚焦「当前会话的进度」，列表侧摘要为衍生需求未提及；YAGNI 本轮不做
- normalized_requirement: 不改动会话列表条目（session-list-panel.tsx）；任务执行面板只落在会话主面板（session-panel page/dialog 双模式）
- impacts: [non-goals]
- evidence: 用户原话「方便用户随时看到当前会话的进度」+ 调研（列表刷新信号已存在但不带进度载荷）

## D-003@v1: 多引擎差异按降级处理
- type: premise
- priority: P1
- status: accepted
- source: code
- question: 平台支持 claude/codex/glm/pi 多引擎，TODO 步骤数据各引擎支持度不一（Claude 有 TodoWrite 类事件，pi-events.ts 无专门任务事件）怎么办？
- answer: 面板按「有数据就展示、无数据优雅空态」设计，不为凑齐多引擎强改各 adapter；TODO 数据链路优先走通用 agent_task_status 通道，引擎特有能力作为增强
- normalized_requirement: 无任务事件的引擎会话中，任务执行面板展示空态提示而非报错；不得因新面板破坏现有引擎会话
- impacts: [FR-02, 设计约束]
- evidence: 调研结论（sillyhub-daemon/src/interactive/claude-events.ts L634-641 有 task_* 事件；pi-events.ts L401-415 未知事件降级桶）

## D-004@v1: 面板形态选方案 B（头部折叠面板）——⚠️ 自主决策待用户复核
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: 任务执行面板采用哪种 UI 形态？（A 右侧常驻栏 / B 头部折叠面板 / C 任务视图 tab）
- answer: 选方案 B。三案后端改造等价，差异在前端：B 贴 session-panel.tsx:4098 已挂载的 AgentLogCard 折叠栏既有模式（图标+一行摘要+点击展开），page/弹窗双模式一套组件通用，三类任务卡（agent-task-card/bash-progress-card/team-task-block）直接复用，不挤压聊天宽度，/runtimes 弹窗零回归硬约束下风险最低。A 需动三处布局（sessions 网格 sessions-portal.tsx:541+弹窗+移动端）；C 与对话视图互斥不满足「随时看到」
- normalized_requirement: 任务执行面板=会话头部下方可折叠区，折叠态一行摘要（运行中任务数+步骤进度），展开态三区（步骤TODO/后台任务/轮次历史），page+dialog 双模式同组件
- impacts: [FR-01..FR-04, design-布局节]
- evidence: ⚠️ 自主模式用户未响应 AskUserQuestion（2026-09-04 23:3x），按推荐方案自主选定，非用户亲手选择——最终汇报须明确标注可否决，execute 前用户可改选 A/C

## D-005@v1: 设计方案整体确认——⚠️ 自主决策待用户复核
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: 分段设计（形态/信息架构/持久化/数据链路/范围）是否确认？
- answer: 五段设计按最佳判断定稿：①折叠面板三挂载点（page/dialog/mobile，AgentLogCard 同层）②三区=任务清单(持久化)/运行中(实时三类卡复用)/轮次历史(runs 数据)③agent_session_task 表+快照 REST+上报端点同步 upsert④useSessionTasks hook（快照+SSE 合并，applyAgentTaskStatusEvent 抽公用）⑤daemon 零改动/Bash 不持久化/多引擎空态
- normalized_requirement: design.md 按此五段展开；原型 prototype-task-execution-panel.html 为 UI 对照基准
- impacts: [design 全章节]
- evidence: ⚠️ 自主模式用户未响应设计确认 AskUserQuestion（2026-09-04 23:4x），自主推进——最终汇报标注可否决

## D-006@v1: design-grill 修正——数据模型对齐事件契约
- type: consistency
- priority: P1
- status: accepted
- source: design-grill
- question: design.md 初版数据模型/生命周期契约表与 AgentTaskStatusEvent 真实契约不符（漏 run_id/progress/message；非目标误称「契约无 run_id」；必需/可选字段错标）
- answer: 全部修正：①表/DTO 补 run_id（必填,索引）/progress（恒null保留对齐）/message（终态消息）三列；②非目标改口「run_id 入库但本期不做按 run 分组消费」；③契约表必需字段改为 schema.py 真实必填五项 session_id/run_id/task_id/task_name/status；④迁移路径更正 backend/migrations/versions/（alembic.ini script_location=migrations）；⑤函数名更正 listSessionRuns（daemon.ts:3785），新函数命名 listSessionTasks；⑥DTO snake_case 对齐仓内惯例
- normalized_requirement: agent_session_task 表列集 = 事件契约字段超集（+id/started_at/finished_at/created_at/updated_at）；GET tasks 响应与表列一致；不虚构不存在的函数/路径
- impacts: [数据模型节, 接口定义节, 生命周期契约表, 文件变更清单]
- evidence: 独立审查子代理报告 C-01/C-02/C-03/C-05/C-06/C-07（schema.py:1236/1240-1241、backend/migrations/versions/ 实存 184 文件、daemon.ts:3785）；修正于 2026-09-04 23:5x

## D-007@v1: 计划执行确认——⚠️ 自主决策待用户复核
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: plan_level=full 的执行前确认门（用户未实时响应）是否放行进入 execute？
- answer: 放行。计划已经独立审查子代理双 pass（plan-review-2026-09-05-000548），2 个非阻断 gap（W3 内 task-09 先于 task-06 的类型产物依赖；task-05 保留 re-export 防 agent-task-card-lifecycle.test.tsx:35 断链）已修入 plan.md 并重算 docHash；需求方向来自用户原始请求，代码改动全部可回退（git）
- normalized_requirement: execute 按已确认 plan.md 6 Wave/10 任务推进；D-004/D-005/D-007 三项自主决策在最终汇报集中标注可否决
- impacts: [execute 全阶段]
- evidence: ⚠️ 自主模式用户未响应执行确认 AskUserQuestion（2026-09-05 00:1x），按最佳判断放行并如实标注
