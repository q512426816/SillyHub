---
author: qinyi
created_at: 2026-08-24 07:24:36
change: 2026-08-24-sessions-live-updates
---

# 任务（Tasks）

> 任务名唯一真相在本文件；实现细节见 tasks/task-NN.md 卡片；Wave 分组见 plan.md。

- [ ] task-01: 后端信号基建——session_events.py（频道常量+publish_sessions_changed 静默容错）+ 发布辅助单测
- [ ] task-02: SessionService 埋点（8 写入点，对照 design §3 生命周期契约表）+ 埋点断言测试 (depends_on: task-01)
- [ ] task-03: 跨模块埋点（run_sync/sweep/lease_service/platform_sync/agent service/agent placement）+ 独立测试文件断言 (depends_on: task-01)
- [ ] task-04: SSE 端点 GET /api/daemon/sessions/events（订阅+user 过滤+30s keepalive+清理）+ 端点测试 (depends_on: task-01)
- [ ] task-05: 前端订阅客户端 subscribeAgentSessionsEvents（fetchSse 传输+自实现退避重连）
- [ ] task-06: 会话门户接线——信号/重连 → invalidate ["agentSessions"] 前缀；卸载关闭 (depends_on: task-05)
- [ ] task-07: 全量回归（backend pytest + frontend vitest/tsc/lint）+ 模块文档同步 + 集成冒烟清单 (depends_on: task-02,03,04,06)
