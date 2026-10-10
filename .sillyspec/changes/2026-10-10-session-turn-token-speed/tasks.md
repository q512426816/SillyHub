---
author: flow-machine-draft
created_at: 2026-10-10T10:35:27.990Z
---
# 任务注册表（Tasks）— 2026-10-10-session-turn-token-speed

- [x] task-01: close_run_steps.py turn_completed payload 增加 `"duration_api_ms": agent_run.duration_api_ms`；扩展 test_interactive_lifecycle_patch.py turn_completed 用例断言该键（有值/null 两态），跑该文件 pytest 绿
- [x] task-02: session_insights.py SessionRunRead 增加 `duration_api_ms: int | None`（from_attributes 直映）；test_session_runs_endpoint.py 补断言；pnpm gen:types 同步 api-types.ts + backend/openapi.json，前端 `pnpm exec tsc --version` 先验 node_modules 健康
- [x] task-03: 新建 frontend/src/components/daemon/turn-speed.ts（formatTokensPerSecond + turnTokenSpeedText 纯函数）+ __tests__/turn-speed.test.ts（≥10 取整/<10 一位小数/负值钳 0/非终态与缺数据返回 null），vitest 绿
- [x] task-04: session-sse.ts envelope 加 duration_api_ms；turn-timeline.tsx SessionTurnView 加 apiDurationMs?；turn-state.ts upsertTurn 新建分支初始化该字段；page/dialog onTurnCompleted 与占位轮构造写入；page-helpers.tsx enrichDisplayTurns 补缺 + changed 守卫；session-stream.ts dispatchRunSynth 透传；turn-timeline.tsx 两处轮尾（RoundDivider meta / TurnStatusBadge）渲染速度段
- [x] task-05: 前端相关测试全绿（turn-speed.test.ts + turn-state-subagent-routing.test.ts + daemon-session-stream-sync.test.ts 回归）+ tsc 编译门通过
