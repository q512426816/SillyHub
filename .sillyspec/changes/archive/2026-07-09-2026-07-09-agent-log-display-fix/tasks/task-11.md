---
id: task-11
title: token 面板 killed/failed 占位（"已中断·未汇总"）
author: qinyi
created_at: 2026-07-09 06:17:11
priority: P2
depends_on: []
blocks: [task-13]
requirement_ids: [FR-08]
decision_ids: [D-003@v1]
allowed_paths:
  - frontend/src/components/agent-run-panel.tsx
  - frontend/src/components/daemon/runtime-session-dialog.tsx
---

## 目标

任务状态为 killed/failed 且终态字段（total_cost_usd / num_turns / duration_ms）为 NULL 时，token 面板不再显示空白或 0，改为明确的"已中断"/"未汇总"占位文案，告知"任务未完成"而非"数据缺失"。对应 D-003@v1。

## 实现步骤

1. `frontend/src/components/agent-run-panel.tsx`：TokenUsageBadge 渲染前判断 run.status
   - status === 'killed' 或 'failed' 且 token/cost/turns/duration 字段为 null → 渲染占位
   - 文案："已中断·未汇总"（token 维度）/"已中断"（轮次、时长）/费用同
2. `frontend/src/components/daemon/runtime-session-dialog.tsx`：同口径补占位（历史回看路径也可能命中 killed run）
3. 占位与正常四维渲染互斥：status 正常（completed/running）走原数值路径，不误占位
4. 占位文案统一常量化（避免两处硬编码漂移），抽到就近 helper 或 format-token

## 测试

- frontend vitest：
  - status=killed + 字段全 null → 渲染"已中断·未汇总"占位
  - status=completed + 字段有值 → 正常四维（不被占位覆盖）
  - status=failed + 部分 null → 命中占位

## 验收标准

- AC-08：组件测试 killed/failed + NULL → "已中断·未汇总"占位

## 依赖说明

- 无 depends_on（独立于 cache 维度修复）
- blocks task-13：前端 token 单测覆盖 killed 占位 case
- 注：DB 真实样例 83c46086 / 19be39ee / a15594a6 等 killed/failed run 字段全 NULL（D-003 evidence）
