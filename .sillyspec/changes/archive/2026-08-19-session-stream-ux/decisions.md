---
author: WhaleFall
created_at: 2026-08-19 18:21:49
---

# 决策记录（Decisions）— 2026-08-19-session-stream-ux

## D-001@v1: 「阶段」= 轮内执行分段
- type: term
- status: accepted
- source: user
- question: 用户反馈「智能体回复都是合并的一整条，没按阶段去分」中「阶段」指什么？
- answer: 轮内执行分段——agent 一轮内「文本→工具→文本」交替的自然分段；非 SillySpec 流程阶段（brainstorm/plan/execute）。
- normalized_requirement: 一轮回复按真实到达顺序渲染为有序段序列（文本/思考/工具/stderr），文本不再 concat 为单条；不做流程阶段标注。
- impacts: [FR-01, §5 Phase2, §3 非目标]
- evidence: 用户 AskUserQuestion 回答（2026-08-19 brainstorm step3）
- priority: P0

## D-002@v1: 方案 C — 共享装配器 + 结构化渲染
- type: architecture
- status: accepted
- source: user
- question: 会话流重构走哪条路线（A 渐进增强 / B 全量移植 deepseek-harness 架构 / C 共享装配器）？
- answer: 方案 C：抽单一纯函数装配模块收敛两处 applyLogToTurn 副本，输出结构化轮次模型，配套段级渲染组件。参考 deepseek-harness 设计思想但不移植其插件化架构。
- normalized_requirement: 新建 session-log-assembler.ts 纯函数模块，实时 SSE 与历史恢复两路径统一；两消费方（sessions 页 + runtimes 弹窗）共用；不做事件/视图注册表。
- impacts: [FR-05, §5, §6 文件清单]
- evidence: 用户 AskUserQuestion 回答（2026-08-19 brainstorm step4，「C可以 你先出原型给我看一下」）
- priority: P0

## D-003@v1: 设计与原型确认
- type: boundary
- status: accepted
- source: user
- question: 设计方向（三 Phase + 原型 prototype-session-stream.html）是否确认？
- answer: 确认，继续。原型含：轮内分段、轮级状态条、子代理嵌套块、头部子代理目录。
- normalized_requirement: 以 prototype-session-stream.html 为视觉/交互基准；子代理展示参考 deepseek-harness SubagentCatalogAction（运行脉冲+计数+时长+点击定位），嵌套块内部进度可见。
- impacts: [FR-02, FR-03, FR-04, §5 Phase3]
- evidence: 用户 AskUserQuestion 回答（2026-08-19 brainstorm step5）
- priority: P1
