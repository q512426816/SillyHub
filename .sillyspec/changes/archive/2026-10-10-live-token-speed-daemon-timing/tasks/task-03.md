---
id: task-03
title: codex generation-window timing on item started/completed
title_zh: codex 生成窗口计时
author: qinyi
created_at: 2026-10-10 19:56:43
priority: P0
depends_on: [task-01]
blocks: [task-05]
requirement_ids: [FR-02]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/src/interactive/codex-app-server-driver.ts
  - sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts
target_files:
  - sillyhub-daemon/src/interactive/codex-app-server-driver.ts
  - sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts
expects_from:
  task-01:
    - contract: AgentEventUsage.api_duration_ms
      needs: [api_duration_ms]
goal: >
  codex driver 以 item/started→item/completed（agentMessage|reasoning）为生成
  窗口累计轮内 API 时长，随 usage 事件搭车 api_duration_ms；工具窗口不计入
  （FR-02）。
implementation:
  - sillyhub-daemon/src/interactive/codex-app-server-driver.ts turn 状态加 generatingSince / turnApiDurationMs（:1346 turn/start 重置点同步归零）
  - item/started(agentMessage|reasoning)：空则锚 now（已锚不重锚，同调用多 item 合并窗口）
  - item/completed(agentMessage|reasoning)：非空折叠并清空
  - usage 事件构造点（_extractTokenUsage :1713）搭车 api_duration_ms = 累计 + 活窗口
  - sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts：fixture 通知流（生成→工具 20s→生成）断言工具不计入（FR-02 场景）
acceptance:
  - 两段生成夹 20s 工具：api_duration_ms = 两生成窗口之和
  - 无锚 completed 不折叠；负值钳 0
  - turn 收尾残段折叠
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/interactive/codex-app-server-driver.test.ts
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 生成窗口口径：分母禁止计入工具执行时间；折叠负值钳 0、无锚不折叠
  - 数据不可得如实不显示：禁止墙钟估速、禁止伪造 0
  - 缺省不带键：usage 无 api_duration_ms 时输出对象禁止出现该键（旧事件零影响）

---
-->
