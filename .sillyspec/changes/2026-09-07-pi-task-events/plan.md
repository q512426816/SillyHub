---
author: qinyi
created_at: 2026-09-07 10:40:00
plan_level: light
---

# 轻量计划（Light Plan）— pi 引擎任务事件派生

## 来源

design.md（2026-09-07-pi-task-events，grill 修正后版）：PiEventNormalizer 增实例级 turnTask 状态机（D-001 一轮一任务聚合 / D-002 归一化器内派生），产出 status/agent_task_status 事件零侵入复用既有上报链路。FR-01~04。

## 范围

- `sillyhub-daemon/src/interactive/pi-events.ts` — turnTask 状态机（task-01）
- `sillyhub-daemon/tests/interactive/pi-events.test.ts` — 既有 expected 适配 + 新状态机用例（task-02）
- `sillyhub-daemon/tests/interactive/pi-task-dispatch.test.ts` — session-manager 分派集成用例（task-03，新文件）
- `.sillyspec/docs/SillyHub/modules/daemon.md` — pi 派生说明（task-04 收尾）

## 验收

- FR-01：完整轮（turn_start→tool_execution_start×2→turn_end(stop)) 产出 running→刷新→completed 事件序列；tool_execution_end 零事件；error stopReason→failed。
- FR-02：集成用例证明 agent_task_status 经 _dispatchStatusEvent emit（无 envelopeHasTaskToolUse 特判路径）。
- FR-03：上一轮未收尾时新 turn_start 先补 completed；状态机异常不阻断原始事件流。
- FR-04：既有 pi-events 用例全部绿（expected 适配后）；vitest 相关子集回归通过；tsc/lint 清零。
- ESM import 带 .js 扩展名；禁跑全量测试。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02 | 一轮一行/工具刷新/终态映射用例 |
| D-002@v1 | task-01, task-03 | 零侵入链路集成用例（⚠️ 自主待复核） |
| D-003@v1 | 全部 | 设计整体（⚠️ 自主待复核） |
| D-004@v1 | task-01, task-02 | stopReason 实证映射/测试路径/expected 适配口径 |
