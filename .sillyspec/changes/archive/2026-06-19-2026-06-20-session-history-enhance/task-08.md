---
id: task-08
title: daemon protocol SESSION_RESUME + _routeSessionControl 分支调 restoreAndReconnect
priority: P0
depends_on: [task-06, task-07]
blocks: [task-10]
requirement_ids: [FR-2]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/protocol.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/interactive/types.ts
  - sillyhub-daemon/tests/
---

## 修改文件
- `sillyhub-daemon/src/protocol.ts`：新增 `SESSION_RESUME`
- `sillyhub-daemon/src/daemon.ts`：`_routeSessionControl`（:1375-1403）加 `SESSION_RESUME` case
- `sillyhub-daemon/src/interactive/types.ts`：确认 `PersistedSessionRecord` 字段覆盖 reopen payload（必要时补）
- 测试：`sillyhub-daemon/tests/`

## 覆盖来源
- design.md §4.3.2、§6.4、§13、§14；decisions D-002@v1；requirements FR-2

## 实现要求
1. `protocol.ts` 新增（紧邻 SESSION_END/INJECT，:82-101）：`SESSION_RESUME = "daemon:session_resume"`（与 backend task-06 常量同名）
2. `daemon.ts _routeSessionControl` 加 case：
   ```ts
   case MSG.SESSION_RESUME: {
     const record: PersistedSessionRecord = {
       sessionId: payload.session_id,
       leaseId: payload.lease_id,
       agentSessionId: payload.agent_session_id,
       cwd: payload.cwd,
       provider: payload.provider,
     };
     await this._sessionManager.restoreAndReconnect(record);
     // restoreAndReconnect 内部: new InputQueue + driver.start({resume: agentSessionId}) + _runConsume + markReconnected
   }
   ```
3. `restoreAndReconnect`（session-manager.ts:744-811）**无需改**：已具备 resume 能力；内部 `markReconnected` → daemon 上报 confirm → backend `confirm_session_reconnected` 切 active
4. resume 成功后，后续 turn 直接走现有 inject 链路（SESSION_INJECT → SessionManager.inject :450）

## 接口定义
- `MSG.SESSION_RESUME = "daemon:session_resume"`
- `PersistedSessionRecord`（`interactive/types.ts`）：`{ sessionId, leaseId, agentSessionId, cwd, provider }`（确认字段名与 backend payload snake→camel 映射）
- WS payload 归一化：backend 发 snake_case（task-07），daemon 入口归一化（参考现有 snake/camel 归一化，ql-20260616-006）

## 边界处理
1. **resume 失败（jsonl 不存在/cwd 变/SDK 报错）**：`restoreAndReconnect` → driver.start 抛 → onError → 上报 backend，backend status→failed；前端轮询发现 failed 提示
2. **provider≠claude（不应发生，backend 已拦）**：`restoreAndReconnect` throw `UnsupportedProviderError`（session-manager.ts:745）→ 上报 failed
3. **daemon 无对应 runtime 注册**：WS 路由不到该 daemon（backend 发给 runtime_id 对应连接），正常不触达；防御性 warn
4. **重复 SESSION_RESUME（并发）**：SessionManager 若已有该 session state → restoreAndReconnect 幂等检查（确认 :744 是否防重，必要时加）
5. **payload 缺 agent_session_id**：拒绝（无 resume key），warn + 不 resume
6. **snake/camelCase 不匹配**：入口归一化层处理（避免 task_no_lease_id 类丢消息）

## 非目标
- 不改 SDK / claude-sdk-driver / SessionManager 核心（restoreAndReconnect 复用）
- 不实现 backend reopen（task-05/07）
- 不改 inject/end route

## 参考
- 现有 route：`daemon.ts:1375-1403`（SESSION_INJECT :1376 / SESSION_END :1395）
- restoreAndReconnect：`session-manager.ts:744-811`
- task-10 崩溃恢复编排：`daemon.ts:638-803`（resume 能力已验证）
- snake/camel 归一化：`daemon.ts` _handleWsMessage（ql-20260616-006）

## TDD 步骤
1. 写测试：_routeSessionControl 收 SESSION_RESUME → 调 sessionManager.restoreAndReconnect(record)（mock 验证 record 字段 + 调用）
2. 确认失败（无 case）
3. 实现 protocol 常量 + route case
4. 确认通过；补 payload 缺 agent_session_id 拒绝 + snake/camel 归一化测试
5. 回归 daemon route 测试

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | _routeSessionControl 收 SESSION_RESUME | 调 `restoreAndReconnect(record)`，record 含 agentSessionId/cwd/provider/leaseId |
| AC-02 | restoreAndReconnect | 用 `options.resume=agentSessionId` 启动 driver（复用，不改 SessionManager） |
| AC-03 | resume 成功 | markReconnected → 上报 confirm → backend status=active |
| AC-04 | resume 失败（jsonl 缺） | onError → 上报 → backend failed |
| AC-05 | payload 缺 agent_session_id | 拒绝 resume + warn |
| AC-06 | snake/camel 归一化 | backend snake payload 正确映射到 record |
| AC-07 | daemon route 测试回归 | 全绿 |
