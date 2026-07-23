---
id: task-12
title: logsToTurns 内容重复修复（含 spike-01 复现）
title_zh: 修复 attach 历史消息内容重复显示
author: qinyi
created_at: 2026-07-12 00:30:00
priority: P0
depends_on: [task-08]
blocks: [task-13]
requirement_ids: [FR-04]
decision_ids: [D-004]
allowed_paths:
  - frontend/src/components/daemon/runtime-session-helpers.tsx
  - frontend/src/components/daemon/interactive-session-panel.tsx
provides:
  - behavior: attach_no_duplicate_content
goal: >
  修复 attach 历史会话时消息内容重复显示（如「你哈啊 你哈啊」），先 spike-01 真实复现定位根因（seenLogIds 不同源 vs logsToTurns 自身重复拼接），再按根因就地修复。
implementation:
  - 开 task-12 第一步先 spike-01：真实会话 attach 历史，落盘对比 initialTurns 与 SSE 推送，定位是 seenLogIds 不同源还是 logsToTurns 自身重复拼接（plan.md Spike 表）
  - 若是 SSE 重放与 initialTurns 重叠：扩展 attach 模式让 initialTurns 的 seenLogIds 与 SSE 推送的 log_id 同源去重（已在 onLog 用 seenLogIds 去重，确认同源；若不同源，attach 后丢弃首个 turn_started 之前的 log）
  - 若是 logsToTurns 自身重复拼接：在 runtime-session-helpers.tsx:587 logsToTurns 内按 channel 分流时去重（避免同条内容并入 prompt 又并入 output）
  - 修复点落在 interactive-session-panel.tsx:284 establishStream（attach 后 SSE 重放）或 runtime-session-helpers.tsx:587 logsToTurns，按真实根因择一或合并
  - 在 tasks 记录最终根因（C-4/F-3）
acceptance:
  - 真实会话 attach 历史后消息区无重复内容（如「你哈啊 你哈啊」只出现一次）
  - spike-01 根因在 task 文件记录（seenLogIds 不同源 / logsToTurns 重复 / 其他）
  - 不引入新的标记泄漏（task-08 的 sanitize 行为不回归）
verify:
  - cd frontend && pnpm test -- runtime-session-helpers
  - cd frontend && pnpm tsc --noEmit
constraints:
  - R-3/C-4/F-3（内容重复根因未在 design 期完全定位）：必须先真实会话复现定位根因再改，不盲目改（design §9 C-4）
  - 不阻塞其他任务（spike-01 在本任务内执行，不单独成 Wave，plan.md Spike 表）
  - 修复不得破坏 task-08 的 sanitize 过滤（标记过滤与去重正交）
---

## 验收标准
- 真实会话 attach 历史后消息区无重复内容（如「你哈啊 你哈啊」只出现一次）
- spike-01 根因在 task 文件记录（seenLogIds 不同源 / logsToTurns 重复 / 其他）
- 不引入新的标记泄漏（task-08 的 sanitize 行为不回归）

## 验证步骤
- cd frontend && pnpm test -- runtime-session-helpers
- cd frontend && pnpm tsc --noEmit
