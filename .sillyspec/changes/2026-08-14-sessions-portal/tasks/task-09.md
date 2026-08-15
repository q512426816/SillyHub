---
id: task-09
title: daemon SESSION_SWITCH_CONFIG 消息处理（覆盖 FR-05, D-012@v1）
title_zh: daemon 切换消息处理
author: WhaleFall
created_at: 2026-08-15 09:55:21
priority: P0
depends_on: [task-08]
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-012@v1, D-004@v2]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/daemon-session-switch-config.test.ts
provides: {}
expects_from:
  task-08:
    - contract: SessionSwitchConfigPayload
      needs: [profile, providerConfig, prompt, runId, claimToken]
goal: >
  daemon 接收 SESSION_SWITCH_CONFIG WS 控制消息并路由到 task-08 的热切换 API，实现 idle 立即/running 挂边界的配置切换。
implementation:
  - daemon.ts 按既有 SESSION_INJECT 处理模式（:3290-3337 附近）注册 SESSION_SWITCH_CONFIG handler
  - 校验 sessionId/claimToken 后调 markPendingConfigSwitch（idle 立即 reloadWithConfig 喂 prompt，running 挂边界）
  - Codex 会话只应用 providerConfig（人格不下发）
  - 未识别/校验失败按未知消息忽略并记日志（韧性）
acceptance:
  - idle 收消息立即切换并执行切换轮 prompt
  - running 收消息挂起至 _onResult 边界再切换
  - 消息丢失/校验失败不崩溃
verify:
  - cd sillyhub-daemon && npm test -- --run
constraints:
  - 不重复实现 reload 逻辑（全部委托 task-08 API）
  - WS 消息 schema 与 task-05 下发侧逐字段一致
related_tests: []
---
