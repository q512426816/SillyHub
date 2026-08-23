---
author: qinyi
created_at: 2026-08-24 07:24:36
change: 2026-08-24-sessions-live-updates
---

# 任务（Tasks）

> brainstorm 阶段产出；实现拆解以 `sillyspec run plan` 产出的 plan.md 为准
>（Wave/依赖在 plan 阶段细化）。

## Wave 1：后端信号与端点

- [ ] task-1 新建 `app/modules/daemon/session_events.py`：频道常量
      `agent_sessions:changed` + `publish_sessions_changed()`（静默容错）
- [ ] task-2 埋点：SessionService 全量（created/status_changed/deleted，
      对照 design §3 生命周期契约表逐行落）
- [ ] task-3 埋点：run_sync close_interactive_run / lease_service cancel_lease /
      sweep 两档 / platform_sync tool_report 插入分支 / agent 扫描与 placement
- [ ] task-4 新 SSE 端点 `GET /api/daemon/sessions/events`（订阅+user 过滤+
      keepalive+清理）
- [ ] task-5 后端测试：发布点单测（mock redis publish 断言事件/字段/user_id）+
      SSE 端点测试（用户隔离/keepalive/断开清理）

## Wave 2：前端订阅接线

- [ ] task-6 `lib/daemon.ts` 加 `subscribeAgentSessionsEvents`（fetchSse +
      退避重连 + onReconnected）
- [ ] task-7 `sessions-portal.tsx` 接线（信号/重连 → invalidate 前缀；卸载关闭）
- [ ] task-8 前端测试：信号→失效重拉、重连补失效、卸载关闭

## Wave 3：回归与文档

- [ ] task-9 backend pytest 全量 + frontend vitest 全量 + tsc + lint
- [ ] task-10 模块文档同步（backend.md / frontend.md 变更索引）+ 手工验收
      （真浏览器：CLI 上报新会话秒级出现、远端结束秒级变灰）
