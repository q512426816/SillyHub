---
id: task-08
title: "日志增量游标"
title_zh: "后端 GET logs 加 after 游标（取更新日志）+ 前端 WorkerLogPanel 增量合并去重 fallback"
author: qinyi
created_at: 2026-08-15 07:00:00
priority: P1
depends_on: []
blocks: [task-10]
requirement_ids: [FR-10]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/agent/router.py
  - backend/app/modules/agent/service.py
  - backend/app/modules/agent/tests/test_router.py
  - frontend/src/lib/agent.ts
  - frontend/src/lib/__tests__/agent.test.ts
  - frontend/src/components/mission-console.tsx
  - frontend/src/components/__tests__/mission-console.test.tsx
goal: >
  mission 控制台日志轮询从每次全量拉取改增量——后端 GET logs（agent/router.py:453-474）加可选 after 查询参数，service 层 get_run_logs（agent/service.py:952）加游标过滤；前端 WorkerLogPanel 轮询传上一批最早一条的 timestamp，按 id 去重合并，游标空结果 fallback 全量重拉一次。
implementation:
  - agent/router.py 的 get_agent_run_logs 加可选 after 查询参数（ISO timestamp 字符串，None 兼容现状全量），透传 get_run_logs
  - agent/service.py 的 get_run_logs 加游标分支——语义为取比游标更新的日志，SQL 过滤条件是 timestamp 严格大于 after；after 取前端已见最早一条的 timestamp（desc 排序下界），返回 (after, now] 增量再按 desc 排
  - 后端沿用现有 5000 条上限不动；纯查询参数与 WHERE，不动 schema 不违 NFR-04
  - frontend/src/lib/agent.ts 核对 getAgentRunLogs 的 after 参数类型（:115 已有 after 可选参数，核对类型与编码正确即可，不重复造轮子）
  - mission-console.tsx 的 WorkerLogPanel（:194 起）轮询逻辑——后续轮询传当前已见日志最早一条的 timestamp 作 after；返回结果按 id 与已有日志去重合并（同 timestamp 边界重复由前端吸收，R-06）；返回空结果时 fallback 全量重拉一次后继续增量
  - 后端单测——无 after 全量等价、有 after 只返回 timestamp 更新的条目、边界（恰好等于 after 的不返回）；前端 vitest——增量合并、id 去重、空结果 fallback
acceptance:
  - 带 after 的请求只返回比 after 更新的日志条目，等于 after 时刻的条目不返回
  - 不带 after 行为与现状逐字节等价（既有测试锚点不动）
  - 前端增量合并后日志集合与全量拉取结果一致（无丢失无重复 id）
  - 游标空结果时前端 fallback 全量重拉，之后恢复增量轮询
  - 后端单条响应仍受 5000 条上限约束
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_router.py -q --no-cov
  - cd frontend && pnpm vitest run src/lib/__tests__/agent.test.ts src/components/__tests__/mission-console.test.tsx
constraints:
  - after 语义必须是取更新日志——过滤条件为 timestamp 严格大于 after；初版写成小于等于是方向反了（plan 审查已修正一次，勿再回退）
  - 不动 DB schema、不加迁移、不加新依赖（NFR-04）
  - 行为零变更兜底——不带 after 的调用路径逐字节等价现状
  - 与 backend W1-W3 各 task 文件不重叠（W4 并行安全）
related_tests:
  - path: backend/app/modules/agent/tests/test_router.py
    reason: logs 端点既有用例作无 after 等价锚点，新增游标行为用例落点
  - path: frontend/src/components/__tests__/mission-console.test.tsx
    reason: WorkerLogPanel 增量合并/去重/fallback 的 vitest 用例落点
---
