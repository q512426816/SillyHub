---
id: task-12
title: 'Frontend model lane: consume real timing, single-colour fallback'
title_zh: '前端模型泳道：真实区间消费 + 无采样单色降级'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-21 14:49:18
priority: P1
depends_on: [task-08, task-10]
blocks: []
requirement_ids: [FR-11, FR-15]
decision_ids: [D-024@v1, D-026@v1]
allowed_paths:
  - frontend/src/components/daemon/trajectory/
target_files:
  - frontend/src/components/daemon/trajectory/build-trajectory.ts
  - frontend/src/components/daemon/trajectory/trajectory-timeline.tsx
  - frontend/src/components/daemon/trajectory/__tests__/build-trajectory.test.ts
  - frontend/src/components/daemon/trajectory/__tests__/trajectory-timeline.test.tsx
expects_from:
  task-08:
    - contract: turn-snapshot-read-model
      needs: [timing]
goal: >
  模型泳道从「整段非工具空档近似」升级为「真实 API 占用区间」：存在 timing 时按 attempt 出条（含 TTFT 标注），
  缺失时保持现有单色近似并显式标注「近似」。D-026 的退役判据就此兑现，但**不得**做 TTFT/decode 双色切分。
implementation:
  - '`frontend/src/components/daemon/trajectory/build-trajectory.ts`：`buildTrajectory(logs, runs, opts?)` 的 run 输入新增可选 `timing`（task-08 读模型字段）；`deriveModelSpans` 分支化——①`timing` 存在且 attempts 非空 → 每个 attempt 出一根 model 条（start=startedAt、end=endedAt、label 含 model 与 ttft 毫秒），与工具区间仍做差集保证零重叠；②缺 timing → 走现有「整段非工具空档且含思考/答复行」口径，并在返回值上标 `modelBasis: "approx"`（有 timing 时 `"observed"`）'
  - '不变量保持：`coverage.modelMs + coverage.toolMs ≤ coverage.windowMs`；model 条与 tool 条零重叠；同输入恒同输出（无全局状态/无时间源）'
  - '`frontend/src/components/daemon/trajectory/trajectory-timeline.tsx`：模型泳道头部标注当前口径——`observed` → 「真实占用」；`approx` → 「近似（无 TTFT 采样）」，保持既有 `模型 x% · 工具 y% · 空档 z%` 摘要与三主题 token 配色；轴右缘与账本右缘对齐 Δ≤2px 不得回归'
  - '测试（写进既有文件，不新建测试文件）：`__tests__/build-trajectory.test.ts` 追加——①timing 存在 → 模型条数=attempt 数且区间精确 ②timing 缺失 → `modelBasis="approx"` 且条数与旧口径一致 ③timing 与工具区间重叠时被差集裁掉 ④coverage 并集不超窗；`__tests__/trajectory-timeline.test.tsx` 追加——⑤`observed`/`approx` 两态标注文案在场（并保持既有 7 例绿）'
acceptance:
  - '上述 5 例（追加）全绿，`build-trajectory` 既有 31 例与 `trajectory-timeline` 既有 7 例不回归'
  - 'timing 缺失时 `modelBasis="approx"` 且 UI 出现「近似」字样；timing 存在时出现「真实占用」且不出「近似」（两态互斥断言）'
  - '不做 TTFT/decode 双色切分：模型条仍是单色，仅标注 TTFT 数值'
  - '轴右缘与账本盒右缘仍对齐（导出稿复测 Δ≤2px，`trajectory-bar` 计数不因本卡减少）'
verify:
  - cd frontend && node node_modules/vitest/vitest.mjs run src/components/daemon/trajectory/__tests__/build-trajectory.test.ts src/components/daemon/trajectory/__tests__/trajectory-timeline.test.tsx
  - cd frontend && node node_modules/typescript/bin/tsc --noEmit
constraints:
  - 只消费读模型字段，不新增 fetch / 端点 / store（轨迹视图零数据依赖）
  - 无 timing 时行为必须与当前完全一致（单色近似 + 既有覆盖率口径）
  - 不引虚拟化库；行级 content-visibility 保持
related_tests:
  - path: frontend/src/components/daemon/trajectory/__tests__/build-trajectory.test.ts
    reason: 模型条派生口径是这 31 例的断言面；分支化后必须扩充而不是让旧断言失效
  - path: frontend/src/components/daemon/trajectory/__tests__/trajectory-timeline.test.tsx
    reason: 泳道组件新增「近似/真实占用」标注，7 例中的渲染断言需同步
---
