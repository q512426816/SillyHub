---
id: task-08
title: auto_dispatch_next_step:197 读 gate_result 三态决策；verify stage gate 替代 read_verify_result（强制 gate 无 flag）
title_zh: gate 三态决策接线
author: qinyi
created_at: 2026-07-10 14:49:30
priority: P0
depends_on: [task-07]
blocks: [task-09, task-13]
requirement_ids: [FR-2, FR-3]
decision_ids: []
allowed_paths:
  - backend/app/modules/change/dispatch.py
---

## 契约

**provides**
- contract: auto_dispatch gate decision
  fields: [exit_0_advance, exit_1_kickback_point, exit_2_block]

**expects_from**
- task-04: contract `AgentRun.gate_fields` — needs: [gate_result]
- task-07: contract `_run_gate_decision_task` — needs: [gate_result]

## 实现要点

- **stage_completed 分支**（`dispatch.py:197`）：在 complete_stage 前读最新 AgentRun.gate_result.exit_code 三态决策：
  - `exit 0` → 推进：照常 `complete_stage` + dispatch 下一 stage（保留现逻辑）
  - `exit 1` → 打回：不 complete_stage，dispatch 同 stage 重跑，feedback 注入 errors；**记录打回点**（change.stages last_dispatch）供 task-09 累加 gate_retry_count（task-09 在此点接线）
  - `exit 2` → 卡住：不推进、不 dispatch，返回 `{dispatched: false, reason: gate_blocked}` + log 报警
- **verify stage 强制 gate**（`:221-222`）：`gate_result` 替代 `read_verify_result`，**无 flag 开关**；`gate_result is None`（未跑/异常/sillyspec 未发版）→ 视 exit 2 阻断 fail-loud（不 fallback 到 verify-result.md）
- **brownfield 非 verify 兼容**（design §9）：非 verify stage + `gate_result is None` → fallback 当前声明态行为不变（complete_stage 照常推进）
- 决策需读 AgentRun：取本 change 最近一条 completed 的 agent_run（gate_result 已由 task-07 写入）

## acceptance

- exit 0 → complete_stage + dispatch 下一 stage（推进不变）
- exit 1 → 不 complete_stage，dispatch 同 stage + feedback=errors，留打回点
- exit 2 → 不推进不 dispatch，fail-loud 报警
- verify stage `gate_result is None` → 阻断（不读 verify-result.md）
- 非 verify stage + `gate_result is None` → fallback 声明态推进（零回归）

## verify

```bash
cd backend && uv run pytest -k auto_dispatch && uv run ruff check && uv run mypy app
```

## constraints

- verify 强制 gate 无 flag（sillyspec 未发版则阻断，R4）
- 不删 `read_verify_result` 函数体（仅替换 `:221-222` 调用点，保留供回退）
- brownfield 非 verify 兼容（gate 列空不阻断非 verify 推进）
