---
id: task-08
title: End-to-end verify started_at full chain
title_zh: 端到端验证 started_at 完整链路
author: WhaleFall
created_at: 2026-08-05 10:41:06
priority: P1
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/src/cli.ts
  - frontend/src/components/daemon/machine-card.tsx
provides: []
expects_from: []
goal: >
  端到端验证 started_at 从 daemon cli.ts 入口取时，经 hub-client 上报，backend
  daemon_instances 存储，machines 端点 DaemonMachineRead 返回，到前端 machine-card
  显示的完整链路正确（FR-01/02/03 验收）。
implementation:
  - 启动本地 dev 栈（make dev-up 起 backend + 依赖）并确保 migration upgrade head
  - 启动 daemon（sillyhub-daemon start），记录进程启动时刻 T
  - 调 GET /api/daemon/machines，断言 machines 条目 started_at 非 null 且接近 T（秒级容差）
  - 打开前端 /runtimes，机器头观察 started_at 显示（相对「刚刚/N 分钟前」+ 绝对 tooltip）
  - 重启 daemon，确认 started_at 更新为新启动时刻 T2
  - 验证旧 daemon 兼容（不上报 started_at 时 machines.started_at 为 null，前端显示「—」）
acceptance:
  - 新 daemon 上报后 machines.started_at 非 null 且接近进程启动时刻（秒级容差）
  - 前端机器头显示相对时间（「刚刚/N 分钟前」）+ 绝对时间
  - daemon 重启后 started_at 更新为新进程启动时刻
  - 旧 daemon（不上报）machines.started_at 为 null，前端显示「—」
verify:
  - 人工/集成验证（启动全栈 + 浏览器观察前端 + curl GET /api/daemon/machines）
  - 可选 make backend-test 确保 task-06 测试链路通过
constraints:
  - 本 task 无源码改动（纯验证），若发现问题回到对应 task 修复
  - 端到端需 backend migration upgrade head（daemon_instances.started_at 列存在）
  - 跨平台验证（Windows daemon 也要跑通）
---
