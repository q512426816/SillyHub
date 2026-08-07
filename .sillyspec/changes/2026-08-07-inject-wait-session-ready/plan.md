---
plan_level: full
author: WhaleFall
created_at: 2026-08-07 14:15:00
---

# 实现计划（Plan）：backend inject 等 daemon session ready

## Wave 概览
- **Wave 1**: daemon 上报 session ready（独立，无依赖）
- **Wave 2**: backend 接收 ready + SessionReadiness（独立，与 Wave 1 并行）
- **Wave 3**: backend inject 等 ready + 生命周期清理（依赖 Wave 2）
- **Wave 4**: 测试（依赖 Wave 1-3）

## Wave 1: daemon 上报 session ready
**依赖**：无
**目标**：daemon create 完成（fresh + recover）上报 backend

- [ ] task-01: hub-client.ts 加 notifySessionReady
  - 文件: sillyhub-daemon/src/hub-client.ts
  - 改动: 加 `notifySessionReady(sessionId)`（HTTP POST `/api/daemon/sessions/{id}/ready`，best-effort 复用 `_request POST` 范式 @680-759，失败 warn 不抛）
  - 完成标准: 方法存在 + best-effort（失败不抛）+ daemon 单测
- [ ] task-02: daemon.ts `_startInteractiveSession` create 完成调 notifySessionReady
  - 文件: sillyhub-daemon/src/daemon.ts
  - 改动: `_startInteractiveSession` `interactive_session_started`（@3303 后）调 `hubClient.notifySessionReady(sessionId)`
  - 完成标准: fresh create 完成触发上报
- [ ] task-03: daemon.ts `restoreAndReconnect` recover 调 notifySessionReady
  - 文件: sillyhub-daemon/src/daemon.ts
  - 改动: `restoreAndReconnect` `markReconnected`（@2764）后调 `notifySessionReady`（recover 路径，design gap-1 修正）
  - 完成标准: recover create 完成触发上报
- [ ] task-04: api-types.ts gen:types 同步新端点
  - 文件: sillyhub-daemon/src/api-types.ts
  - 改动: `pnpm gen:types` 同步 POST `/ready` 端点类型
  - 完成标准: api-types 含新端点

## Wave 2: backend 接收 ready + SessionReadiness
**依赖**：无（与 Wave 1 并行）
**目标**：backend 接收 ready + 内存管理

- [ ] task-05: session/service.py 加 SessionReadiness（模块级单例 / app.state）
  - 文件: backend/app/modules/daemon/session/service.py
  - 改动: 加 `SessionReadiness` 类（`mark_ready`/`wait(timeout)`/`clear`），**模块级单例**或挂 `app.state`（DaemonService/SessionService per-request 实例化 router.py:1264，不能放实例字段——design gap-2）
  - 完成标准: mark_ready/wait/clear + 跨请求共享（单例/app.state）
- [ ] task-06: router.py POST `/ready` 端点
  - 文件: backend/app/modules/daemon/router.py
  - 改动: POST `/api/daemon/sessions/{id}/ready`（daemon auth `get_current_principal` + X-API-Key，调 `mark_session_ready`，返回 204）
  - 完成标准: 端点存在 + daemon auth + 调 mark_ready
- [ ] task-07: openapi.json gen:types dump
  - 文件: backend/openapi.json
  - 改动: `pnpm gen:types` dump 新端点
  - 完成标准: openapi 含新端点

## Wave 3: backend inject 等 ready + 生命周期
**依赖**：Wave 2（SessionReadiness）
**目标**：inject 等 ready + 生命周期清理

- [ ] task-08: inject_session 等 readiness.wait
  - 文件: backend/app/modules/daemon/session/service.py
  - 改动: `inject_session` commit AgentRun 后、send SESSION_INJECT 前 `await readiness.wait(session_id, timeout=30)`，超时 **fallback 仍发 SESSION_INJECT** + warn（兼容旧 daemon）
  - 完成标准: inject 等 ready（已 ready 直通零开销 / 超时 fallback 发）
- [ ] task-09: end_session/failed readiness.clear
  - 文件: backend/app/modules/daemon/session/service.py
  - 改动: `end_session` + failed 路径调 `readiness.clear(session_id)`
  - 完成标准: session 终态清 ready
- [ ] task-10: confirm_session_reconnected mark_ready
  - 文件: backend/app/modules/daemon/session/service.py
  - 改动: `confirm_session_reconnected`（reconnecting→active 翻转）调 `mark_ready`（recover 主路径双保险，design gap-1）
  - 完成标准: recover 翻转 mark_ready

## Wave 4: 测试
**依赖**：Wave 1-3
**目标**：覆盖上报 + ready 管理 + inject 等 + 边界

- [ ] task-11: daemon 测试 notifySessionReady
  - 文件: sillyhub-daemon/tests/interactive/...
  - 改动: fresh create（_startInteractiveSession）+ recover（restoreAndReconnect）触发上报 + best-effort 失败 warn
  - 完成标准: 单测过
- [ ] task-12: backend 测试 SessionReadiness + inject 等 + 端点 + recover
  - 文件: backend/app/modules/daemon/tests/...
  - 改动: SessionReadiness（mark/wait/clear/超时）+ inject 等 ready（已 ready 直通 / 超时 fallback 发）+ POST /ready（daemon auth）+ confirm_session_reconnected mark_ready
  - 完成标准: 单测过

## 验收（对应 requirements.md AC）
- AC-01: 新会话 create 后立即 /model 不空白（inject 等 daemon ready）
- AC-02: daemon 重启 recover 后 /model 不空白
- AC-03: 旧 daemon + 新 backend inject 超时 30s fallback 发（功能降级不崩）
- AC-04: session ended 后 inject 报 DaemonSessionNotActive
- AC-05: daemon/backend 单测过（task-11/12）

## 依赖图
```
W1 (daemon 上报) ──┐
                   ├──► W4 (测试)
W2 (backend 接收) ──► W3 (inject 等) ──┘
```
W1/W2 并行；W3 依赖 W2；W4 依赖 W1+W2+W3。
