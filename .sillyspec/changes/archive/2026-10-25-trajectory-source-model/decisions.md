---
author: qinyi
created_at: 2026-10-25 09:48:17
generated_by: sillyspec-fourpiece-init
change: 2026-10-25-trajectory-source-model
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: 按 dsh 引擎机制做全套（消息来源标记 + 请求头快照），跨三端
- type: architecture
- priority: P0
- status: confirmed
- source: user
- question: 轨迹「系统/上下文」行的实现机制与范围？
- answer: 用户否决前端启发式（2026-10-25-trajectory-system-rows 已 reject），要求按 dsh 机制做全套：消息来源标记（source）+ 请求级系统提示词/工具快照上报，含 daemon 侧改造，跨 backend + sillyhub-daemon + frontend 三端完整流程。
- normalized_requirement: 来源标记在数据层（metadata）产生并逐层透传到 UI；请求头快照由 daemon 轮边界上报；前端按数据标记派生行，不猜文本。
- impacts: [FR-01, FR-02, FR-03, task-*]
- evidence: 用户 2026-10-25 回答（本会话）；dsh 调研：deepseek-harness/packages/llm/llm/src/message.ts:103-136（MessageSourceMap）
- 故障面: 盖戳遗漏新增注入点时该类消息回退「用户」行（可发现的标签回退，非数据损坏）。
- 退役判据: 若平台日志层未来引入原生来源列，metadata 键机制可整体退役。

## D-002@v1: 系统提示词行做「配置面快照」口径（引擎全文不可得）
- type: boundary
- priority: P0
- status: confirmed
- source: user
- question: dsh 能显示引擎真实系统提示词全文变更，本平台引擎是 Claude Code CLI、daemon 拿不到 preset 展开后的全文，系统提示词行按什么口径做？
- answer: 用户裁决：做配置面快照——daemon 轮边界上报「档案配置的 systemPrompt 追加段 + 工具清单」快照，变更时显示「系统提示词已更新/工具已更新」行；对比对象是配置面非引擎全文，该边界写入设计文档。
- normalized_requirement: 快照 = {systemPrompt 配置段, allowedTools, mcpServers 清单}；变更检测照搬 dsh headerEquals 字段级比较；文案不声称引擎全文。
- impacts: [FR-02, task-*]
- evidence: 用户 2026-10-25 回答（本会话）；deepseek-harness/packages/core/session/src/request-header.ts:21-52；sillyhub-daemon/src/interactive/session-manager/driver-factory.ts:224,244-250

## D-003@v1: 存量历史会话如实呈现（无标记 → 用户行），不做启发式兜底
- type: boundary
- priority: P1
- status: confirmed
- source: user
- question: 存量无标记数据（历史会话的团队派发/注入轮）如何呈现？
- answer: 用户裁决：如实呈现——新机制只对新产生的会话生效，存量无标记的历史注入仍显示「用户」行，不伪造标记、不保留启发式兜底（与 dsh 数据驱动同构）。
- normalized_requirement: 前端只按 metadata 标记派生行；无标记数据一律用户行；禁用文本前缀识别路径。
- impacts: [FR-03, task-*]
- evidence: 用户 2026-10-25 回答（本会话）

## D-004@v1: revert 已提交的启发式代码（77ba0588b / c93aafc84）
- type: process
- priority: P1
- status: confirmed
- source: user
- question: 2026-10-25-trajectory-system-rows 已提交的前端启发式代码如何处置？
- answer: 用户裁决：在新变更中 revert 这两笔提交，方案彻底切换到 dsh 机制（代码已在 main，通过 revert commit 处理，不 reset 历史）。
- normalized_requirement: 变更内含 revert 提交；启发式识别代码（TEAM_DISPATCH_PREFIXES/isTeamDispatchText/systemBrief）全部移除。
- impacts: [task-00, task-*]
- evidence: 用户 2026-10-25 回答（本会话）；git 77ba0588b、c93aafc84

