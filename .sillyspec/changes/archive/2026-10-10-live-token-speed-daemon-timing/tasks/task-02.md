---
id: task-02
title: claude bucket timing with live refresh and pendingUsage piggyback
title_zh: claude 桶计时 + pendingUsage 搭车
author: qinyi
created_at: 2026-10-10 19:56:43
priority: P0
depends_on: [task-01]
blocks: [task-05]
requirement_ids: [FR-01]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/src/interactive/claude-events.ts
  - sillyhub-daemon/tests/interactive/claude-events.test.ts
target_files:
  - sillyhub-daemon/src/interactive/claude-events.ts
  - sillyhub-daemon/tests/interactive/claude-events.test.ts
expects_from:
  task-01:
    - contract: AgentEventUsage.api_duration_ms
      needs: [api_duration_ms]
goal: >
  claude 归一化器按 parentKey 桶逐调用计时：message_start 锚定+折叠上一调用、
  message_delta 活刷新、result 折叠残段；pendingUsage 搭车 api_duration_ms 随
  partial flush 实时上报（FR-01）。
implementation:
  - sillyhub-daemon/src/interactive/claude-events.ts PartialBucket 加 callStartMs（可选 number）与 turnApiDurationMs（number，初始 0）
  - _bufferPartial message_start 分支：callStartMs 非空先折叠（+= max(0, now-callStartMs)）再锚 now
  - _bufferPartial message_delta 分支 pendingUsage 组装处加 api_duration_ms = turnApiDurationMs + 活窗口（生成期间实时增长）
  - 归一化器 result/complete 出口折叠残段（防 message_stop 缺失漏计）
  - sillyhub-daemon/tests/interactive/claude-events.test.ts：fixture 流 + vi.useFakeTimers 断言增长与折叠
acceptance:
  - 单调用 12.5s：flush usage.api_duration_ms ≈12500 量级、随 delta 单调增（FR-01 场景）
  - 两调用夹工具：累计=两生成窗口之和（锚间折叠天然排除工具时间）
  - 折叠不出负值（时钟回拨钳 0）
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/interactive/claude-events.test.ts
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 生成窗口口径：分母禁止计入工具执行时间；折叠负值钳 0、无锚不折叠
  - 数据不可得如实不显示：禁止墙钟估速、禁止伪造 0
  - 缺省不带键：usage 无 api_duration_ms 时输出对象禁止出现该键（旧事件零影响）

---
-->
