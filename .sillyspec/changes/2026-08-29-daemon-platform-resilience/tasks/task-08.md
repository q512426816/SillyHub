---
id: task-08
title: 'daemon-graceful-stop-suspend-and-recovery-robustness'
title_zh: 'daemon 优雅停止挂起+恢复健壮性（suspend-batch 接入/网络失败保留重试/claimToken 空窗入箱）'
author: 'qinyi'
created_at: 2026-08-29 03:07:34
priority: P0
depends_on: [task-05, task-07]
blocks: [task-11]
requirement_ids: [FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/tests/interactive/session-recovery.test.ts
  - sillyhub-daemon/tests/interactive/daemon-recovery-boot.test.ts
  - sillyhub-daemon/tests/daemon-stop-suspend.test.ts
goal: >
  daemon 优雅停止前主动挂起全部 active 会话、recover 网络类失败保留本地记录退避重试、claimToken 空窗消息入 outbox 暂存重放，落实 D-001 任意时长重启后会话自动恢复可继续对话。
expects_from:
  task-05:
    - contract: SuspendBatchResponse
      needs: [suspended, runs_failed]
  task-07:
    - contract: OutboxTerminalKinds
      needs: [kind, pending_token]
implementation:
  - hub-client.ts 新增 suspendSessions（POST 到 /api/daemon/sessions/suspend-batch、body 按 daemon_local_id 上报、返回 suspended 与 runs_failed 计数，风格对齐既有 markOffline）；daemon.ts stop() 在 _markRegisteredRuntimesOffline 之前调用，失败仅结构化日志降级不阻断收尾（与强杀等价走 600s offline sweep 收敛 suspended）
  - _recoverOneSession 区分失败类型——HTTP 网络类失败（请求未达/超时/5xx）保留 sessions.json 记录并按退避重试（30s 起步指数翻倍封顶 5min），WS onConnected 时存在遗留记录立即重试一轮，记录超龄 7 天清理；仅业务终态（ended/failed/rejected）与 restore 失败维持现状删记录
  - onTurnResult 与 onTurnMessage 遇 claimToken 空窗（no_claim_token）不再丢弃——消息入 outbox 暂存并打 pending_token 标记，下一次 SESSION_INJECT 刷新 token 后 drainOutbox 重放，重放仍 422 走 task-07 的对账刷新
  - 新增 tests/daemon-stop-suspend.test.ts 覆盖停止挂起、网络失败保留重试、空窗入箱重放三场景；既有 session-recovery 与 daemon-recovery-boot 两测试补对应断言
acceptance:
  - 优雅停止后该 daemon 全部 active 会话平台侧变 suspended、中断 run 标 failed（daemon_stopped）、挂起 lease cancelled；suspend-batch 调用失败仅日志降级且 stop 流程完整走完
  - daemon 启动遇 backend 网络类失败时本地记录保留不删、退避重试 30s 起步封顶 5min，backend 恢复（或 WS onConnected）后重试成功走完 reconnecting 到 active；仅 ended/failed/rejected 业务终态删记录；超龄 7 天记录被清理
  - claimToken 空窗期产生的 onTurnResult/onTurnMessage 消息入 outbox（pending_token 标记）不丢弃，SESSION_INJECT 刷新 token 后重放上报成功；重放仍 422 触发对账
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/daemon-stop-suspend.test.ts tests/interactive/session-recovery.test.ts tests/interactive/daemon-recovery-boot.test.ts && pnpm exec tsc --noEmit
constraints:
  - 只消费不改动 task-05 定稿的 suspend-batch 与 recover 端点语义，不碰 backend 代码
  - 不动 ws-client 重连与 control-dispatcher（task-06 范围），onConnected 仅挂恢复重试钩子；遗留待恢复记录设数量上限与超龄清理（R6）防 sessions.json 无限堆积
  - 不改 PersistedSessionRecord 既有字段语义（新增标记走可选字段，旧 sessions.json 兼容加载）；仅跑本 task 相关测试，全量回归留 CI（CLAUDE.md 规则 0）
---
