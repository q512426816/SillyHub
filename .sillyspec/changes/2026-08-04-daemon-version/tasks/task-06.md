---
id: task-06
title: daemon 上报冒烟测试（gen 重构后断言 BUILD_ID 非空 + register/heartbeat 不变）
title_zh: daemon 上报冒烟测试（gen 重构后断言 BUILD_ID 非空且非默认占位 + register/heartbeat body 构造不变）
author: WhaleFall
created_at: 2026-08-04 11:14:15
priority: P1
depends_on:
  - task-01
  - task-03
  - task-04
blocks:
  - task-10
requirement_ids:
  - FR-02
decision_ids: []
allowed_paths:
  - sillyhub-daemon/tests/
---

> task-06：用 vitest 冒烟测试守卫 gen 重构后的 daemon 上报契约。覆盖 FR-02。

## implementation
- 新增 sillyhub-daemon/tests/ 下冒烟测试，校验 build 产物里 BUILD_ID 注入结果与 register/heartbeat body 构造行为。
- 断言 BUILD_ID 非空且非默认占位（如 `4c238ebe-20260729112052` / `unknown` / 空串），反映 task-01 gen 注入真实生效。
- 断言 hub-client.register 构造的 RegisterBody 仍带 daemon_version=DAEMON_VERSION、daemon_build_id=BUILD_ID（hub-client.ts:337-338 行为不变）。
- 断言 hub-client.heartbeat 构造的 HeartbeatBody 仍带 daemon_version、daemon_build_id（hub-client.ts:365 行为不变）。
- 通过 mock _request 捕获真实下发 body，避免真实网络。

## 验收标准
- pnpm build 后运行测试，BUILD_ID 既非空也非占位。
- register/heartbeat 调用捕获到的 body 含 daemon_version、daemon_build_id，值与当前 DAEMON_VERSION/BUILD_ID 一致。
- gen 重构（task-01/03/04）未破坏上报契约。

## verify
- pnpm --filter sillyhub-daemon test 走 vitest 全绿。
- pnpm --filter sillyhub-daemon build 后再跑一次（确认注入值落到产物）。

## constraints
- 不修改 hub-client.ts 上报字段，只加测试守卫。
- 不连真实 hub，全部 mock。
- 不手改 BUILD_ID 常量绕过断言。
