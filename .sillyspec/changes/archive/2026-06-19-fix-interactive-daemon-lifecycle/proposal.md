---
author: qinyi
created_at: 2026-06-19T05:00:00
---

# 补丁：修复 interactive session daemon 侧完整生命周期（4 gap）

## 背景

已归档变更 `2026-06-18-daemon-interactive-session`（交互式会话管控 D-002@v3）部署后，**真实 daemon ↔ backend 集成**暴露 4 个串联 gap。原变更 verify 只跑单元测试（mock SessionManagerDeps，task-04 蓝图明确"本任务用 mock"），**未做真实 daemon 端到端集成验证**，掩盖了这些 gap。

症状：`POST /api/daemon/sessions` 创建 interactive session 后，daemon `task_runner` 处理 lease 时 `submitMessages` 传空 `agent_run_id` → `422 uuid_parsing`。

## 4 gap 诊断（实测证据）

### gap-1：cli.ts 没注入 SessionManager
- 位置：`sillyhub-daemon/src/cli.ts:386` `new Daemon(config, client, taskRunner)` 没传 `options.sessionManager`
- 根因：task-04 `allowed_paths` 不含 cli.ts，但蓝图 §4.4 要求"main.ts 实例化 SessionManager 传入"——plan 自相矛盾（要求改 cli.ts 但 allowed_paths 排除）
- 后果：`daemon._sessionManager = null` → kind=interactive lease 走 task_runner（batch 路径）→ submitMessages 用 `lease.agent_run_id`（interactive lease NULL→空串）→ 422
- 实测日志：`[daemon.session_control_no_manager] type=daemon:session_inject` + `[task ...] spawn: claude.cmd`（走 task_runner 非 SessionManager）

### gap-2：SessionState/CreateSessionInput 没 claimToken
- `hubClient.submitMessages(leaseId, claimToken, agentRunId, messages)` 需要 claimToken
- `SessionState`（task-04）字段：sessionId/leaseId/agentSessionId/query/inputQueue/currentRunId/status/lastActiveAt/cwd/provider —— **无 claimToken**
- `CreateSessionInput`：sessionId/leaseId/firstPrompt/firstRunId/cwd/provider/pathToClaudeCodeExecutable/model?/allowedTools? —— **无 claimToken**
- 后果：即使走 SessionManager，onTurnMessage 无法 submitMessages（缺 claimToken）

### gap-3：daemon→backend run 终态反向通知没实现
- design §7.6 说"result 后 WS 通知 backend 关闭 AgentRun"，但**未定义具体协议**（task-03 协议只有 SESSION_INJECT/INTERRUPT/END/PERMISSION，无 daemon→server 的 run 终态消息）
- hubClient 方法：register/heartbeat/claimLease/startLease/submitMessages/completeLease/...—— **无 run 终态通知方法**
- backend daemon router：无 daemon 上行 run 终态端点
- 后果：SDK result 后 backend 不知道关闭 AgentRun → run 永远卡 running（SSE 流断、状态错乱）

### gap-4：daemon→backend session end 反向通知没实现
- 空闲 30min（task-07）/异常 end 后，daemon `SessionManager.onSessionEnd` 没通知 backend
- backend `end_session` 是前端 REST（`POST /sessions/{id}/end`，task-05），daemon 不调
- 后果：daemon 标 ended 但 backend 仍 active（session/lease 状态不同步）

## 修复方案

### gap-1：cli.ts 注入 SessionManager
- `cli.ts start` 实例化 `SessionManager`（deps 实现）+ 传 `new Daemon(config, client, taskRunner, { sessionManager, persistence, ... })`
- Daemon 构造已支持 `options.sessionManager`（daemon.ts:374）

### gap-2：claimToken 传递链
- backend `prepare_interactive_dispatch` lease metadata / SESSION_INJECT payload 带 `claim_token`
- daemon `CreateSessionInput` + `SessionState` 加 `claimToken`
- daemon `_startInteractiveSession` 从 lease payload 取 claimToken → SessionManager.create → SessionState 持有
- inject 时 backend SESSION_INJECT payload 也带 claim_token（续 turn 校验）

