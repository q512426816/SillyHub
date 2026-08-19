---
author: WhaleFall
created_at: 2026-08-19 18:36:02
plan_level: full
---

# 实现计划（Plan）— 智能体会话流结构化重构

> 依据：design.md（v 含 Grill 修正）§5 三 Phase / §6 文件清单 / §7 接口定义；requirements.md FR-01..06；decisions.md D-001/002/003（全 accepted，无未决 blocker）。纯前端变更，无后端/daemon/schema/状态机面。

## Wave 1（并行，无依赖——类型与装配器核心）

- [x] task-01: 共享装配器核心（session-log-assembler.ts）：AssemblerLogInput 归一 + classifySessionLog 分类接入（自 session-log-sanitize.ts 迁移为装配器内部依赖，原文件保留导出垫片）+ 归属路由（parent_tool_use_id → tool 段 children / subagent_stub 兜底）+ 分段装配（文本分段/思考合并/工具归属桶位置配对）+ TurnSegment/AssembledTurn 模型（覆盖：FR-01, FR-03, FR-05, D-002@v1）
- [x] task-04: SessionStreamEnvelope 补归属字段类型声明 parent_tool_use_id/subagent_type/depth/tool_kind（lib/daemon.ts，可选可空，零运行时变化）（覆盖：FR-03, FR-05）

## Wave 2（依赖 W1——装配器完备 + 独立组件）

- [x] task-02: 装配器 override 撤回与去重：segmentId 前缀路由（main:/tool_use_id: 三段格式）+ 跨段撤回（分裂多段一并撤回）+ text.streaming 置位/清除 + log_id 与历史 seenText 双路去重 + stub 合并迁入（覆盖：FR-05）
- [x] task-05: 段渲染组件族（turn-segment-views.tsx）：TextSegment（流式光标）/ThinkingRow（折叠摘要流式跟随）/ToolRow（单行摘要+扫动动画+展开）/SubagentBlock（嵌套递归）/StderrRow，段级 memo + 稳定 id key（覆盖：FR-01, FR-03, FR-06）
- [x] task-07: 轮级状态条（turn-status-bar.tsx）：deriveTurnActivity 派生（工具计数递归/子代理清单/当前活动回退）+ 计时锚点（live 本地占位 / attach run.started_at / 缺则首条 log）+ 每秒 tick（覆盖：FR-02）
- [x] task-11: 历史路径接入：logsToTurns 内部改走 logsToSegments + 兼容投影（output/processItems + ts 映射）+ 保留 seenText 去重（覆盖：FR-01, FR-05）

## Wave 3（依赖 W2——渲染组装与装配器单测）

- [x] task-03: 装配器单测（session-log-assembler.test.ts）：分段/归属嵌套/override 跨段撤回/归属桶配对/兜底 stub 合并/双路去重/历史与实时一致性（覆盖：FR-01, FR-03, FR-05）
- [x] task-06: TurnTimeline v2：segments 消费 + 视图两态（对话=文本+状态条；all→「进度」）+ 内置 TurnStatusBar + AskUser 穿插保持 + segments 缺省回退旧渲染 + 适配 turn-timeline-session-input-bar.test.tsx 等直测组件的既有断言（覆盖：FR-01, FR-02, FR-06）

## Wave 4（依赖 W3——目录、两消费方接入）

- [x] task-08: 子代理目录（subagent-catalog.tsx）：运行脉冲+计数按钮 + 下拉清单（状态/名称/类型/时长 tick）+ 点击切进度视图+展开+滚动定位（覆盖：FR-04）
- [x] task-09: /sessions 页接入：applyLogToTurn 副本替换为装配器调用 + partialSegmentsRef 移除 + 计时锚点接线（占位/runsMeta.started_at）+ 头部挂 SubagentCatalog + viewMode 文案「全部」→「进度」（page.tsx:885）+ 适配 sessions page.test.tsx 既有断言（覆盖：FR-02, FR-04, FR-05）
- [x] task-10: runtimes 弹窗接入：interactive-session-panel 日志处理副本替换为装配器调用，状态条经 TurnTimeline 内置获得 + viewMode 文案同改（panel:1087）+ 适配 interactive-session-panel.test.tsx（16 处「全部」断言）（覆盖：FR-05）

