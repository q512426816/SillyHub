---
author: WhaleFall
created_at: 2026-08-07 14:11:27
---

# 需求规格（Requirements）

## 功能需求

### FR-01: daemon 上报 session ready（fresh + recover）
- daemon `_startInteractiveSession` create 成功（`interactive_session_started`）后调 `hubClient.notifySessionReady(sessionId)`
- daemon `restoreAndReconnect`（recover）create 完成（`markReconnected`）也调 `notifySessionReady`
- `notifySessionReady`: HTTP POST `/api/daemon/sessions/{id}/ready`，best-effort（失败 warn 不阻塞 daemon 主循环）
- create/restore 失败不上报

### FR-02: backend 接收 ready + 内存管理
- POST `/api/daemon/sessions/{id}/ready` 端点（daemon auth，body 空，返回 200 + JSON ok=true，对齐 daemon _request JSON 契约）
- `SessionReadiness` **模块级单例**或挂 `app.state`（DaemonService/SessionService per-request 实例化，不能放实例字段）
- `mark_ready(sessionId)`：set.add + event.set()
- `wait(sessionId, timeout=30)`：event.wait，返回 bool（True=ready, False=超时）
- `clear(sessionId)`：set.discard + 新建 event

### FR-03: backend inject 等 ready
- `inject_session` commit AgentRun 后、send SESSION_INJECT 前 `await readiness.wait(sessionId, timeout=30s)`
- 已 ready（event 已 set）→ 立即返回，inject 直通（零开销）
- 超时（30s）→ **fallback 仍发 SESSION_INJECT** + warn 日志（兼容旧 daemon 不上报 ready）

### FR-04: 生命周期与边界
- `end_session` / failed → `readiness.clear(sessionId)`
- daemon 重启 recover → daemon `restoreAndReconnect` 上报 ready（FR-01）+ backend `confirm_session_reconnected`（reconnecting→active 翻转）`mark_ready`（双保险，recover 主路径）
- daemon 离线 → create_session 已有 `DaemonRuntimeOffline`（inject 不到）
- session ended → inject 报 `DaemonSessionNotActive`（已有）

### FR-05: 测试
- daemon: notifySessionReady 上报（fresh create + recover 触发 + best-effort 失败 warn）
- backend: SessionReadiness（mark/wait/clear/超时）+ inject 等 ready（已 ready 直通 / 超时 fallback 发）+ POST /ready 端点（daemon auth）+ recover mark_ready

## 验收标准
- AC-01: 新会话 create 后立即 /model，不空白（inject 等 daemon ready）
- AC-02: daemon 重启 recover 后 /model，不空白
- AC-03: 旧 daemon（不上报 ready）+ 新 backend，inject 超时 30s fallback 发（功能降级不崩）
- AC-04: session ended 后 inject 报 DaemonSessionNotActive
- AC-05: daemon/backend 单测过
