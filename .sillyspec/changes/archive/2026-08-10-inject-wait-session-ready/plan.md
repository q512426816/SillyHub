---
plan_level: full
author: WhaleFall
created_at: 2026-08-07 14:15:00
---

# 实现计划（Plan）：backend inject 等 daemon session ready

## Wave 概览

Wave 划分原则：execute 同 Wave 强制并行（子代理同时跑），故改同一源码文件的 task 必须拆到不同 Wave（否则互相覆盖，plan-postcheck 阻断）；同 Wave 内 task 无相互依赖；跨 Wave 按编号串行，被依赖者在更早 Wave。

- Wave 1（FR-01/FR-02）: task-01（hub-client notifySessionReady）、task-05（SessionReadiness 单例）—— 两块独立基石，不同文件
- Wave 2（FR-01/FR-02/FR-03）: task-02（daemon fresh 上报）、task-06（POST /ready 端点）、task-08（inject 等 ready）—— 均依赖 Wave 1
- Wave 3（FR-01/FR-02/FR-04）: task-03（daemon recover 上报）、task-09（end/failed clear）、task-07（openapi dump）—— 依赖 Wave 1-2
- Wave 4（FR-02/FR-04/FR-05）: task-10（recover mark_ready 双保险）、task-04（daemon api-types gen）、task-11（daemon 测试）—— 依赖 Wave 1-3
- Wave 5（FR-05）: task-12（backend 测试）—— 依赖 Wave 1-4

## Wave 1: 基石（daemon client 方法 + backend 状态管理器）
**依赖**：无
**目标**：两块独立基石并行，不同文件无冲突

- [x] task-01: hub-client.ts 加 notifySessionReady
  - 文件: sillyhub-daemon/src/hub-client.ts
  - 改动: 加 `notifySessionReady(sessionId)`（HTTP POST `/api/daemon/sessions/{id}/ready`，best-effort 复用 `_request POST` 范式 @680-759，失败 warn 不抛）
  - 完成标准: 方法存在 + best-effort（失败不抛）；调用点上报由 task-11 mock 覆盖
- [x] task-05: session/service.py 加 SessionReadiness（模块级单例）
  - 文件: backend/app/modules/daemon/session/service.py
  - 改动: 加 `SessionReadiness` 类（`mark_ready`/`wait(timeout)`/`clear`），**模块级单例**（per-request 实例化会让 mark/wait 各看各的 set 失效，design gap-2）
  - 完成标准: mark_ready/wait/clear + 跨请求共享（单例）

## Wave 2: fresh 上报 + 端点 + inject 等待
**依赖**：Wave 1（task-02→task-01，task-06/task-08→task-05）
**目标**：fresh create 上报链路打通 + backend 接收端点 + inject 等 ready

- [x] task-02: daemon.ts `_startInteractiveSession` create 完成调 notifySessionReady
  - 文件: sillyhub-daemon/src/daemon.ts
  - 改动: `interactive_session_started`（@3313 后）调 `hubClient.notifySessionReady(sessionId)`
  - 完成标准: fresh create 完成触发上报
- [x] task-06: router.py POST `/ready` 端点
  - 文件: backend/app/modules/daemon/router.py
  - 改动: POST `/api/daemon/sessions/{id}/ready`（daemon auth `get_current_principal` + X-API-Key，调 `mark_session_ready`，返回 200 + JSON ok=true）
  - 完成标准: 端点存在 + daemon auth + 调 mark_ready + 200 JSON
- [x] task-08: inject_session 等 readiness.wait
  - 文件: backend/app/modules/daemon/session/service.py（与 task-05 不同 Wave，串行安全）
  - 改动: commit AgentRun 后、send SESSION_INJECT 前 `await readiness.wait(session_id, timeout=30)`，超时 fallback 仍发 + warn
  - 完成标准: inject 等 ready（已 ready 直通 / 超时 fallback 发）

## Wave 3: recover 上报 + 清理 + openapi dump
**依赖**：Wave 1-2（task-03→task-01，task-09→task-05，task-07→task-06）
**目标**：recover 路径上报 + 生命周期清理 + schema dump

- [x] task-03: daemon.ts `restoreAndReconnect` recover 调 notifySessionReady
  - 文件: sillyhub-daemon/src/daemon.ts（与 task-02 不同 Wave，串行安全）
  - 改动: `markReconnected`（@2764）后调 `notifySessionReady`（recover 路径，design gap-1）
  - 完成标准: recover create 完成触发上报
- [x] task-09: end_session/failed readiness.clear
  - 文件: backend/app/modules/daemon/session/service.py（与 task-05/08 不同 Wave）
  - 改动: `end_session` + 两 failed 路径（`_converge_failed_dispatch`/`mark_session_recovery_failed`）调 `readiness.clear`
  - 完成标准: session 终态清 ready
- [x] task-07: openapi.json gen:types dump
  - 文件: backend/openapi.json
  - 改动: `pnpm gen:types` dump task-06 新端点到 openapi.json
  - 完成标准: openapi 含新端点

## Wave 4: recover 双保险 + daemon 类型同步 + daemon 测试
**依赖**：Wave 1-3（task-10→task-05，task-04→task-07，task-11→task-01/02/03）
**目标**：backend recover mark_ready + daemon 类型同步 + daemon 单测

- [x] task-10: confirm_session_reconnected mark_ready
  - 文件: backend/app/modules/daemon/session/service.py（与 task-05/08/09 不同 Wave）
  - 改动: `confirm_session_reconnected`（reconnecting→active 翻转）调 `mark_ready`（recover 主路径双保险，design gap-1）
  - 完成标准: recover 翻转 mark_ready
- [x] task-04: api-types.ts gen:types 同步新端点
  - 文件: sillyhub-daemon/src/api-types.ts, backend/openapi.json（与 task-07 不同 Wave）
  - 改动: `pnpm gen:types` 同步 POST `/ready` 端点类型（task-07 dump 之后）
  - 完成标准: api-types 含新端点
- [x] task-11: daemon 测试 notifySessionReady
  - 文件: sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts
  - 改动: fresh create + recover 触发上报 + best-effort 失败 warn
  - 完成标准: 单测过

## Wave 5: backend 测试
**依赖**：Wave 1-4（task-12→task-05/06/08/09/10）
**目标**：backend 全量单测覆盖

- [x] task-12: backend 测试 SessionReadiness + inject 等 + 端点 + recover
  - 文件: backend/app/modules/daemon/tests/test_session_readiness.py
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
W1 task-01(hub-client) ──┬─► W2 task-02(daemon fresh) ──► W3 task-03(daemon recover) ──► W4 task-11(daemon test)
                         └──────────────────────────────────────────────────────────────►
W1 task-05(SessionReadiness) ─┬─► W2 task-06(router /ready) ─► W3 task-07(openapi) ─► W4 task-04(api-types gen)
                               ├─► W2 task-08(inject 等) ───────────────────────────────────────┐
                               ├─► W3 task-09(clear) ───────────────────────────────────────────┤
                               └─► W4 task-10(recover mark_ready) ──────────────────────────────┴─► W5 task-12(backend test)
```
W1 两基石并行；后续 Wave 按依赖 + 文件冲突串行（同源文件的 task 强制不同 Wave，避免 execute 并行互相覆盖）。