## Wave 5（依赖 W4——新单测与全量收口）

- [x] task-12: turn-segment-views 段渲染单测（各段类型/折叠交互/扫动动画类名/视图两态/状态条派生）+ 全量 frontend test/lint 终扫（覆盖：FR-01..06）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 装配器核心 | W1 | P0 | — | FR-01/03/05, D-002 | 纯函数，无 React 依赖；含 sanitize.ts 迁移垫片 |
| task-04 | envelope 类型补字段 | W1 | P0 | — | FR-03/05 | 数据已在 SSE 流中，仅补声明 |
| task-02 | 撤回/去重/兜底完备 | W2 | P0 | task-01 | FR-05 | Grill X-01/06 修正项落地 |
| task-05 | 段渲染组件族 | W2 | P0 | task-01 | FR-01/03/06 | 视觉基准=prototype html |
| task-07 | 轮级状态条 | W2 | P1 | task-01 | FR-02 | 计时锚点三源策略 |
| task-11 | 历史路径接入 | W2 | P0 | task-01, task-04 | FR-01/05 | 兼容投影+ts 映射 |
| task-03 | 装配器单测 | W3 | P0 | task-02, task-11 | FR-01/03/05 | Grill 修正用例全覆盖 |
| task-06 | TurnTimeline v2 | W3 | P0 | task-05, task-07 | FR-01/02/06 | 含旧路径回退+直测断言适配 |
| task-08 | 子代理目录 | W4 | P1 | task-05, task-06, task-07 | FR-04 | 仅 /sessions 页挂载；消费 deriveTurnActivity |
| task-09 | sessions 页接入 | W4 | P0 | task-01, task-06, task-08 | FR-02/04/05 | 副本替换+锚点接线+文案+测试 |
| task-10 | 弹窗接入 | W4 | P0 | task-01, task-06 | FR-05 | 双消费方收敛+文案+16 处断言 |
| task-12 | 测试收口 | W5 | P0 | task-03..11 | FR-01..06 | 新单测+pnpm test/lint 终扫 |

## 关键路径

task-01 → task-05 → task-06 → task-08 → task-09 → task-12（装配器→段组件→渲染 v2→目录→接入→收口，最短交付链）

## 全局验收标准

- [ ] `cd frontend && pnpm test` 全绿（含新增装配器/段渲染单测与既有测试适配）
- [ ] `cd frontend && pnpm lint` 通过
- [ ] 集成冒烟：/sessions 页走一轮真实会话（含子代理调用），运行中状态条实时跳动、工具行扫动、子代理块内部进度可见；完成后分段结构与原型一致
- [ ] 集成冒烟：/runtimes 弹窗打开同一会话，渲染与 /sessions 页一致（除无子代理目录）
- [ ] brownfield：旧会话（无归属字段日志）打开渲染与现状等价；Codex 会话不回归
- [ ] 两处 applyLogToTurn 副本删除，全仓 grep 无残留日志处理第二实现

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-05, task-06 | 轮内分段渲染（全局验收第 3 条） |
| D-002@v1 | task-01, task-09, task-10, task-12 | 副本删除（全局验收第 6 条）+ 单测绿 |
| D-003@v1 | task-05, task-07, task-08 | 原型对照集成冒烟（状态条/子代理目录/嵌套块） |
| FR-01 | task-01/05/06/11/12 | 分段渲染 + 两路径一致性单测 |
| FR-02 | task-07, task-06, task-09 | 状态条集成冒烟（计时/计数/当前活动/attach 恢复） |
| FR-03 | task-01/02/03/05 | 归属嵌套 + 兜底 + 配对单测 |
| FR-04 | task-08, task-09 | 目录定位跳转集成冒烟 |
| FR-05 | task-01/02/09/10/11 | 副本删除 + 撤回/去重单测 |
| FR-06 | task-05, task-06 | 段级 memo（渲染更新不扩散，实现审查核验） |
