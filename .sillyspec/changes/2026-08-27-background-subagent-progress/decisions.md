---
author: qinyi
created_at: 2026-08-27 09:20:00
change: 2026-08-27-background-subagent-progress
---

# 决策台账 · 后台异步子代理进度可视化

本变更的决策台账（非长期术语表）。仅记录有实现/验收影响的决策。

## D-001@v1: 方案 A——daemon 消费 SDK task_* + agent_task_status SSE 通道扩展
- type: architecture
- status: accepted
- source: user
- priority: P0
- question: 后台异步子代理（Agent 工具 run_in_background）生命周期可视化的实现架构？
- answer: daemon session-manager 拦截 SDK `task_started/task_progress/task_notification` system 消息，映射为扩展的 `agent_task_status` SSE 事件（复用 Redis `agent_session:{id}` 频道模式），异步启动回执解析做兜底。否决方案 B（daemon 透传 system 落库、backend 解析派生：事件与日志两套真相源，历史回看重放解析脆弱）；否决方案 C（前端纯展示层聚合：永远缺终态信号，卡片转圈到会话结束）。
- normalized_requirement: 生命周期事件由 daemon 统一消费映射，backend 只透传不解析语义；回执解析兜底保证 CLI 不发 task_* 时不假完成。
- impacts: [design-§5-Phase1, design-§4, task-daemon-task-events]
- evidence: 用户 step 4 AskUserQuestion 选定方案 A；`sillyhub-daemon/src/interactive/session-manager.ts:4166-4180`（现有唯一 agent_task_status 发送点）；`backend/app/modules/daemon/run_sync/service.py:2281`（_extract_sdk_messages 丢弃 system 消息）

## D-002@v1: 生命周期双写——SSE 事件 + [TASK_*] 持久日志行
- type: architecture
- status: accepted
- source: user
- priority: P0
- question: SSE 事件是一次性的，刷新/历史回看如何重建后台任务状态？
- answer: 生命周期节点除发 SSE 外，同步落 `[TASK_STARTED]/[TASK_PROGRESS]/[TASK_NOTIFICATION]` 前缀的 stdout 日志行（单行 JSON，行级带 parent_tool_use_id）。前端 assembler 识别前缀解析为段元数据，回放与实时同源；行带 parent 自动享受跨轮归位。
- normalized_requirement: daemon 双写（SSE + 日志行）；[TASK_*] 行格式见 design §8；AgentRunLog 无 metadata 列（已知坑），语义靠文本前缀承载，不为此加列。
- impacts: [design-§5-Phase1-P1.3, design-§9-R-03, task-daemon-persist-lines, task-frontend-assembler]
- evidence: `agent_run_logs` 现有列（生产 \d 核实）；knowledge known-issues「AgentRunLog 无 metadata 列」

## D-003@v1: 跨轮归位在 backend 落库时做（submit_messages 重映射 run_id）
- type: architecture
- status: accepted
- source: user
- priority: P0
- question: 后台子代理在后续轮次继续产日志，前端当轮组装成孤儿 stub（时长"—"、与派发轮原块脱节），在哪一层归位？
- answer: backend `submit_messages` 落库时，带 parent_tool_use_id 的行查 tool_use_id→run_id 映射（进程内 LRU + agent_run_logs tool_call 行冷启动反查）改写为派发 run。否决前端会话级链接（每个消费日志的页面都要适配，容易漏）。历史数据不迁移（项目未上线）。
- normalized_requirement: 归位是写入时归因，单一真相源；查不到映射时保持现状兜底不报错。
- impacts: [design-§5-Phase2-P2.2, design-§9-R-04, task-backend-attribution]
- evidence: 用户 step 3 AskUserQuestion 选定"后端归位"；生产会话 dd345992 子代理日志跨 3 个 run 的实证（98 条 parent 行）

## D-004@v1: 空 prompt 防御——后端 422 为主，前端禁点为辅
- type: boundary
- status: accepted
- source: user
- priority: P1
- question: 空 prompt inject 能创建 50ms 完成的空轮（生产实证 run c78044c8），如何防御？
- answer: backend `inject_session` 对 strip 后为空的 prompt 抛 422（中文文案，领域类 SessionEmptyPrompt，过 l10n 守护）；前端发送按钮空内容 disabled 为辅助。服务端拒绝是权威（防任何调用方）。
- normalized_requirement: 422 响应体含中文 detail；不创建 AgentRun、不写 user_input 日志行。
- impacts: [design-§5-Phase2-P2.3, task-backend-empty-prompt]
- evidence: 用户 step 3 AskUserQuestion 选定"纳入"；生产 00:42:34 空 inject + run c78044c8 50ms 完成实证

## D-005@v1: 原型三主题对齐 themes.ts，默认暗夜
- type: ui
- status: accepted
- source: user
- priority: P2
- question: 原型视觉基准？（初版自造 cyan 主题被用户否决）
- answer: 原型 token 逐项对齐 `frontend/src/styles/themes.ts` 三主题（明亮蓝/AI 紫/暗夜），默认暗夜（用户当前使用主题），支持 ?theme= 预选。卡片/目录尺寸对齐真实组件（agent-task-card.tsx h-7 图标/10-12px 字号等）。
- normalized_requirement: 前端实现取色走 brand-* 语义阶（CLAUDE.md 规则 20 铁律），不硬编码主题色。
- impacts: [design-§5-Phase3, task-frontend-card, task-frontend-catalog]
- evidence: 用户原型两轮评审（初版否决 → 重写后确认）；`frontend/src/styles/themes.ts:72-143,153-177`
