---
id: task-04
title: daemon idle 禁用单测
priority: P1
wave: W2
depends_on: [task-01]
blocks: []
requirement_ids: [FR-1, FR-2]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/__tests__/session-manager-idle-disabled.test.ts
author: qinyi
created_at: 2026-06-25T15:52:00+08:00
---

# task-04: daemon idle 禁用单测

> 来源：plan.md Wave2 task-04 / SC-2, SC-4。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/interactive/__tests__/session-manager-idle-disabled.test.ts` | idle 默认禁用 + 逃生口 + 长 turn 不杀 |

## 实现要求（TDD）

1. 默认配置（无 opts.idleTimeoutSec、无 env）构造 SessionManager → 断言 `idleTimer` 为 null / `isIdleMonitorRunning()` false
2. 模拟长 turn：session running 持续推进 30min（mock 时钟）+ 持续 tool_use 事件 → 断言 end 未被调用
3. env `SESSION_IDLE_TIMEOUT_SEC=1800` 构造 → 断言定时器启动（旧行为）

## 验收标准

| 条件 | 预期 |
|---|---|
| 3 用例 | 全通过 |
| cd sillyhub-daemon && pnpm test | 该文件用例 pass |
