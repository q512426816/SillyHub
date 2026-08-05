---
id: task-08
title: daemon budget 累计 + 软切断检查点（覆盖 FR-05, D-006/D-009）
title_zh: daemon 端 budget 累计与软切断
author: qinyi
created_at: 2026-08-05 19:24:02
priority: P1
depends_on: [task-07]
blocks: [task-09]
requirement_ids: [FR-05]
decision_ids: [D-006, D-009]
allowed_paths:
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/src/types.ts
  - sillyhub-daemon/src/daemon.ts
expects_from:
  task-07:
    - contract: LeaseCtx.budget_tokens
      needs: [budget_tokens]
goal: >
  daemon 端累计 token（口径 input 加 output，per-run，D-009），超 budget 软切断（当前 turn 完成后终止，D-006）并回传 budget_exceeded 事件。
implementation:
  - types.ts 的 LeaseCtx 加 budget_tokens 字段
  - task-runner.ts 新增 batch token 累计器（input 加 output，per-run，从 adapter stats 累计，当前无累计器）
  - session-manager.ts 复用现有 input 和 output 累计器加 budget 检查点
  - 累计大于等于 budget 时设 overBudget flag，当前 turn 或 step 完成后终止并回传 budget_exceeded 加 usage
  - budget_tokens 为 None 时检查点短路
  - "RS-4（Wave 2 扩展，补 task-07→task-08 契约缺口）：daemon.ts 未把 budget_tokens 从 claim payload 透传到 ctx / SessionManager.create——execPayload 构造（~3522，mcpRefs/skillRefs/effectiveAllowedRoots 已在此双写归一化，budget 缺）/ interactive create（~3191，三 profile 字段透传，budget 缺）/ batch ctx（~3625，同上，budget 缺）三处都没接 budget_tokens。导致 ctx.budget_tokens 恒 undefined → 上面的检查点永不触发（feature dormant）。补 3 行接线（照 effectiveAllowedRoots 透传 execPayload 的模式），让 task-07 双写进 claim payload 的 budget_tokens/budgetTokens 真正流到 task-runner.runLease(ctx) 与 SessionManager.create。"
acceptance:
  - task-runner 有 input 加 output 累计器（per-run 维度）
  - 超 budget 设 overBudget 且不调 close 或 kill（软切断守 D-006）
  - 回传 budget_exceeded 事件含 usage 字段
  - budget_tokens 为 None 时检查点短路不触发
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
  - cd sillyhub-daemon && pnpm exec vitest run src/task-runner src/interactive/session-manager
constraints:
  - 口径仅 input 加 output（不含 cache_read 或 cache_creation，D-009）
  - 软切断不硬 kill 当前 turn（D-006 避免丢失工作）
  - 不改 taskRunner.cancel 或 _killChild（复用现有 kill 通道）
---
