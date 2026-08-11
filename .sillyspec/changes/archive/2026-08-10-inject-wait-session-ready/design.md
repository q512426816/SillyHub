---
author: WhaleFall
created_at: 2026-08-07 14:11:27
scale: large
tier: independent
---

# 设计文档（Design）— backend inject 等 daemon session ready（修复 /model 等 inject 偶发空白）

## 背景

interactive 会话输入 `/model` 等 slash command 偶发空白轮次（重新进入才显示）。ql-20260807-003 诊断根因：inject（SESSION_INJECT）在新会话 `create_session` 完成前到 daemon，daemon `_routeSessionControl` session 不存在直接 return 丢（不重试不反馈），/model 没进 claude → 空白。

backend `create_session` commit DB active 后立即 wake daemon（lease 领取 fire 不等 create）+ send SESSION_INJECT（WS fire）；daemon lease 领取后 `_startInteractiveSession`（create，spawn claude 秒级）。inject 可能在 create 完成前到 → session_not_found 丢。backend `inject_session` 只查 DB status=='active'（不查 daemon ready），拦不住。

代码定位：
- backend create_session（session/service.py:475-530）：commit active（476）→ notify_interactive_dispatch（486 wake fire）→ send SESSION_INJECT（515 WS fire）
- backend inject_session（session/service.py:592-660）：查 DB active（615）→ send SESSION_INJECT（**不查 daemon ready**）
- daemon _startInteractiveSession（daemon.ts:2920）：lease 领取 → create → interactive_session_started（@3303）
- daemon _routeSessionControl（daemon.ts:2609-2640）：session 不存在 → return 丢

## 设计目标

- backend inject 等 daemon create 完成（session ready），确保 inject 不丢
- 无 DB migration（内存）
- 覆盖边界：daemon 离线 / 重启 recover / session ended / 超时 / 旧 daemon 兼容

## 非目标

- DB daemon_ready migration（内存够，单 backend；daemon 重启 recover 重建）
- create_session 改 RPC await daemon create（方案 C，大改 lease 机制，超范围）
- 前端重试 inject（前端侧，复杂）
- daemon SESSION_INJECT 重试（daemon 侧，hacky）
- create_session 首 prompt（走 execPayload，不经 inject_session，不受影响）

## 总体方案（A：daemon HTTP 上报 + backend 内存 asyncio.Event 等）

daemon create 完成后主动上报 backend session ready；backend 内存维护 ready set + per-session asyncio.Event；`inject_session` 发 SESSION_INJECT 前 await ready event（超时 30s 兜底，超时 fallback 仍发以兼容旧 daemon）。

### Phase 1: daemon 上报 session ready（fresh create + recover 两路径）
- `_startInteractiveSession` create 成功（`interactive_session_started` @3303）后调 `hubClient.notifySessionReady(sessionId)`
- `restoreAndReconnect`（daemon 重启恢复）create 完成（`markReconnected` 切 active）也调 `hubClient.notifySessionReady(sessionId)`——recover 场景 daemon 侧上报（fresh + recover 双覆盖，避免 recover 后 inject 等 ready 超时）
- `hub-client.ts` 加 `notifySessionReady`（HTTP POST `/api/daemon/sessions/{id}/ready`），best-effort（失败 warn 不阻塞 daemon 主循环）
- create/restore 失败不上报（backend create_session 已收敛 DaemonRuntimeOffline；restore 失败 onSessionEnd(failed)）

### Phase 2: backend 接收 ready + 内存管理
- 新端点 POST `/api/daemon/sessions/{id}/ready`（router.py，daemon auth）
- `session/service.py` 加 `SessionReadiness` 管理器（**模块级单例**或挂 `app.state`——DaemonService/SessionService 是 per-request 实例化 router.py:1264，不能放实例字段，否则 mark/wait 各看各的 set 失效）：
  - `ready: set[sessionId]` + per-session `asyncio.Event`
  - `mark_ready(sessionId)`：set.add + event.set()
  - `wait(sessionId, timeout)`：event.wait(timeout)
  - `clear(sessionId)`：set.discard + 新建 event
- POST `/ready` 调 `mark_ready`

### Phase 3: backend inject 等 ready
- `inject_session`（session/service.py:592）：commit AgentRun 后、send SESSION_INJECT 前 `await readiness.wait(sessionId, timeout=30s)`
- 已 ready → 立即返回（零开销）
- 超时（30s daemon 没 ready）→ **fallback 仍发 SESSION_INJECT**（兼容旧 daemon 不上报 ready；新 daemon 正常不会超时）+ warn 日志

