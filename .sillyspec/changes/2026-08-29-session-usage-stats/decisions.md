---
author: qinyi
created_at: 2026-08-29 12:38:20
---

# 决策记录（Decisions）

## D-001@v1: 用量统计展示位置
- type: scope
- priority: P0
- status: accepted
- source: user
- question: 会话 token 用量统计显示在哪里（page 会话详情页 / dialog 浮窗对话）？
- answer: 两处都显示——page 会话详情页 + dialog 浮窗对话，同一组件复用（与 suspended 横幅等双模式先例一致）
- normalized_requirement: 用量条组件在 session-panel 的 page 与 dialog 两模式渲染；单一实现两处复用，不写两套
- impacts: [FR-02]
- evidence: 用户 AskUserQuestion 回答第 1 轮（2026-08-29）

## D-002@v1: 展示粒度
- type: scope
- priority: P0
- status: accepted
- source: user
- question: 展示粒度（仅会话级汇总 vs 汇总+按模型明细）？
- answer: 汇总+按模型折叠明细——默认显示会话级总数（输入/输出/缓存输入/请求次数/命中率），可展开按模型分组明细，对齐运行时页用量卡交互
- normalized_requirement: 会话级汇总常驻 + 按模型分组可折叠；分组行含四维 token 与请求次数；数据按 run×模型明细聚合（会话可能中途切模型）
- impacts: [FR-01, FR-02]
- evidence: 用户 AskUserQuestion 回答第 2 轮（2026-08-29）

## D-003@v1: 缓存命中率口径
- type: term
- priority: P0
- status: accepted
- source: user
- question: 缓存命中率怎么算？
- answer: 读取÷(读取+新输入)——cache_read_tokens / (cache_read_tokens + input_tokens)，业界 prompt cache 常用口径
- normalized_requirement: 命中率 = cache_read/(cache_read+input)，分母为 0 时显示「—」不显示 NaN/0%；会话级与模型级同口径
- impacts: [FR-01, FR-02]
- evidence: 用户 AskUserQuestion 回答第 3 轮（2026-08-29）

## D-004@v1: 数据链路实现方案
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 实现方案（A 新增会话用量端点 / B 塞进会话详情 / C 前端聚合轮次列表）？
- answer: 方案 A——新增 GET /api/daemon/sessions/{id}/usage 聚合端点：agent_run_model_usage 按 session 的 runs 聚合为主、AgentRun 六 token 列兜底无明细行的老 run，返回会话汇总+按模型分组；与 /runtimes/usage 先例同模式
- normalized_requirement: 后端权威聚合（一次查询）；不采用 B（详情响应膨胀、分组明细无处安放）；不采用 C（runs 列表仅输入/输出两维，缺缓存四维与请求次数，数据面不成立——已核实 SessionRunRead）
- impacts: [FR-01, FR-03]
- evidence: 用户 AskUserQuestion 方案选择轮（2026-08-29）；runs 列表字段核实 backend/app/modules/daemon/router.py:2137 SessionRunRead
