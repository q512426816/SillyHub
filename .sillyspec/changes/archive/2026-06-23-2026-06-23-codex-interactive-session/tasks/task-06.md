---
author: qinyi
created_at: 2026-06-24 00:13:45
id: task-06
title: daemon 接入 provider-specific executable、Codex recovery 与 session 清理
priority: P0
estimated_hours: 6
depends_on: [task-04, task-05]
blocks: [task-08, task-10]
requirement_ids: [FR-01, FR-03, FR-05, FR-06]
decision_ids: [D-001@v1, D-002@v1, D-003@v1, D-007@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/cli.ts
  - sillyhub-daemon/src/interactive/session-store-persistence.ts
  - sillyhub-daemon/tests/**
---

# task-06: daemon 接入 provider-specific executable、Codex recovery 与 session 清理

本任务把 daemon 从「写死 Claude」切换到「按 runtime provider 选 executable + driver」，并接通 Codex 的 reopen/recovery 与子进程清理。前置依赖 task-02（SessionManager provider driver registry）已就绪、task-04（CodexAppServerDriver 核心生命周期）、task-05（Codex approval/dialog 映射）已实现 Codex driver；本任务只做 daemon/cli/persistence 三处的接线，不改 driver 内部实现，不改 backend（留 task-07）、不改 frontend（留 task-08）。

## 修改文件

| 文件 | 类型 | 改动点 |
| --- | --- | --- |
| `sillyhub-daemon/src/cli.ts` | 修改 | line 408/415 `new SessionManager({ driver, ... })` 改为注入 `drivers: { claude: new ClaudeSdkDriver(), codex: new CodexAppServerDriver() }`（兼容旧 `driver?` 入口，映射到 `drivers.claude`） |
| `sillyhub-daemon/src/daemon.ts` | 修改 | `_startInteractiveSession`（line 1866）：executable 改按 provider 取；缺 executable fail lease 并记 provider-specific 日志；`onTurnMessage`/`onTurnResult`（line 986/1102）参数类型从 `SDKMessage`/`SDKResultMessage` 放宽为 driver message/result；`_routeSessionResume`（line 1656）已归一化 provider，确认无写死 Claude 残留 |
| `sillyhub-daemon/src/interactive/session-store-persistence.ts` | 修改 | `validateRecord` 白名单字段注释/校验补充 Codex 语义（`pathToClaudeCodeExecutable` 对 Codex 即 Codex executable path，threadId 复用 `agentSessionId` 字段）；不新增列 |
| `sillyhub-daemon/tests/**` | 新增/修改 | daemon 接线测试：Codex executable 缺失 fail lease、Codex recovery 不抛 `UnsupportedProviderError`、Claude 路径回归、driver message 类型放宽兼容 |

## 覆盖来源

| 来源 ID | 落点 |
| --- | --- |
| FR-01 | daemon 按 provider 路由到 Codex interactive 链路（`_startInteractiveSession` 取 codex executable） |
| FR-03 | daemon `_routeSessionResume` + recovery 对 Codex 不抛 `UnsupportedProviderError`，走 `thread/resume` |
| FR-05 | `_startInteractiveSession` 缺 codex executable 时 fail lease（记 `interactive_codex_executable_not_found`）而非静默 |
| FR-06 | daemon restart recovery 读 sessions.json 对 Codex record 调 `restoreAndReconnect`，缺 threadId 标 failed 不伪造（D-007） |
| D-001@v1 | cli 注入 provider driver registry（claude + codex），daemon 不再写死 Claude executable |
| D-002@v1 | `_startInteractiveSession` 用 `provider=execPayload.provider??'claude'` + `_agentPaths.get(provider)` 选 Codex app-server executable |
| D-003@v1 | daemon resume 路径对 Codex 归一化 provider 交 `SessionManager.restoreAndReconnect`，daemon 层不写死 Claude |
| D-007@v1 | recovery/持久化 threadId 复用 `agentSessionId` 字段，缺 threadId 时标 failed、不伪造新 thread |

## 实现要求（design §5.4 Daemon 接入 5 点）

对照 design §5.4 五条改动逐条落实：

1. **cli 注入 drivers.claude / drivers.codex**（design §5.4.1）
   - `cli.ts` line 408 `const driver = new ClaudeSdkDriver()` 旁新增 `const codexDriver = new CodexAppServerDriver()`；
   - line 415 `new SessionManager({ driver, ... })` 改为 `new SessionManager({ drivers: { claude: driver, codex: codexDriver }, ... })`；
   - task-02 已保留兼容入口 `driver?: ClaudeSdkDriver`（构造函数内映射到 `drivers.claude`），新代码统一用 `drivers`；其余 deps 闭包（onTurnResult/onTurnMessage/onSessionEnd/permissionWsClient/supportedDialogKinds）不变。

2. **`_startInteractiveSession` 按 provider 取 executable**（design §5.4.2）
   - line 1865 `const provider = (execPayload.provider ?? 'claude') as 'claude' | 'codex'` 已存在，保留；
   - line 1866 `const pathToClaudeCodeExecutable = this._agentPaths.get('claude') ?? ''` 改为按 provider 取：
     ```ts
     const executablePath = this._agentPaths.get(provider) ?? '';
     ```
   - line 1878-1886 的 executable 缺失分支：错误码从写死 `interactive_claude_executable_not_found` 改为 provider-specific：
     ```ts
     this._logger.error(`interactive_${provider}_executable_not_found`, {
       lease_id: leaseId,
       provider,
       code: `${provider.toUpperCase()}_EXECUTABLE_NOT_FOUND`,
     });
     return; // 不调 create，backend 据 lease 超时/onSessionEnd 收 failed（与 Claude AC-07 同路径）
     ```
   - line 1987 `pathToClaudeCodeExecutable` 入参传 `executablePath`（字段名在 task-02 已可保留为兼容名，语义为 provider executable path）。

3. **`_routeSessionResume` 归一化 provider 交 SessionManager.restoreAndReconnect**（design §5.4.3）
   - line 1681-1682 provider 归一化 `?? 'claude'`、`=== 'codex' ? 'codex' : 'claude'` 已存在且正确，保留；
   - 确认 `PersistedSessionRecord`（line 1683-1693）已带 `provider`，`restoreAndReconnect(record)` 在 task-02 已按 `record.provider` 选 driver、不再抛 `UnsupportedProviderError`；本任务只验证 daemon 不在 resume 路径写死 `'claude'`（grep 确认无残留）。
   - D-007 重点：`agentSessionId` 对 Codex 即 threadId，缺失时 line 1672-1680 已拒绝 resume 并 warn（不伪造）。

4. **`onTurnMessage` / `onTurnResult` 类型放宽**（design §5.4.4）
   - `onTurnResult`（line 989）参数 `result: SDKResultMessage` 放宽为 `result: InteractiveDriverResult`（task-01 已定义），保留现有 `as SDKResultMessage & {...}` 字段提取逻辑（subtype/is_error/total_cost_usd/usage 等字段在 `InteractiveDriverResult` 已声明，Claude SDK raw 兼容）；
   - `onTurnMessage`（line 1105）参数 `msg: SDKMessage` 放宽为 `msg: InteractiveDriverMessage`（= `Record<string, unknown>`），保留 line 1139-1146 的 assistant usage 提取逻辑（Claude raw 兼容）；Codex flat message（`{event_type, content, metadata, session_id}`）直接经 `submitMessages` 透传；
   - cli.ts line 419-420 deps 闭包类型同步放宽（task-02 SessionManagerDeps.onTurnMessage/onTurnResult 签名已在 task-02 改为 driver 类型，daemon 实现签名放宽后兼容）。

5. **stop / end 清理 driver child**（design §5.4.5）
   - `stop()`（line 604）line 627 `this._sessionManager?.stop()` 已存在；确认 task-02 `SessionManager.stop()` 会 close 所有 provider driver handle（Codex app-server child），本任务不需在 daemon 层重复 kill；
   - session end（`onSessionEnd` → backend end_session）路径确认 task-02 `SessionManager.end()` close queue + driver handle；daemon 层无额外 child 引用持有，不需新增清理代码——但需在测试验证 Codex child 在 end/stop 后被释放（无僵尸进程）。

## 接口定义

### `_startInteractiveSession` 改动伪代码

```ts
private async _startInteractiveSession(leaseId, execPayload) {
  // ... 现有 sessionId/firstRunId/prompt/spec_root_map/cwd 校验不变 ...
  const provider = (execPayload.provider ?? 'claude') as 'claude' | 'codex';
+ const executablePath = this._agentPaths.get(provider) ?? '';
  // ...
- if (!pathToClaudeCodeExecutable) {
-   this._logger.error('interactive_claude_executable_not_found', {...});
+ if (!executablePath) {
+   this._logger.error(`interactive_${provider}_executable_not_found`, {
+     lease_id: leaseId, provider,
+     code: `${provider.toUpperCase()}_EXECUTABLE_NOT_FOUND`,
+   });
    return; // fail lease，不调 create
  }
  // ...
  await this._sessionManager.create({
    ..., provider,
-   pathToClaudeCodeExecutable,
+   pathToClaudeCodeExecutable: executablePath, // 字段名兼容，语义=provider executable
  });
}
```

### `_routeSessionResume` 改动（仅验证，无实质代码改动）

```ts
private async _routeSessionResume(raw) {
  // ...
  const provider =
    ((raw.provider as string | undefined) ?? 'claude') === 'codex' ? 'codex' : 'claude'; // 已存在，保留
  const record: PersistedSessionRecord = { ..., provider }; // agentSessionId=threadId（Codex），缺失则 line 1672 拒绝
  await this._sessionManager!.restoreAndReconnect(record); // task-02 按 record.provider 选 driver，不抛 UnsupportedProviderError
  await this._sessionManager!.markReconnected(sessionId);
}
```

### provider 归一化规则

- 入口 `_startInteractiveSession` / `_routeSessionResume`：`provider = (raw.provider ?? 'claude')`，仅接受 `'claude' | 'codex'`，其它值归一为 `'claude'`（保守，不因未知 provider 崩溃）；
- `agent-detector.ts` 已探测 codex 并 `this._agentPaths.set('codex', path)`（line 693），daemon 无需新增探测。

### executable 缺失处理

| provider | `_agentPaths.get(provider)` | 行为 |
| --- | --- | --- |
| claude | 有 path | 现有路径不变 |
| claude | 空 | 记 `interactive_claude_executable_not_found`，fail lease（现有 AC-07） |
| codex | 有 path | 走 Codex interactive 链路 |
| codex | 空 | 记 `interactive_codex_executable_not_found`，fail lease，不调 create |

## 边界处理

1. **Codex executable 不存在 → fail lease**：`_startInteractiveSession` 不调 `SessionManager.create`，记 `interactive_codex_executable_not_found`（provider-specific 错误码），backend 据 lease 超时 / WS 失活 / onSessionEnd 收 failed；daemon 主循环不崩。
2. **recovery 缺 threadId 不伪造**（D-007 重点）：`_routeSessionResume` 在 `agentSessionId` 空（line 1672）时 warn 丢弃、不 resume；daemon restart 读 sessions.json 的 Codex record 若 `agentSessionId` 为空，`validateRecord`（session-store-persistence.ts line 95）已丢弃该条；绝不伪造新 thread 避免历史串线。
3. **Claude 路径不回退**：`provider='claude'` 时 `executablePath = _agentPaths.get('claude')`，行为与改动前完全一致（仅变量名从 `pathToClaudeCodeExecutable` 改为 `executablePath`，入参字段名保留兼容）；现有 Claude interactive 测试全绿。
4. **child 释放**：Codex app-server child 由 `SessionManager.end()` / `stop()` / input queue close 统一 close（task-02/04 已实现 driver `close()`）；daemon 层不持有 child 引用，`stop()`（line 627 `sessionManager.stop()`）触发批量 close，测试验证无僵尸 codex 进程。
5. **recovery 失败标 failed**：`restoreAndReconnect` 对 Codex `thread/resume` 失败时（task-02/04 已实现）调 `onSessionEnd(failed)`，daemon `onSessionEnd` 透传 backend；daemon 不在 resume 路径 catch 吞错，让失败显式上报。
6. **stop 时清理**：`stop()` 已 `sessionManager.stop()`（line 627）+ `flush()`（line 636），Codex active session 内存态随进程退出丢失，backend lease 心跳兜底收口；不主动 end 所有 session 避免 shutdown 风暴（与 Claude 一致）。
7. **onTurnMessage 类型放宽兼容 Claude raw**：Codex flat message（`{event_type, content, metadata, session_id}`）直接经 `submitMessages` 透传；Claude SDK raw message（`{type:'assistant', message:{usage}}`）经 line 1139-1146 usage 提取后透传——放宽类型不改变任一 provider 的实际转发逻辑。
8. **未知 provider 归一为 claude**：`_agentPaths.get(unknownProvider)` 返回 undefined → 走 executable 缺失分支 fail lease，不因 provider 字符串异常崩溃 daemon。

## 非目标

- **不改 backend reopen**：`SessionService.reopen_session` provider gate 放开 Codex 留 task-07，本任务只保证 daemon resume 路径不拦 Codex。
- **不改 frontend**：`/runtimes` Codex 改走 interactive panel 留 task-08，本任务不碰 runtime-session-dialog。
- **不实现 driver 内部**：`CodexAppServerDriver` 的 `thread/start`/`turn/start`/`turn/completed`/approval/dialog 已在 task-04/05 实现，本任务只做 daemon → SessionManager → driver 的接线。
- **不新增 provider**：仅覆盖 `provider="codex"`，不引入第 3 个 provider。
- **不改 SessionManager 内部**：provider driver registry / restoreAndReconnect 路由已在 task-02 完成，本任务不重复改 session-manager.ts。

## 参考（现有 Claude 实现）

- `_startInteractiveSession`（daemon.ts line 1800-2012）：现有 Claude 完整实现，含 spec_root_map 翻译、cwd mkdir、buildSpawnEnv、tar pull、`SessionManager.create` 调用——本任务只改 line 1866 executable 取值 + line 1878-1886 错误码。
- `onTurnResult`（line 986-1088）：现有 Claude result 字段提取（subtype/is_error/total_cost_usd/usage），放宽类型后逻辑不变。
- `onTurnMessage`（line 1102-1162）：现有 Claude assistant usage 提取 + `submitMessages` 透传，放宽类型后逻辑不变。
- `_routeSessionResume`（line 1656-1700）：provider 归一化已存在（line 1681-1682），本任务验证无写死 Claude 残留。
- `stop()`（line 604-651）：已 `sessionManager.stop()` + `flush()`，Codex child 释放依赖 task-02 driver close。

## TDD 步骤

按「文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收」顺序：

1. **先写失败测试**（`sillyhub-daemon/tests/daemon-interactive-codex.test.ts` 新增）：
   - TC1：`_startInteractiveSession` 传 `provider='codex'` + `_agentPaths.get('codex')` 有值 → `SessionManager.create` 被调用且 `provider='codex'`、`pathToClaudeCodeExecutable=<codex path>`（mock SessionManager）；
   - TC2：`_startInteractiveSession` 传 `provider='codex'` + `_agentPaths` 无 codex → 不调 `create`，logger 收到 `interactive_codex_executable_not_found`，函数 return（lease fail）；
   - TC3：`_startInteractiveSession` 传 `provider='claude'`（或 undefined）→ 行为与改动前一致（Claude 回归，executable 取 `_agentPaths.get('claude')`）；
   - TC4：`onTurnMessage` / `onTurnResult` 传入 Codex flat message / driver result（非 SDK 类型）→ 不抛类型错，`submitMessages`/`notifyRunResult` 被调用；
   - TC5：`onTurnMessage` 传入 Claude raw assistant message（含 usage）→ usage 提取逻辑不变（回归）；
   - TC6：`_routeSessionResume` 传 `provider='codex'` + `agent_session_id=<threadId>` → `restoreAndReconnect` 被调用且 record.provider='codex'，不抛 `UnsupportedProviderError`；
   - TC7：`_routeSessionResume` 缺 `agent_session_id` → 不调 `restoreAndReconnect`，warn 丢弃（D-007 不伪造）；
   - TC8（session-store-persistence）：Codex record `agentSessionId=<threadId>` + `pathToClaudeCodeExecutable=<codex path>` → `validateRecord` 通过；缺 `agentSessionId` → 丢弃。

2. **跑测试确认失败**（实现未改）：
   ```bash
   pnpm --dir sillyhub-daemon test daemon-interactive-codex
   ```

3. **写实现**：按「实现要求」5 点改 cli.ts / daemon.ts / session-store-persistence.ts（注释）。

4. **跑测试确认通过**：
   ```bash
   pnpm --dir sillyhub-daemon test
   pnpm --dir sillyhub-daemon typecheck
   ```

5. **Claude 回归**：现有 `tests/interactive/**`、`tests/daemon-*.test.ts` 全绿，确认未回退。

## 集成验收

| AC | 覆盖 FR/D | 验证方法 | 通过标准 |
| --- | --- | --- | --- |
| AC-01 | FR-01, D-001, D-002 | 单测 TC1 + 手动：`/runtimes` Codex runtime 首条消息经 daemon `_startInteractiveSession(provider=codex)` 取 codex executable → `SessionManager.create` | `create` 收到 `provider='codex'` + codex executable path，Codex app-server `thread/start` 成功 |
| AC-02 | FR-05, D-002 | 单测 TC2 + 手动：codex CLI 未安装时 Codex runtime 发消息 | daemon 记 `interactive_codex_executable_not_found`，不调 create，backend lease 收 failed，前端显示 session 创建失败 |
| AC-03 | FR-03, D-003 | 单测 TC6 + 手动：Codex ended session reopen → backend session_resume → daemon `_routeSessionResume(provider=codex)` | `restoreAndReconnect` 按 codex driver resume（`thread/resume`），不抛 `UnsupportedProviderError`，session 切 active |
| AC-04 | FR-06, D-007 | 单测 TC7/TC8 + 手动：daemon restart 后 sessions.json 含 Codex record | 有 threadId 的 Codex record 正常 recover；缺 threadId 的 record 丢弃 + 标 failed，不伪造新 thread |
| AC-05 | FR-01, FR-03 | daemon restart recover 对 Codex 不抛 `UnsupportedProviderError`（design §11 验收标准） | recovery 完成或显式 failed，无 UnsupportedProviderError 异常 |
| AC-06 | D-001 | cli.ts grep 确认 `drivers: { claude, codex }` 注入 | SessionManager 构造含两个 provider driver |
| AC-07 | （回归） | 现有 Claude interactive 测试 + `onTurnMessage`/`onTurnResult` Claude raw 透传 | Claude create/inject/interrupt/end/reopen 全绿，行为不回退 |
| AC-08 | （清理） | 手动：Codex session end / daemon stop 后 `ps` 查 codex 进程 | 无僵尸 codex app-server 子进程 |
| AC-09 | （类型） | `pnpm --dir sillyhub-daemon typecheck` | 类型检查通过，onTurnMessage/onTurnResult 放宽后无 TS 报错 |

## 测试命令

```bash
# daemon 单测 + 类型检查
pnpm --dir sillyhub-daemon test
pnpm --dir sillyhub-daemon typecheck

# 聚焦本任务新增测试
pnpm --dir sillyhub-daemon test daemon-interactive-codex
pnpm --dir sillyhub-daemon test interactive
```

## 风险

| 风险 | 缓解 |
| --- | --- |
| onTurnMessage 类型放宽破坏 Claude raw 透传 | TC5 回归 + 现有 Claude interactive 测试全绿 |
| codex executable 探测在 CI 环境缺失导致 TC1 不可跑 | 测试用 mock `_agentPaths.set('codex', '/fake/codex')`，不依赖真实 codex CLI |
| SessionManager.stop() 未释放 Codex child（task-02 遗漏） | AC-08 手动验证 + 依赖 task-02 driver close 契约，发现问题回流 task-02 |
| resume 路径漏改残留写死 Claude | grep `restoreAndReconnect\|'claude'` daemon.ts 确认无硬编码 |