### Phase 4: 生命周期与边界
- `end_session` / failed → `readiness.clear(sessionId)`
- daemon 离线 → create_session 已有 DaemonRuntimeOffline（inject 不到）
- daemon 重启 recover → daemon `restoreAndReconnect` create 完成上报 ready（Phase 1）+ backend `confirm_session_reconnected`（reconnecting→active 翻转处）也 `mark_ready`（双保险，防 daemon 上报丢失；**这是 recover 场景 backend 侧主路径**）
- session ended → inject 报 DaemonSessionNotActive（已有；readiness clear）

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/daemon.ts | `_startInteractiveSession` create 完成（@3303 后）调 `hubClient.notifySessionReady` |
| 修改 | sillyhub-daemon/src/hub-client.ts | 加 `notifySessionReady`（HTTP POST session/ready，best-effort） |
| 修改 | sillyhub-daemon/src/api-types.ts | gen:types 同步新端点类型 |
| 修改 | backend/app/modules/daemon/router.py | 新端点 POST `/api/daemon/sessions/{id}/ready`（daemon auth） |
| 修改 | backend/app/modules/daemon/session/service.py | 加 `SessionReadiness`（mark/wait/clear）+ inject_session 等 ready + end/failed clear + recover mark_ready |
| 修改 | backend/openapi.json | gen:types 重新 dump（新端点） |
| 修改 | frontend/src/lib/api-types.ts | gen:types 同步前端类型（task-07 gen 副产物，CLAUDE.md 规则 20） |
| 新增 | backend 测试 | SessionReadiness（mark/wait/clear/超时）+ inject 等 ready + POST /ready 端点 |
| 新增 | sillyhub-daemon 测试 | notifySessionReady 上报（create 完成触发） |

## 接口定义

### daemon hub-client.ts
```ts
async notifySessionReady(sessionId: string): Promise<void>
// HTTP POST /api/daemon/sessions/{sessionId}/ready，best-effort（失败 warn 不抛）
```

### backend router.py
```python
POST /api/daemon/sessions/{session_id}/ready
# daemon auth（daemon api-key），body 空，调 DaemonService.mark_session_ready(session_id)
# 返回 200 + JSON body（ok=true）—— 对齐 daemon hub-client _request 的 JSON.parse 契约（204 空 body 会使 JSON.parse 抛 SyntaxError，Reverse Sync 由 task-01 实现发现）
```

### backend session/service.py SessionReadiness
```python
class SessionReadiness:
    _ready: set[uuid.UUID]
    _events: dict[uuid.UUID, asyncio.Event]
    def mark_ready(self, session_id: uuid.UUID) -> None: ...
    async def wait(self, session_id: uuid.UUID, timeout: float = 30) -> bool: ...  # True=ready, False=超时
    def clear(self, session_id: uuid.UUID) -> None: ...
```

### inject_session 等 ready（session/service.py:592）
```python
# commit AgentRun 后、send SESSION_INJECT 前
ready = await self._readiness.wait(session_id, timeout=30)
if not ready:
    log.warning("session_ready_timeout", session_id=str(session_id))
    # fallback：仍发 SESSION_INJECT（兼容旧 daemon 不上报 ready；正常新 daemon 不会超时）
```

## 生命周期契约表（涉及 session / daemon / lease 关键词）

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| create session | backend | daemon | sessionId, leaseId, claimToken, prompt | session active（DB），daemon create 中 |
| **session ready（新）** | daemon | backend | sessionId | daemon session create 完成，inject 可发 |
| inject turn | backend | daemon | sessionId, leaseId, runId, prompt, claimToken | daemon push inputQueue，新 turn |
| recover session | backend | daemon | sessionId, leaseId, agentSessionId | daemon restoreAndReconnect → 上报 ready |
| session end | daemon/backend | 双向 | sessionId, reason | active → ended，readiness clear |

## 兼容策略（brownfield）

- **旧 daemon（不上报 ready）**：inject wait 超时 30s → fallback 仍发 SESSION_INJECT（旧 daemon 行为，可能 session_not_found 但不阻塞）。即新 backend 兼容旧 daemon（超时不报错，降级旧行为）。
- 新 daemon + 新 backend：daemon create 完成上报 ready，inject 立即等到（秒级），零回归。
- 不改 DB schema（内存），无数据迁移。
- daemon 上报丢失（HTTP/WS 失败）：best-effort 上报 + recover_session_after_daemon_restart 双保险 mark_ready。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | inject 阻塞等占用 backend 连接（高并发） | P2 | 30s 超时；interactive 低并发，连接池足够 |
| R-02 | 旧 daemon 不上报 ready，inject 超时 | P1 | wait 超时 fallback 仍发 SESSION_INJECT（兼容旧 daemon） |
| R-03 | daemon 上报 ready 丢失 | P1 | best-effort + recover mark_ready 双保险 |
| R-04 | backend 重启丢内存 ready set | P2 | daemon 重启 recover 重建；backend 重启 session recover |
| R-05 | asyncio.Event 残留（session 结束未清） | P2 | end/failed clear；定期清理 |

## 决策追踪

- D-001@v1：daemon 上报方式 = 新 HTTP POST session/ready（vs WS / lease heartbeat）—— 复用 hubClient HTTP，点对点简单
- D-002@v1：backend 状态 = 内存 ready set + asyncio.Event（vs DB migration / poll）—— C 修时序竞态秒级，内存够
- D-003@v1：inject 等 = 阻塞 asyncio.Event + 超时 fallback 发（vs poll / 前端重试 / 报错）—— 响应快 + 兼容旧 daemon

## 自审

- 背景/根因 ✓（ql-003 + 代码定位）
- 设计目标 ✓（inject 等 daemon ready）
- 非目标 ✓（不做 migration / RPC / 前端 / daemon 重试）
- 总体方案 ✓（Phase 1-4）
- 文件变更清单 ✓（6 代码 + 2 测试）
- 接口定义 ✓（notifySessionReady + POST /ready + SessionReadiness + inject 等）
- 生命周期契约表 ✓（含新 session ready 事件）
- 兼容策略 ✓（旧 daemon fallback）
- 风险登记 ✓（R-01..R-05）
- 自审通过：章节齐全，方案一致，覆盖边界（含旧 daemon 兼容 R-02）
