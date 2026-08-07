---
author: WhaleFall
created_at: 2026-08-07 14:11:27
---

# 任务清单（Tasks）

> 粗粒度，详细 Wave 拆分由 plan 阶段细化。

## Wave 1: daemon 上报 session ready
- task-01: `hub-client.ts` 加 `notifySessionReady`（HTTP POST `/api/daemon/sessions/{id}/ready`，best-effort，复用 `_request POST` 范式）
- task-02: `daemon.ts` `_startInteractiveSession` create 完成（`interactive_session_started` @3303 后）调 `notifySessionReady`
- task-03: `daemon.ts` `restoreAndReconnect`（`markReconnected` 后）调 `notifySessionReady`（recover 路径）
- task-04: `api-types.ts` gen:types 同步新端点类型

## Wave 2: backend 接收 ready + 内存管理
- task-05: `session/service.py` 加 `SessionReadiness`（**模块级单例**或 `app.state`，`mark_ready`/`wait`/`clear`）
- task-06: `router.py` 新端点 POST `/api/daemon/sessions/{id}/ready`（daemon auth，调 `mark_session_ready`，返回 204）
- task-07: `openapi.json` gen:types dump 新端点

## Wave 3: backend inject 等 ready + 生命周期
- task-08: `session/service.py` `inject_session` 发 SESSION_INJECT 前 `await readiness.wait(timeout=30s)`，超时 fallback 仍发 + warn
- task-09: `session/service.py` `end_session`/failed → `readiness.clear`
- task-10: `confirm_session_reconnected`（reconnecting→active 翻转）→ `mark_ready`（recover 主路径双保险）

## Wave 4: 测试
- task-11: daemon 测试 `notifySessionReady`（fresh create + recover 触发 + best-effort 失败 warn）
- task-12: backend 测试 `SessionReadiness`（mark/wait/clear/超时）+ `inject_session` 等 ready（已 ready 直通 / 超时 fallback 发）+ POST /ready 端点（daemon auth）+ recover mark_ready
