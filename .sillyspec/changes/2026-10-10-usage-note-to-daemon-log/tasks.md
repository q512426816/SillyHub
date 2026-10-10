---
author: flow-machine-draft
created_at: 2026-10-10T02:08:40.013Z
---
# 任务注册表（Tasks）— 2026-10-10-usage-note-to-daemon-log

- [x] task-01: 改写 daemon-usage-note.test.ts 为两态断言（hasLive=true → 无 [USAGE_NOTE] 消息流行 + console.info 收到 run_cost_may_include_bg_tasks 含 session_id/run_id/cost_delta_usd；hasLive=false → 无行无日志；total_cost_usd 缺失 → cost_delta_usd=null 且 notifyRunResult 照常）——跑 `cd sillyhub-daemon && pnpm vitest run tests/interactive/daemon-usage-note.test.ts` 确认新断言红（旧实现下失败）
- [x] task-02: 改 daemon.ts onTurnResult——删 [USAGE_NOTE] 发射块（含 usage_note_line_failed catch），在 payload.total_cost_usd 差分组装后加 info 日志 run_cost_may_include_bg_tasks（cost_delta_usd 取 payload 值、缺省 null）——跑 task-01 同命令转绿
- [x] task-03: 相关面回归 + 类型门——`cd sillyhub-daemon && pnpm vitest run tests/interactive/daemon-usage-note.test.ts tests/interactive/daemon-interactive-bridge.test.ts` 全绿 + `pnpm typecheck` 0 错
- [x] task-04: 同步模块文档 `.sillyspec/docs/SillyHub/modules/daemon.md` 的 FR-04 表述（消息流标注行 → daemon 日志事件）——grep USAGE_NOTE 确认文档无残留旧表述
