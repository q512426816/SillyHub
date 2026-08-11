---
id: task-11
title: daemon 测试 notifySessionReady
title_zh: daemon 上报 ready 的单测
author: WhaleFall
created_at: 2026-08-07 14:32:00
priority: P1
depends_on: [task-01, task-02, task-03]
blocks: []
requirement_ids: [FR-05]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts
expects_from: {}
goal: >
  用单测验证 daemon 在 fresh create 与 recover 完成时正确上报 ready，且 best-effort
  上报失败不阻塞主循环。
implementation:
  - 参照 daemon-recovery-boot.test.ts 与 daemon-session-lifecycle-wiring.test.ts 的 mock 范式，注入鸭子类型 mock hubClient（含 notifySessionReady mock fn）加 mock SessionManager，全 mock 不连真实 backend
  - fresh create 路径模拟 _startInteractiveSession 走到 interactive_session_started 完成点（mock SessionManager create 成功），断言 hubClient.notifySessionReady 被调一次且 sessionId 正确
  - recover 路径参照 daemon-recovery-boot，persistence load 返回一条记录加 recoveryClient recoverSession 返回 reconnecting 加 mock SessionManager markReconnected 完成，断言 hubClient.notifySessionReady 被调一次
  - best-effort 让 mock notifySessionReady reject 或 throw，断言不向上抛（daemon start 与 lease 处理仍 resolve），只 warn
  - 失败路径 mock SessionManager create 抛错或 restoreAndReconnect 失败，断言 notifySessionReady 不被调（失败不上报）
acceptance:
  - fresh create 上报断言通过（notifySessionReady 调用一次加 sessionId 匹配）
  - recover 上报断言通过（markReconnected 后触发上报）
  - best-effort 失败仅 warn 不抛（daemon 主流程不受影响）
  - 失败路径不上报断言通过
  - 全部测试通过（vitest 绿）
verify:
  - cd sillyhub-daemon && pnpm test
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 复用现有 daemon 测试 mock 范式（鸭子类型 hubClient 加 SessionManager 注入）
  - mock hubClient 不连真实 backend（不发 HTTP 或 WS）
  - 不改被测源码（daemon.ts 或 hub-client.ts 或 session-manager.ts）
  - 跨平台（mock driver start，不依赖真实 claude 可执行文件 spawn）
  - 文件命名 tests interactive daemon-notify-session-ready.test.ts，与现有 daemon-recovery-boot 同目录同范式
---
