---
author: qinyi
created_at: 2026-08-24 08:05:47
updated_at: 2026-08-24 13:54:36
change: 2026-08-24-sessions-live-updates
---

# 模块影响分析（Module Impact）— 会话列表 SSE 变更信号 + 轮询兜底

> plan 阶段首版；execute/verify 阶段更新；archive 终审（2026-08-24 13:54 确认）。

## 受影响模块

| 模块 | 影响 | 具体文件 | 风险 |
|---|---|---|---|
| backend: daemon/session | 新增埋点（9 写入点发布信号） | session/service.py | 低——只追加 await publish 调用，容错静默不改业务语义 |
| backend: daemon/run_sync | 终态回写分支埋点 | run_sync/service.py | 低——仅 _apply_session_terminal_status 命中分支追加发布 |
| backend: daemon/sweep | 两档巡检埋点（批量逐行发） | sweep.py | 低——常驻协程内追加，publish 自身静默容错 |
| backend: daemon/lease_service | cancel_lease interactive 分支埋点 | lease_service.py | 低 |
| backend: daemon/router | 新增 SSE 端点 /sessions/events；verify 期间修复路由遮蔽（注册前移）+ 路由表级回归测试 | router.py | 中→已修复：初版被 GET /sessions/{session_id} 遮蔽致端点不可达（commit 0c7860f7）；新端点为长连接无 DB 占用，keepalive 防代理超时 |
| backend: daemon（新） | 信号发布基建 | session_events.py（新） | 低 |
| backend: platform_sync | tool_report 插入分支埋点 | platform_sync/service.py | 低 |
| backend: agent | 扫描派发/placement 创建埋点 | agent/service.py、agent/placement.py | 低 |
| frontend: sessions 域 | 订阅客户端 + 门户接线 | lib/daemon.ts、sessions-portal.tsx | 低——fetchSse/refreshSessionLists 均复用既有 |
| docs | 模块文档登记 | modules/frontend.md、modules/backend.md | — |

## 接口影响

- 新增对外端点：GET /api/daemon/sessions/events（text/event-stream，登录鉴权，无 OpenAPI schema 影响——SSE 端点同既有 stream 路由不入 schema）。**已修复**：2026-08-24 verify 真环境冒烟抓出被 GET /sessions/{session_id} 遮蔽的 422 问题（单测 5186 全绿未拦——直调函数绕过路由表、401 探针测不出遮蔽），修复 = 路由注册前移 + 路由表级回归测试（0c7860f7）。
- 新增内部协议：Redis 频道 agent_sessions:changed（backend 内部，无跨仓契约）。
- 前端新增导出：subscribeAgentSessionsEvents（lib/daemon.ts）；RECONNECT_BACKOFF_MS 由函数局部提升为模块导出（零行为变化）。

## 对下游/相邻模块

- sillyhub-daemon：零改动、零感知（事件全在 backend 侧发布）。
- useDaemonMachines（机器旁路）：不受影响（queryKey 非 agentSessions 前缀，独立 15s 轮询维持）。
- 轮询逻辑（sessionListPollInterval）：不动（D-007 兜底保留）。

## 模块影响矩阵（unmapped 无）

> 文件归属按根 _module-map.yaml `paths` 前缀匹配；backend 内部细粒度归属按人工逐文件标注。

| 文件 | 模块归属 | 影响类型 |
|---|---|---|
| backend/app/modules/daemon/session_events.py | backend: daemon（新文件） | 新增 |
| backend/app/modules/daemon/session/service.py | backend: daemon/session | 逻辑变更（埋点） |
| backend/app/modules/daemon/run_sync/service.py | backend: daemon/run_sync | 逻辑变更（埋点） |
| backend/app/modules/daemon/sweep.py | backend: daemon/sweep | 逻辑变更（埋点） |
| backend/app/modules/daemon/lease_service.py | backend: daemon/lease_service | 逻辑变更（埋点） |
| backend/app/modules/daemon/router.py | backend: daemon/router | 接口变更（新增 SSE 端点 + 路由遮蔽修复） |
| backend/app/modules/daemon/tests/test_session_events.py | backend: daemon（新文件） | 新增 |
| backend/app/modules/daemon/tests/test_session_events_cross.py | backend: daemon（新文件） | 新增 |
| backend/app/modules/daemon/tests/test_sessions_events_stream.py | backend: daemon | 新增（路由表级回归） |
| backend/app/modules/platform_sync/service.py | backend: platform_sync | 逻辑变更（埋点） |
| backend/app/modules/agent/service.py | backend: agent | 逻辑变更（埋点） |
| backend/app/modules/agent/placement.py | backend: agent | 逻辑变更（埋点） |
| frontend/src/lib/daemon.ts | frontend | 逻辑变更（新增订阅客户端） |
| frontend/src/components/sessions/sessions-portal.tsx | frontend | 逻辑变更（门户接线） |
| frontend/src/lib/daemon.test.ts | frontend | 新增 |
| frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend | 新增 |
| frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx | frontend | 新增（mock 对齐） |
| .sillyspec/docs/multi-agent-platform/modules/backend.md | docs | 文档变更 |
| .sillyspec/docs/multi-agent-platform/modules/frontend.md | docs | 文档变更 |
| .sillyspec/changes/2026-08-24-sessions-live-updates/verify-result.md | sillyspec | 文档变更（verify 产出） |

## 未匹配文件

无——全部文件均匹配 _module-map.yaml 前缀或 docs 模块。

- backend：daemon 模块测试（session/run_sync/sweep/lease/router 既有用例）+ 新增 3 个测试文件（test_session_events.py / test_session_events_cross.py / test_sessions_events_stream.py 含路由表级回归）。
- frontend：sessions 域测试 + lib/daemon 测试 + 全量 vitest/tsc。
