---
author: qinyi
created_at: 2026-08-24 08:05:47
change: 2026-08-24-sessions-live-updates
---

# 模块影响分析（module-impact）

> plan 阶段首版；execute/verify 阶段更新；archive 终审。

## 受影响模块

| 模块 | 影响 | 具体文件 | 风险 |
|---|---|---|---|
| backend: daemon/session | 新增埋点（9 写入点发布信号） | session/service.py | 低——只追加 await publish 调用，容错静默不改业务语义 |
| backend: daemon/run_sync | 终态回写分支埋点 | run_sync/service.py | 低——仅 _apply_session_terminal_status 命中分支追加发布 |
| backend: daemon/sweep | 两档巡检埋点（批量逐行发） | sweep.py | 低——常驻协程内追加，publish 自身静默容错 |
| backend: daemon/lease_service | cancel_lease interactive 分支埋点 | lease_service.py | 低 |
| backend: daemon/router | 新增 SSE 端点 /sessions/events | router.py | 中——新长连接端点；无 DB 占用；keepalive 防代理超时 |
| backend: daemon（新） | 信号发布基建 | session_events.py（新） | 低 |
| backend: platform_sync | tool_report 插入分支埋点 | platform_sync/service.py | 低 |
| backend: agent | 扫描派发/placement 创建埋点 | agent/service.py、agent/placement.py | 低 |
| frontend: sessions 域 | 订阅客户端 + 门户接线 | lib/daemon.ts、sessions-portal.tsx | 低——fetchSse/refreshSessionLists 均复用既有 |
| docs | 模块文档登记 | modules/frontend.md、modules/backend.md | — |

## 接口影响

- 新增对外端点：GET /api/daemon/sessions/events（text/event-stream，登录鉴权，无 OpenAPI schema 影响——SSE 端点同既有 stream 路由不入 schema）。
- 新增内部协议：Redis 频道 agent_sessions:changed（backend 内部，无跨仓契约）。
- 前端新增导出：subscribeAgentSessionsEvents（lib/daemon.ts）；RECONNECT_BACKOFF_MS 由函数局部提升为模块导出（零行为变化）。

## 对下游/相邻模块

- sillyhub-daemon：零改动、零感知（事件全在 backend 侧发布）。
- useDaemonMachines（机器旁路）：不受影响（queryKey 非 agentSessions 前缀，独立 15s 轮询维持）。
- 轮询逻辑（sessionListPollInterval）：不动（D-007 兜底保留）。

## 回归面

- backend：daemon 模块测试（session/run_sync/sweep/lease/router 既有用例）+ 新增 3 个测试文件。
- frontend：sessions 域测试 + lib/daemon 测试 + 全量 vitest/tsc。
