---
author: flow-machine-draft
created_at: 2026-11-02T02:07:22.613Z
---
# 任务注册表（Tasks）— 2026-11-02-daemon-resume-gate-fix

- [x] task-01: FR-01 测试先行——daemon-session-resume-route.test.ts 增两用例：①本地 sessions.json 有该会话记录时 resume 保留持久化 lastActiveAt（断言 restoreAndReconnect 收到的 record.lastActiveAt === 记录原值而非当下）；②无本地记录且 payload 未带 last_active_at 时回落 Date.now()（跑绿前应红）
- [x] task-02: FR-01 实现——daemon.ts `_routeSessionResume` lastActiveAt 三级取值（payload 显式 → persistence.load() 按 sessionId 查找原值 → Date.now() 兜底）；types.ts SessionState 增 restoredAt（仅内存态）；persistence.ts restoreAndReconnect 写 restoredAt；lifecycle.ts scanIdle 空闲时长 max(lastActiveAt, restoredAt ?? 0) 起算（验证：task-01 两用例转绿）
- [ ] task-03: FR-02 测试先行——daemon-session-switch-config.test.ts 增两用例：①store 无目标会话且 payload 带 run_id/lease_id/claim_token 时 notifyRunResult(status=error_during_execution) 被调一次；②payload 缺 lease_id 时维持仅 warn 不回报（跑绿前应红）
- [ ] task-04: FR-02 实现——daemon.ts `_routeSessionSwitchConfig` not_found 与 markPendingConfigSwitch 异常两分支对齐 _reportInjectDropped 回报（新增 _reportSwitchDropped 辅助）；backend control.py 切换分支 payload 增 leaseId 键（验证：task-03 两用例转绿 + backend 触达面 pytest 无回归）
- [ ] task-05: 回归验证——sillyhub-daemon `pnpm vitest run` 全量 + `tsc --noEmit` 零错误；backend 触达面 pytest（daemon session/control 相关）；ruff 零告警