### gap-3：run 终态反向通知协议（设计决策）
**推荐方案：REST 上行**（复用 daemon 已有 HTTP 鉴权，避免新 WS 消息）
- backend 新端点 `POST /api/daemon/leases/{lease_id}/runs/{run_id}/result`（daemon 上行，claim_token 鉴权）：body `{status, is_error, result_summary, subtype}`，service 关闭 AgentRun（success→completed / error_during_execution→failed(interrupted) / 其他 error→failed）
- daemon hubClient 新方法 `notifyRunResult(leaseId, claimToken, runId, payload)`
- SessionManager `_onResult` → deps.onTurnResult → daemon 桥接 → hubClient.notifyRunResult

备选：WS daemon→server 新消息 `RUN_RESULT`（task-03 协议扩展）—— 但 daemon WS 是 server→daemon 为主，加反向消息复杂度高，REST 更简单。

### gap-4：session end 反向通知
- daemon `SessionManager.onSessionEnd` → hubClient 新方法 `notifySessionEnd(runtimeClaimToken/api-key, sessionId, status, reason)`
- backend 复用 `service.end_session`（task-05 已实现），新 daemon 上行端点 `POST /api/daemon/sessions/{id}/end`（daemon 鉴权用 api-key/runtime claim_token，区别于前端 user JWT）—— 或内部 service 调用
- 空闲 30min（task-07 idle scanner）+ 异常 fail 都经 onSessionEnd → backend end_session 收口

## 文件清单
- `sillyhub-daemon/src/cli.ts`（注入 SessionManager + deps 实例化）
- `sillyhub-daemon/src/daemon.ts`（_startInteractiveSession 传 claimToken；onTurnResult/onSessionEnd 桥接到 hubClient）
- `sillyhub-daemon/src/interactive/session-manager.ts`（SessionState 加 claimToken）
- `sillyhub-daemon/src/interactive/types.ts`（CreateSessionInput 加 claimToken）
- `sillyhub-daemon/src/hub-client.ts`（notifyRunResult + notifySessionEnd 方法）
- `backend/app/modules/daemon/router.py`（daemon 上行：runs/{run_id}/result + sessions/{id}/end，claim_token/api-key 鉴权）
- `backend/app/modules/daemon/service.py`（close_interactive_run + end_session daemon 入口复用）
- `backend/app/modules/agent/placement.py`（lease metadata 带 claim_token）

## 验收（含真实 daemon 集成）
1. createSession provider=claude → daemon 走 SessionManager（**非 task_runner**），422 消除
2. SDK result → daemon notifyRunResult → backend 关闭 AgentRun（run 终态 completed/failed），**不卡 running**
3. 空闲 30min（或手动 end）→ daemon onSessionEnd → backend end_session（session/lease 同步 ended）
4. **真实 daemon 端到端集成测试**（原变更 verify 遗漏）：启动真实 daemon → createSession → inject → 收 result → run 关闭 → end → session ended，全链路绿
5. 单元测试（mock）+ 类型检查 + ruff 通过；batch 路径零回归
6. **verify 必须跑真实 daemon 集成**（gap-5：原变更 verify 教训——单元测试 mock 掩盖真实集成问题）

## 教训（记入 knowledge）
- **mock 依赖的单元测试不能替代真实集成验证**。task-04 用 mock SessionManagerDeps，verify 只跑单元测试，掩盖了 cli.ts 注入 + claimToken + run 终态/session end 反向通知 4 个生产 gap。verify 必须包含真实 daemon ↔ backend 端到端集成测试。
- **allowed_paths 与蓝图要求一致性**：task-04 蓝图要求改 cli.ts（main 注入），但 allowed_paths 排除 cli.ts，导致生产注入遗漏。plan 阶段应校验 allowed_paths 覆盖蓝图所有"生产路径"要求。

## 执行建议
此补丁变更涉及 daemon ↔ backend 协议设计（gap-3/4）+ 多文件 + 真实 daemon 集成测试，建议**新会话执行**（干净上下文），brainstorm/plan 基于本 proposal 完善 design.md → execute → verify（含真实 daemon 集成）→ 重新部署。
