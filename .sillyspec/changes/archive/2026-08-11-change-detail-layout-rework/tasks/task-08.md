---
id: task-08
title: Existing test migration and full frontend regression
title_zh: 现有测试迁移与全量回归（page-team-toggle 重写指向 ChangeStageActions + frontend 模块 vitest 全量）
author: qinyi
created_at: 2026-08-11 11:36:04
priority: P0
depends_on:
  - task-04
  - task-06
blocks: []
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
related_tests:
  - path: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
    reason: 原整页 render page.tsx 硬断言 team toggle DOM（getByRole switch + aria-label 用团队执行）；team toggle 迁入 ChangeStageActions 后整页 JSX 结构变化，需重写指向新组件
goal: >
  team toggle（role=switch + aria-label=用团队执行 + StageTeamConfig 展开）从 page.tsx 迁入
  ChangeStageActions 后，把原整页 render 的 page-team-toggle 测试重写为直接渲染 ChangeStageActions
  组件的聚焦测试，保留全部渲染条件断言契约（execute/verify/plan_review/human_test 渲染，
  brainstorm/plan/archived 不渲染，开启后展开 StageTeamConfig），并跑 frontend 模块 vitest 全量回归，
  确认 change-session-section 等未受影响测试仍通过。
implementation:
  - 重写 page-team-toggle.test.tsx 为直接 render ChangeStageActions（不再 import ../page 整页），用最小 props 满足组件接口（change/agentStatus/nextStage/verifyGate/gateComment/各 onXxx 回调 vi.fn/transitioning/dispatching/advancing/stageProvider/stageModel/teamMode/stageWorkers 等）
  - teamMode 由测试内 state 包装或直接受控传入，断言渲染条件不变：execute 渲染含「用团队执行」文案的 role=switch；verify 渲染含「用团队验证」文案；plan+pending_review=plan_review 渲染；verify+pending_review=human_test 渲染；brainstorm/plan无pending/archived 不渲染
  - 保留开启 team toggle 后渲染 StageTeamConfig（+ 添加 Worker / Stage Worker 预设）的断言；mock 掉 StageTeamConfig 内部复杂依赖时以可断言的 testid 替身，但不断言被破坏的 aria 契约
  - mock 组件内嵌的 SillySpecStepProgress/AgentRunPanel/AgentProviderSelect/AgentModelInput 等重依赖为轻量替身，避免 SSE/dynamic import 链路
  - 跑 frontend 模块 vitest 全量，确认 change-session-section.test.tsx 及其它未迁移测试零回归；不为通过而改非测试逻辑
acceptance:
  - page-team-toggle.test.tsx 重写后指向 ChangeStageActions，全部原渲染条件断言（含 role=switch + aria-label=用团队执行/验证 契约）保留并通过
  - 开启 toggle 展开 StageTeamConfig 的断言保留并通过
  - frontend 模块 vitest 全量通过，change-session-section 等其它测试无回归失败
verify: cd frontend && pnpm exec tsc --noEmit && pnpm test
constraints:
  - 非测试逻辑本身有误时禁止直接改测试来通过（项目规则 9）；重写只改断言目标对象（page→ChangeStageActions），不放宽渲染条件语义
  - 不改 ChangeStageActions/page.tsx 实现代码；本任务仅迁移测试与跑回归
  - 保留 aria-label=用团队执行 + role=switch 的 DOM 契约断言（design R-06），不得删
  - 测试内组件 props 类型须与 design §7 ChangeStageActionsProps 对齐，过 tsc --noEmit
---

## 说明

- 覆盖：FR-06、非功能-可测试；决策 D-004@v1（全量重写含测试迁移）。
- 依据：design.md §7 `ChangeStageActionsProps`（team toggle 渲染条件 + role=switch + aria-label=用团队执行 的 DOM 契约必须从现 page.tsx 原样保留）、§9 现有测试迁移、§10 R-01/R-06。
- 现状 team toggle DOM 契约（page.tsx:794-835）：渲染条件为 `pending_review==="plan_review" || current_stage==="execute" || current_stage==="verify" || pending_review==="human_test"`；button `role="switch"` `aria-label="用团队执行"`；文案 `用团队{verify?"验证":"执行"}`；开启后渲染 StageTeamConfig。
- 原测试整页 render 并 mock @/lib/changes、@/lib/tasks、sillyspec-step-progress、agent-run-panel、change-session-section、change-file-tree、AgentProviderSelect；重写后改为直接渲染 ChangeStageActions，仅保留组件实际依赖的 mock。
- change-session-section.test.tsx 测 ChangeSessionSection 组件本身，本变更不改其内部实现（黑盒复用），预期零回归，仅作为全量回归的一部分验证。
