---
author: qinyi
created_at: 2026-06-19T05:10:00
---

# 补丁设计：修复 interactive session daemon 侧完整生命周期

> 依据 proposal.md（4 gap 诊断）。本 design 细化技术实现（接口/协议/数据流）。原变更 D-002@v3 架构不变，只补 daemon 侧生产生命周期。

## 1. 目标
修复 4 gap，使 interactive session 完整生命周期（create→inject→SDK result→run 关闭→end→session ended）在真实 daemon↔backend 集成下可用。原变更 verify 遗漏真实集成（mock 掩盖），本补丁补全 + 验收含真实 daemon 集成。

## 2. gap-1：cli.ts 注入 SessionManager
```typescript
// cli.ts start（构造 daemon 前）
const driver = new ClaudeSdkDriver();
const sessionManager = new SessionManager({
  driver,
  onTurnResult: (sid, runId, result) => daemon.onTurnResult(sid, runId, result),
  onTurnMessage: (sid, runId, msg) => daemon.onTurnMessage(sid, runId, msg),
  onSessionEnd: (sid, status) => daemon.onSessionEnd(sid, status),
});
const daemon = new Daemon(config, client, taskRunner, { sessionManager, persistence, ... });
```
daemon.ts 暴露 `onTurnResult/onTurnMessage/onSessionEnd`（调 hubClient）。注意循环引用（sessionManager deps 引用 daemon，daemon 构造后再注入 deps，或用闭包延迟绑定）。

## 3. gap-2：claimToken 传递链
- backend `prepare_interactive_dispatch`：lease 生成 claim_token，写 lease metadata `claim_token`
- backend SESSION_INJECT payload 加 `claim_token`（首 turn + 后续 inject）
- daemon `CreateSessionInput` + `SessionState` 加 `claimToken: string`
- daemon `_startInteractiveSession` 从 execPayload 取 claim_token → `SessionManager.create({claimToken, ...})`
- `SessionManager.onTurnMessage` → `hubClient.submitMessages(state.leaseId, state.claimToken, currentRunId, messages)`

## 4. gap-3：run 终态反向通知（REST 协议，非 WS）
backend 新端点（daemon 上行，claim_token 鉴权）：
```
POST /api/daemon/leases/{lease_id}/runs/{run_id}/result
Header: X-Claim-Token: <claim_token>
Body: { status, is_error, subtype, result_summary }
→ service.close_interactive_run(lease_id, run_id, payload)
```
`close_interactive_run` 关闭 AgentRun：subtype=success→completed / error_during_execution→failed(interrupted) / 其他 is_error→failed；幂等（已终态 no-op）。

daemon hubClient 新方法：
```typescript
async notifyRunResult(leaseId, claimToken, runId, payload): Promise<void>
```
SessionManager `_onResult` → deps.onTurnResult → daemon.onTurnResult → hubClient.notifyRunResult。

## 5. gap-4：session end 反向通知
daemon hubClient 新方法：
```typescript
async notifySessionEnd(sessionId, status, reason): Promise<void>  // api-key 鉴权
```
backend 复用 `service.end_session`（task-05 已实现），新 daemon 上行端点：
```
POST /api/daemon/sessions/{session_id}/end   (daemon 上行，X-API-Key 鉴权，区别前端 user JWT)
Body: { status, reason }
→ service.end_session(session_id, daemon_internal_user, reason)
```
SessionManager.end/fail → onSessionEnd → daemon.onSessionEnd → hubClient.notifySessionEnd。空闲 30min（task-07 idle scanner）+ 异常 fail 都经此。

## 6. 端到端数据流
1. 前端 createSession → backend create_session（lease kind=interactive + 首 AgentRun + claim_token 入 metadata）
2. backend SESSION_INJECT（首 turn，含 claim_token）→ daemon SessionManager.create（claimToken 存 SessionState）→ ClaudeSdkDriver.start（系统 claude wrapper→exe）
3. driver.consume result → onTurnResult → daemon.notifyRunResult → backend close_interactive_run（run 终态，SSE turn_completed）
4. 前端 inject → backend new AgentRun + SESSION_INJECT（claim_token）→ daemon SessionManager.inject → 新 turn
5. end / idle 30min → daemon SessionManager.end → onSessionEnd → daemon.notifySessionEnd → backend end_session（session/lease ended）

## 7. 文件清单
- daemon: `cli.ts`（注入 SessionManager+deps）/ `daemon.ts`（onTurnResult/onMessage/onSessionEnd 桥接 + _startInteractiveSession 传 claimToken）/ `interactive/session-manager.ts`（SessionState+claimToken）/ `interactive/types.ts`（CreateSessionInput+claimToken）/ `hub-client.ts`（notifyRunResult+notifySessionEnd）
- backend: `daemon/router.py`（runs/{run_id}/result + sessions/{id}/end daemon 上行端点）/ `daemon/service.py`（close_interactive_run + end_session daemon 入口）/ `agent/placement.py`（lease metadata claim_token）/ `daemon/protocol.py`（SESSION_INJECT payload 加 claim_token，复用 task-03）
- 测试：daemon 单元（mock）+ backend 单元 + **真实 daemon 端到端集成**

## 8. 验收
1. createSession → daemon 走 SessionManager（非 task_runner），422 消除
2. SDK result → daemon notifyRunResult → backend 关闭 AgentRun（不卡 running）
3. end / idle 30min → daemon notifySessionEnd → backend end_session（session/lease 同步 ended）
4. **真实 daemon 端到端集成测试**（启动真实 daemon→createSession→inject→result→run 关闭→end→session ended，全链路绿）—— 原变更 verify 遗漏，本补丁必做
5. 单元测试 + 类型检查 + ruff 通过；batch 路径零回归（FR-09）

## 9. 非目标
- 不改 D-002@v3 架构（driver 与 TaskRunner 并存）
- 不改 task-03 已有协议常量（run 终态用 REST 新端点，非 WS 新消息）
- 不重做已归档变更的其他部分（只补 4 gap）
- codex/cursor/openclaw 仍不支持（D-002@v3 聚焦 claude）

## 10. 风险
- R1 cli.ts sessionManager deps 循环引用（sessionManager 引 daemon，daemon 引 sessionManager）→ 用闭包延迟绑定或 daemon 构造后注入 deps
- R2 claim_token 生命周期（lease claim_token 在 lease 生命周期内有效）→ SessionState 存 lease 级 claim_token，跨 turn 复用
- R3 真实 daemon 集成测试依赖系统 claude + 智谱中转（网络）→ 集成测试可选（CI 补），本地跑需 env
