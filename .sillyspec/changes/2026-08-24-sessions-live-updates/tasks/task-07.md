---
author: qinyi
created_at: 2026-08-24 07:58:12
id: task-07
title: 全量回归 + 模块文档同步 + 集成冒烟清单
title_zh: 全量回归 + 模块文档同步 + 集成冒烟清单
goal: 三仓全量回归绿；模块文档登记本变更；产出真浏览器集成冒烟结论。
depends_on: [task-02, task-03, task-04, task-06]
provides:
  - contract: regression-green
    fields:
      - backend pytest 全量绿 / frontend vitest+tsc+lint 绿 / 模块文档已登记 / 集成冒烟结论
expects_from:
  - task-02
  - contract: session-service-events
    fields:
      - SessionService 写入路径已发布信号
  - task-03
  - contract: cross-module-events
    fields:
      - 跨模块写入路径已发布信号
  - task-04
  - contract: sessions-events-endpoint
    fields:
      - GET /api/daemon/sessions/events 流式下发本人信号
  - task-06
  - contract: portal-wiring
    fields:
      - 门户信号接线完成
allowed_paths:
  - .sillyspec/docs/multi-agent-platform/modules/frontend.md
  - .sillyspec/docs/multi-agent-platform/modules/backend.md
  - .sillyspec/changes/2026-08-24-sessions-live-updates/verify-result.md
implementation:
  - 回归：cd backend && uv run pytest -q（全量）；pnpm -C frontend exec vitest run（全量）+ pnpm -C frontend run typecheck + eslint 改动文件
  - 对照 plan「全局验收标准」逐项核验，结论写 verify-result.md（PASS/FAIL+证据）
  - 模块文档：frontend.md 与 backend.md 变更索引各登记一条（含事件通道端点/埋点清单引用 design §3）
  - 集成冒烟（本地 dev 环境可起则做，起不了则在 verify-result.md 记「待用户环境验证」清单）：①打开 /sessions 页 → 另开终端触发一次 CLI 上报/创建会话 → 左栏秒级出现；②kill 一个活跃会话 → 状态点秒级变化；③停 Redis → 列表仍按轮询刷新（兜底）
acceptance:
  - backend/frontend 全量绿（数字记录进 verify-result.md）
  - 模块文档两处登记完成
  - 集成冒烟三项结论（或明确的待验证清单）
verify:
  - uv run pytest -q；pnpm -C frontend exec vitest run；pnpm -C frontend run typecheck
constraints:
  - 不修与本变更无关的存量测试债（发现即记录，不顺手改）
  - verify-result.md 为执行态文件，FAIL 项如实记录不粉饰

---
