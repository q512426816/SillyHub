---
author: qinyi
created_at: 2026-09-07 10:15:00
---

# 决策记录（Decisions）

## D-001@v1: 本期范围——P1 全量 a-e
- type: scope
- priority: P0
- status: accepted
- source: user
- question: 本期变更范围切法？（A P1 全量 a-e / B 先 P1a-c / C 只做 P1a+b）
- answer: A（P1 全量）。daemon 推导+自发现、后端状态字段+接口、前端状态灯+提醒、claude/codex 格式补齐、编排知情决策（P1e）全部纳入本期；P2（agents status 命令）在 sillyspec 仓另立变更，不在本仓范围
- normalized_requirement: 本变更交付物含 daemon tailer+自发现+三个 deriver、backend 状态列+/api/agent-logs/states+agent_blocked 通知+list_workers liveness、前端徽章+聚合+通知消费、sillyspec 仓派发模板改写；不含 agents status CLI 与协议 §8 定稿
- impacts: [FR-01, FR-02, FR-03, FR-04, FR-05]
- evidence: 用户 AskUserQuestion 需求澄清轮实答（2026-09-07）

## D-002@v1: E-01 纳入本期
- type: scope
- priority: P1
- status: accepted
- source: user
- question: E-01（裸 claude CLI transcript 是否记录等人事件——三项实证后日志推导 blocked 的唯一剩余候选）是否纳入本期？
- answer: 纳入。E-01 实证与 claude deriver 的 blocked 部分都进本期 P1d；证伪则日志推导侧 blocked 彻底关闭并如实定稿
- normalized_requirement: claude deriver 实现分两步——先实证（裸 claude transcript 是否记 permission 等待）再决定 blocked 分支；证伪时 deriver 只保留 working/idle 规则并在文档记录结论
- impacts: [FR-04]
- evidence: 用户 AskUserQuestion 需求澄清轮实答（2026-09-07）；背景＝sillyspec 仓草案 E-02/E-03/E-08 实证收敛（blocked 走第一方事件，日志推导仅剩裸 claude CLI 候选）

## D-003@v1: 实现方案——daemon 自发现 + 日志 tail 推导 + 第一方事件汇聚（方案 1）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 实现路线三选一？（1 daemon 自发现+日志推导+第一方权限事件汇聚 / 2 CLI 常驻推导上报 / 3 纯第一方事件不读日志）
- answer: 方案 1。唯一同时满足"全托管会话有状态灯（含 zcode 非托管登记）"与"blocked 确定性"的路线，CLI 契约零变更零回归（草案 D-005），五层既有地基全复用；代价是 daemon 侧工作量最大，由 P1a 先行消化。方案 2 违反"CLI 非执行体"既定定位且覆盖不了登记盲区；方案 3 放弃 zcode/裸会话覆盖，G-1 达不成
- normalized_requirement: 发现通道双源（daemon 自发现为主 + SillySpec 登记为 ctx 增强）；状态源优先级＝第一方权限事件 > 日志推导（禁止两套 blocked 语义并行）；推导规则以协议文档为单一事实源、双端 fixture 对拍
- impacts: [FR-01, FR-02, FR-03, FR-04, FR-05]
- evidence: 用户 AskUserQuestion 方案轮实答选方案 1（2026-09-07）；方案依据＝sillyspec 仓 docs/agent-liveness-derivation-design-draft.md（2026-09-07 实证回写版，D-001~D-012 决策链）+ 本会话 E-02/E-03/E-08 三项实证
