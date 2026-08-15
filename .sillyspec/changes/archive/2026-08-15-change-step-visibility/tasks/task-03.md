---
id: task-03
title: regenerate api-types + openapi.json for step progress contract
title_zh: gen:types 重生成 api-types.ts 与 backend/openapi.json（step_progress + steps 新契约落地）
author: qinyi
created_at: 2026-08-16 01:01:55
priority: P0
depends_on: [task-01, task-02]
blocks: [task-04, task-05]
requirement_ids: [FR-04]
decision_ids: []
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
provides:
  - contract: StepProgressSummary
    fields: [step_total, steps_completed, current_step_name, current_step_status, current_step_desc]
  - contract: StepTimelineEntry
    fields: [name, stage, status, output, completed_at, ordering, wait_reason]
expects_from:
  task-02:
    - contract: StepProgressSummary
      needs: [step_total, steps_completed, current_step_name, current_step_status, current_step_desc]
    - contract: StepTimelineEntry
      needs: [name, stage, status, output, completed_at, ordering, wait_reason]
  task-01: enrich 填充使 openapi 响应形状含 step_progress 与 steps（非字段契约，字符串说明）
goal: >
  后端 schema 与 enrich 填充落地后重跑 gen:types，把 StepProgressSummary /
  StepTimelineEntry 类型与 step_progress / steps 字段生成进 api-types.ts，
  openapi.json 与 api-types.ts 两产物同 commit 提交，供 task-04/05 组件消费。
implementation:
  - worktree 无 node_modules，先 junction 主仓 frontend/node_modules（PowerShell New-Item Junction，勿在 worktree pnpm install）
  - 确认 node_modules 健康（pnpm exec tsc --version 能跑且 node_modules/.bin 有 openapi-typescript shim；半坏在主仓 pnpm install --force 修复）
  - cd frontend && pnpm gen:types（脚本内部先 uv run python scripts/dump_openapi.py 刷 backend/openapi.json 再 openapi-typescript 生成）
  - worktree 场景 dump 加载到主仓旧契约时（editable install 指向主仓 app），PYTHONPATH 指向 worktree 的 backend 目录重跑 dump 再生成
  - 生成后 grep api-types.ts 须含 step_progress 与 StepTimelineEntry（含 StepProgressSummary），0 命中即 dump 加载了旧契约，按上一步重跑
  - git add 两产物并同 commit 提交（pathspec 限定防裹挟他者 staged，commit 后 git show --stat HEAD 复核）
acceptance:
  - api-types.ts 含 StepProgressSummary 与 StepTimelineEntry 类型及 step_progress / steps 字段（grep 均命中）
  - backend/openapi.json 含 StepProgressSummary 与 StepTimelineEntry 的 schema 定义
  - 两产物均由 gen:types 生成无手写改动（gen:types:check 或 git diff 核对生成器输出一致）
verify:
  - cd frontend && pnpm gen:types
  - grep -c step_progress src/lib/api-types.ts（结果 >= 1）
  - grep -c StepTimelineEntry src/lib/api-types.ts（结果 >= 1）
  - git diff --stat -- backend/openapi.json frontend/src/lib/api-types.ts
constraints: 禁止手写 api-types.ts（CLAUDE.md 规则 21）；worktree 无 node_modules 用 junction 主仓，勿在 worktree 内 pnpm install；dump 加载主仓旧契约时 PYTHONPATH 指向 worktree 后端重跑；openapi.json 与 api-types.ts 两产物必须同 commit，不允许只提交其一。
---
