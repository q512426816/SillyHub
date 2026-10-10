---
id: task-04
title: pi message_end folding with explicit fallback path
title_zh: pi message_end 折叠（含显式降级）
author: qinyi
created_at: 2026-10-10 19:56:43
priority: P1
depends_on: [task-01]
blocks: [task-05]
requirement_ids: [FR-03]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/src/interactive/pi-rpc-driver.ts
  - sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts
target_files:
  - sillyhub-daemon/src/interactive/pi-rpc-driver.ts
  - sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts
expects_from:
  task-01:
    - contract: AgentEventUsage.api_duration_ms
      needs: [api_duration_ms]
goal: >
  pi driver 在 assistant message_end 折叠本调用生成窗口并随 usage 携带
  api_duration_ms（FR-03）；若无内容级锚点（无法排除工具窗口）则显式降级
  v1 不接并留档，禁止墙钟充数。
implementation:
  - 先核 sillyhub-daemon/src/interactive/pi-rpc-driver.ts 事件面：assistant 内容事件可否作锚
  - 有锚：锚点记 generatingSince；message_end（assistant，:1381 分支）折叠清锚；usage 事件搭车；单测断言
  - 无锚：usage 不搭车该键（缺省无键=未计时），本卡 implementation 追加「降级留档：pi 无内容级锚点，v1 不接（FR-03 降级路径）」，单测改断言既有行为零回归
acceptance:
  - 接入路径：两段 assistant message_end 的 api_duration_ms = 两生成窗口之和
  - 降级路径：pi usage 事件不带 api_duration_ms 键（旧形态零变化），留档可查
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/interactive/pi-rpc-driver.test.ts
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 生成窗口口径：分母禁止计入工具执行时间；折叠负值钳 0、无锚不折叠
  - 数据不可得如实不显示：禁止墙钟估速、禁止伪造 0
  - 缺省不带键：usage 无 api_duration_ms 时输出对象禁止出现该键（旧事件零影响）

---
-->
