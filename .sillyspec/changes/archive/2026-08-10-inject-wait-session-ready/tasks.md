---
author: WhaleFall
created_at: 2026-08-07 14:11:27
---

# 任务清单（Tasks）

> 粗粒度，详细 Wave 拆分见 plan.md。Wave 划分原则：同源文件的 task 必须不同 Wave（execute 同 Wave 强制并行，同文件会互相覆盖）；同 Wave 内无相互依赖；被依赖者在更早 Wave。

## Wave 1: 基石
- task-01: `hub-client.ts` 加 `notifySessionReady`（HTTP POST session/ready，best-effort，复用 `_request POST` 范式）
- task-05: `session/service.py` 加 `SessionReadiness`（**模块级单例**，`mark_ready`/`wait`/`clear`）

## Wave 2: fresh 上报 + 端点 + inject 等待
- task-02: `daemon.ts` `_startInteractiveSession` create 完成（`interactive_session_started` @3303 后）调 `notifySessionReady`
- task-06: `router.py` 新端点 POST `/api/daemon/sessions/{id}/ready`（daemon auth，调 `mark_session_ready`，返回 204）
- task-08: `inject_session` 发 SESSION_INJECT 前 `await readiness.wait(timeout=30s)`，超时 fallback 仍发 + warn

## Wave 3: recover 上报 + 清理 + openapi dump
- task-03: `daemon.ts` `restoreAndReconnect`（`markReconnected` 后）调 `notifySessionReady`（recover 路径）
- task-09: `session/service.py` `end_session`/failed（`_converge_failed_dispatch`/`mark_session_recovery_failed`）→ `readiness.clear`
- task-07: `openapi.json` gen:types dump 新端点

## Wave 4: recover 双保险 + daemon 类型同步 + daemon 测试
- task-10: `confirm_session_reconnected`（reconnecting→active 翻转）→ `mark_ready`（recover 主路径双保险）
- task-04: `api-types.ts` gen:types 同步新端点类型（task-07 dump 之后）
- task-11: daemon 测试 `notifySessionReady`（fresh create + recover 触发 + best-effort 失败 warn）

## Wave 5: backend 测试
- task-12: backend 测试 `SessionReadiness`（mark/wait/clear/超时）+ `inject_session` 等 ready（已 ready 直通 / 超时 fallback 发）+ POST /ready 端点（daemon auth）+ recover mark_ready
