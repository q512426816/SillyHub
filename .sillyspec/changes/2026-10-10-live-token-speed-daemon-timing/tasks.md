---
author: brainstorm
created_at: 2026-10-10T19:45:00.000Z
---
# 任务注册表 — 2026-10-10-live-token-speed-daemon-timing

- [ ] task-01: daemon usage 契约——types.ts AgentEventUsage += api_duration_ms + src/agent-event-schema.ts 放行 + claude-events usageToEventUsage 守卫透传 + schema 用例 [target_files: sillyhub-daemon/src/types.ts, sillyhub-daemon/src/agent-event-schema.ts, sillyhub-daemon/src/interactive/claude-events.ts, sillyhub-daemon/tests/interactive/claude-events.test.ts]
- [ ] task-02: claude 桶计时（message_start 锚/折叠 + message_delta 活刷新 + result 折叠残段）+ pendingUsage 搭车 + 单测 (depends_on: task-01) [target_files: sillyhub-daemon/src/interactive/claude-events.ts, sillyhub-daemon/tests/interactive/claude-events.test.ts]
- [ ] task-03: codex 生成窗口计时（item/started→completed agentMessage|reasoning）+ usage 搭车 + 单测（工具窗口排除） (depends_on: task-01) [target_files: sillyhub-daemon/src/interactive/codex-app-server-driver.ts, sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts]
- [ ] task-04: pi message_end 折叠（无内容锚则显式降级留档）+ 单测 (depends_on: task-01) [target_files: sillyhub-daemon/src/interactive/pi-rpc-driver.ts, sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts]
- [ ] task-05: backend 提取 max 累积 + 仅增不减写回 + tokens/summary 增键 + pytest 用例 (depends_on: task-01) [target_files: backend/app/modules/daemon/run_sync/service/submit_steps.py, backend/app/modules/daemon/run_sync/service/submit_commit.py, backend/app/modules/daemon/run_sync/service/publish.py]
- [ ] task-06: 前端 envelope 注释 + onTokens 接线（page/dialog）+ turn-speed 门控放宽 + 测试改写 + vitest/tsc 绿 (depends_on: task-01) [target_files: frontend/src/lib/daemon/session-sse.ts, frontend/src/components/daemon/turn-speed.ts, frontend/src/components/daemon/session-panel/session-panel-page.tsx, frontend/src/components/daemon/session-panel/session-panel-dialog.tsx, frontend/src/components/daemon/__tests__/turn-speed.test.ts, frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx]
