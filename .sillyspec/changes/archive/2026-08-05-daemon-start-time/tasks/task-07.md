---
id: task-07
title: pnpm gen:types + machine-card.tsx 显示 started_at
title_zh: 刷新前端类型并在机器头显示进程启动时间
author: WhaleFall
created_at: 2026-08-05 10:41:06
priority: P0
depends_on: [task-04]
blocks: []
requirement_ids: [FR-03]
decision_ids: []
allowed_paths:
  - frontend/src/lib/api-types.ts
  - frontend/src/components/daemon/machine-card.tsx
  - backend/openapi.json
provides: []
expects_from:
  task-04:
    contract: DaemonMachineRead
    needs: [started_at]
goal: >
  后端 DaemonMachineRead.started_at 定型后跑 pnpm gen:types 刷新前端类型，
  机器头新增进程启动时间展示（非 null 复用 formatRelativeTime 相对时间 + 绝对 tooltip，
  旧 daemon null 显示「—」），完成 FR-03。
implementation:
  - gen:types 前确认前端 node_modules 健康（pnpm exec tsc --version 能跑、.bin 有 shim），半坏会报假 CSSProperties/缺模块错误需 pnpm install --force 修（CLAUDE.md 规则 20）
  - cd frontend && pnpm gen:types 刷新 frontend/src/lib/api-types.ts 与 backend/openapi.json
  - machine-card.tsx 机器头 meta 区（:169 附近 last_heartbeat_at 行旁）加 started_at 展示，非 null 时复用 formatRelativeTime 做相对时间，外层 span 加 title 显示绝对时间（new Date(iso).toLocaleString 风格）
  - started_at 为 null 时单独显示「—」或隐藏整行，不复用 formatRelativeTime（其 null 默认返「无心跳」语义不符）
  - gen:types 暴露旧 mock 缺 started_at 字段则顺手补（规则 20 惯例，不为躲报错改回手写）
acceptance:
  - api-types.ts 含 DaemonMachineRead.started_at 字段定义
  - backend/openapi.json schema 反映 DaemonMachineRead.started_at
  - machine-card.tsx 机器头展示 started_at（非 null 相对时间 + 绝对 tooltip，null 显「—」）
  - gen:types:check 干净无类型漂移（git diff --exit-code 退出码 0）
  - pnpm build 与 pnpm exec tsc --noEmit 均通过
verify:
  - cd frontend && pnpm gen:types && pnpm run gen:types:check
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm build
constraints:
  - gen:types 前必须确认 node_modules 健康（CLAUDE.md 规则 20），半坏导致假报错误判
  - started_at 为 null（旧 daemon）时显「—」，不能复用 formatRelativeTime 的「无心跳」默认文案
  - 复用既有 formatRelativeTime（runtime-card-helpers），非 null 时用，不重造轮子
  - gen:types 暴露的无关旧 mock 测试债顺手补字段（规则 20 惯例）
  - 仅机器级展示，不改 DaemonRuntimeRead 相关前端（runtime 级不展示，§3 YAGNI）
  - 不改端点路径 / response_model 结构（仅加字段）
---
