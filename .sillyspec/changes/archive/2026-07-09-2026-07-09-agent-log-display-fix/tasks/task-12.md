---
id: task-12
title: 历史回看 runtime-session-dialog 补 token 四维
author: qinyi
created_at: 2026-07-09 06:17:11
priority: P2
depends_on: []
blocks: [task-13]
requirement_ids: [FR-09]
decision_ids: [D-005@v1]
allowed_paths:
  - frontend/src/components/daemon/runtime-session-dialog.tsx
  - frontend/src/components/daemon/runtime-session-helpers.tsx
---

## 目标

历史回看路径（daemon/runtime-session-dialog 的 SessionHistoryView）当前无 token 显示，本次一致化补齐 token 四维（输入/输出/缓存读/缓存写），与 agent-run-panel 主面板口径统一。对应 D-005@v1。

## 实现步骤

1. `frontend/src/components/daemon/runtime-session-dialog.tsx` SessionHistoryView：补 token 四维面板
   - 数据源：run 终态 token 字段（input_tokens / output_tokens / cache_read_tokens / cache_creation_tokens）
2. 若 SessionHistoryView 渲染逻辑抽到 `runtime-session-helpers.tsx`，则改 helper；否则改 dialog 本体（执行前 grep 确认渲染归属）
3. 口径统一：复用 agent-run-panel 的 TokenUsageBadge 或同款格式（format-token.ts），避免两套数字格式漂移
4. 兼容 task-11：历史 run 若 status=killed/failed + 字段 null → 同样显示"已中断·未汇总"占位（口径与主面板一致）
5. cache_creation 为 0/null 时：若 task-09 落 B 分支，沿用 format-token 占位

## 测试

- frontend vitest：
  - 历史 run 字段齐全 → 四维数值正常渲染
  - 历史 killed run + 字段 null → 占位（与 task-11 口径一致）

## 验收标准

- AC-09：组件测试历史回看 token 四维

## 依赖说明

- 无硬 depends_on（独立于 task-10/11 的实现，但口径需对齐）
- blocks task-13：前端 token 单测覆盖历史回看四维 case
- 注：调研已确认路径 C（历史回看）原无 token 显示，与路径 A（主面板）/B（交互面板）不一致（D-005 evidence）