## D-005@v1: 采用方案 A——复用日志通道（metadata 盖戳 + 新 channel 快照 + submit 透传修复）
- type: architecture
- priority: P0
- status: confirmed
- source: user
- question: 三端实现方案选哪个？
- answer: 用户选 A：注入点盖 metadata（照 turn_trigger 先例）；daemon 轮边界把配置快照作为新 channel 日志上报；修复 submit_steps metadata 只落 _agent_event 的透传缺陷；前端新增段类型照 turn_trigger 先例装配。全链路复用现有管道，历史回放自动有快照。
- normalized_requirement: 不新建表/端点；快照走 AgentRunLog（新 channel + metadata）；submit 链 metadata 通用透传；前端读新键。
- impacts: [FR-01, FR-02, FR-03, task-*]
- evidence: 用户 2026-10-25 方案选择（本会话）；backend/app/modules/daemon/session/service/inject.py:784-806；backend/app/modules/daemon/run_sync/service/submit_steps.py:628-632
- 故障面: channel 扩枚举后旧前端把快照行当未知日志（需前端兼容分类：未知 channel 归中性系统行不丢）。
- 退役判据: 若日志层拆分内容/元数据双流，快照 channel 可迁离。

## D-006@v1: 否决「独立快照表 + REST 上报」（方案 B）
- type: architecture
- priority: P2
- status: rejected
- source: user
- question: 三端实现方案选哪个？
- answer: 用户未选 B。
- normalized_requirement: 不新建 agent_run_headers 表与端点。
- impacts: []
- evidence: 用户 2026-10-25 方案选择（本会话）
- 否决理由: 新表+新端点+前端新查询链路，实时/回放各接一套，改动面远大于复用现有日志管道且无对应收益。
- 复潮条件: 日志表容量/查询性能因快照行出现实测问题时重议。

## D-007@v1: 否决「纯前端不落库」（方案 C）
- type: architecture
- priority: P2
- status: rejected
- source: user
- question: 三端实现方案选哪个？
- answer: 用户未选 C。
- normalized_requirement: 快照必须落库。
- impacts: []
- evidence: 用户 2026-10-25 方案选择（本会话）
- 否决理由: 刷新即丢、历史会话无快照，不满足 D-001 的历史回放要求。
- 复潮条件: 无（需求本身要求持久化，除非需求变更）。

## D-008@v1: 设计定稿——三段式（注入盖戳 / daemon 快照 / 前端行）+ 真码原型
- type: architecture
- priority: P0
- status: confirmed
- source: user
- question: 分段设计（注入点盖 turn_trigger 三新 kind / daemon 配置面快照 initial+change 上报 / 前端 session_header 段与系统行）是否定稿？
- answer: 用户确认定稿；原型（轨迹原型扩展三类新行）已登记 prototype-trajectory-source-model.html。
- normalized_requirement: 按三段设计实施；系统行文案照 dsh（初始系统提示词/系统提示词已更新/工具已更新）；diff 分类在前端。
- impacts: [FR-01~FR-05, task-*]
- evidence: 用户 2026-10-25 设计确认（本会话）；frontend/src/components/prototype/trajectory-redesign-view.tsx

## D-009@v1: 新注入类归 turn_trigger 体系（非独立 sender 键）
- type: architecture
- priority: P1
- status: accepted
- source: code
- question: 消息来源标记用独立 sender 键还是扩 turn_trigger 闭表？
- answer: 我的判断：扩 turn_trigger（team_brief / worker_dispatch / agent_notice 三新 kind）——前端配置表/装配链/轨迹映射全套已就位，零新管道；dsh 的 source.kind 独立轴在本平台等价物即该闭表。
- normalized_requirement: 不新增并列元数据键；三注入点传 turn_trigger。
- impacts: [FR-01, task-*]
- evidence: frontend/src/components/daemon/session-log-assembler.ts:2201-2212；backend/app/modules/daemon/session/service/inject.py:784-806

## D-010@v1: 变更检测在 daemon 侧，只报 initial/change（非每轮落快照）
- type: architecture
- priority: P1
- status: accepted
- source: code
- question: 请求头快照每轮上报还是变更时上报？
- answer: 我的判断：daemon 缓存上次快照做字段级比较，仅 initial 与 change 上报——dsh 同构（agent.ts:635-650 同款条件），省日志量。
- normalized_requirement: 会话内 header 相同不重复落库；重启/resume 视为 initial。
- impacts: [FR-02, task-*]
- evidence: deepseek-harness/packages/core/agent-loop/src/agent.ts:635-650

## D-011@v1: 系统行只在轨迹视图显示，会话页聊天流不加新行
- type: scope
- priority: P2
- status: accepted
- source: code
- question: session_header 行是否也进会话页对话/进度视图？
- answer: 我的判断：只进轨迹（用户验收面在轨迹）；会话页呈现留待实际需要再议（YAGNI）。
- normalized_requirement: 前端装配 session_header 段但不渲染进轮块流。
- impacts: [FR-03, task-*]
- evidence: 用户验收语境（本会话）
