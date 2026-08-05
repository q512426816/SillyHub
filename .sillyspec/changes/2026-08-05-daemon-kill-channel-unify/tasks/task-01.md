---
id: task-01
title: Claude close 契约 + session-manager _terminateSession（覆盖 FR-01/FR-02/FR-06, D-001@v2/D-003/D-004）
title_zh: Claude 关闭契约与会话终止收敛
author: qinyi
created_at: 2026-08-05 19:24:02
priority: P0
depends_on: []
blocks: [task-02, task-03, task-15]
requirement_ids: [FR-01, FR-02, FR-06]
decision_ids: [D-001@v2, D-003, D-004]
allowed_paths:
  - sillyhub-daemon/src/interactive/claude-sdk-driver.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
provides:
  - contract: ClaudeDriverHandle.close
    fields: [close]
  - contract: SessionManager._terminateSession
    fields: [_terminateSession]
goal: >
  让 Claude/Codex interactive 的 end/fail 经 _terminateSession 主动调 driverHandle.close（Claude=query.close），接通 SDK SIGTERM 到 SIGKILL 的 kill 链，止血 P0 卡死 turn 僵尸。
implementation:
  - claude-sdk-driver.ts 给 ClaudeDriverHandle 新增 close 方法内部调 query.close
  - session-manager.ts 新增私有 _terminateSession 统一 driverHandle.close 加 inputQueue.close 加 abort resolver 加清 partial buffer 加设 status
  - end 和 fail 改为调 _terminateSession，interrupt 保持只调 q.interrupt 不动（守 D-001@v2 打断本轮按钮软）
  - close 调用包 try catch 不阻塞 end 流程（R-01）
acceptance:
  - ClaudeDriverHandle.close 存在且调 query.close
  - session-manager 的 end 和 fail 触发 driverHandle.close，interrupt 不触发
  - 关闭异常被 catch 不抛出
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
  - cd sillyhub-daemon && pnpm exec vitest run src/interactive/session-manager src/interactive/claude-sdk-driver
constraints:
  - interrupt 路径不动（守 D-001@v2 打断本轮按钮保持软）
  - 不自己 taskkill 全靠 SDK close（守 D-004）
  - brownfield close 是可选契约其他 driver 不实现不报错
---
