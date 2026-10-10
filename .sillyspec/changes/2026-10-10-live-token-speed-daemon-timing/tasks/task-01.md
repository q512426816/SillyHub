---
id: task-01
title: daemon usage contract extension (types + schema + passthrough)
title_zh: daemon usage 契约扩展（类型+schema+透传）
author: qinyi
created_at: 2026-10-10 19:56:43
priority: P0
depends_on: []
blocks: [task-02, task-03, task-04, task-05, task-06]
requirement_ids: [FR-04]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/src/types.ts
  - sillyhub-daemon/src/agent-event-schema.ts
  - sillyhub-daemon/src/interactive/claude-events.ts
  - sillyhub-daemon/tests/interactive/claude-events.test.ts
target_files:
  - sillyhub-daemon/src/types.ts
  - sillyhub-daemon/src/agent-event-schema.ts
  - sillyhub-daemon/src/interactive/claude-events.ts
  - sillyhub-daemon/tests/interactive/claude-events.test.ts
provides:
  - contract: AgentEventUsage.api_duration_ms
    fields: [api_duration_ms]
goal: >
  扩展 daemon usage 事件契约：AgentEventUsage 增可选 api_duration_ms（轮内累计
  ms），zod schema 同步放行，claude-events usageToEventUsage 守卫透传——为三
  引擎计时提供统一携带面（FR-04）。
implementation:
  - sillyhub-daemon/src/types.ts:88 AgentEventUsage 增 api_duration_ms?: number（注释：轮内累计生成时长 ms，各引擎计时生产，缺省=未计时）
  - sillyhub-daemon/src/agent-event-schema.ts usage 对象 schema 增同名字段（optional）
  - sillyhub-daemon/src/interactive/claude-events.ts:1285 usageToEventUsage 守卫透传（numOf 命中才带键）
  - sillyhub-daemon/tests/interactive/claude-events.test.ts 增用例：带键透传/无键不带/非法值忽略
acceptance:
  - usage 含合法 api_duration_ms → usageToEventUsage 输出带同值键
  - usage 无该键 → 输出对象无该键（FR-04 场景：旧事件零影响）
  - schema safeParse 对带键/不带键 usage 均通过
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/interactive/claude-events.test.ts
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 生成窗口口径：分母禁止计入工具执行时间；折叠负值钳 0、无锚不折叠
  - 数据不可得如实不显示：禁止墙钟估速、禁止伪造 0
  - 缺省不带键：usage 无 api_duration_ms 时输出对象禁止出现该键（旧事件零影响）

---
-->
