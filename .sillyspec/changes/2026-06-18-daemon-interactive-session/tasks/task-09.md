---
id: task-09
title: sessionStore 磁盘持久化 + 重启 resume 恢复 + reconnecting 状态
wave: W3
priority: P1
depends_on: [task-03, task-06]
covers: [FR-08, D-003]
created_at: 2026-06-18 14:11:24
author: qinyi
---

# task-09 — sessionStore 磁盘持久化 + 重启 resume 恢复 + reconnecting 状态

> 设计依据：`../design.md` §5 Wave3 / §11 D-003 / FR-08 / §12 验收标准 7
> 计划依据：`../plan.md` task-09 行（W3 / P1 / 依赖 task-03, task-06）
> 真实源文件：
>   - `sillyhub-daemon/src/session-store.ts`（task-03 新建，本任务加 persist/restore）
>   - `sillyhub-daemon/src/task-runner.ts`（spawn + buildArgs，L423-430 已透传 resumeSessionId）
>   - `sillyhub-daemon/src/adapters/stream-json.ts`（buildArgs L207-232，L228 已 `--resume`）
>   - `sillyhub-daemon/src/adapters/json-rpc.ts`（codex，需补 thread/resume 路径）
>   - `sillyhub-daemon/src/config.ts`（`~/.sillyhub/daemon/` 目录 + loadConfig/saveConfig 模式）
>   - `backend/app/modules/agent/model.py`（task-01 新建 AgentSession，status 加 reconnecting 态）
> 参考实现：`C:\Users\qinyi\IdeaProjects\happy\packages\happy-cli\src\persistence.ts:401-441`（PersistedSession + 原子写）、`daemon/run.ts:661`（resumeSession）

## 目标

落地 design.md §5 Wave3 / D-003 / FR-08 / 验收标准 7：

- daemon 重启后内存 `sessionStore` 丢失的现状被打破（R-03）—— 持久化 + 恢复双链路建立。
- `active` 状态的会话重启后能自动 `reconnecting → 恢复`，claude 走 `--resume <agentSessionId>`、codex 走 `thread/resume`，历史上下文不丢（由 agent 自身会话持久化保证，daemon 仅透传 sessionId）。
- backend `AgentSession.status` 同步显示 `reconnecting`，前端（task-10）可见恢复进度。

**非目标**（不做）：

- 不做"断线重连同进程保活"（Wave1/2 已用长驻 spawn 解决，本任务只解决 daemon 进程退出/重启）。
- 不持久化 stdin 缓冲 / 未消费事件（agent 自身持久化语义负责，daemon 只透传 sessionId）。
- 不做 backend 侧的崩溃恢复（AgentSession 行在 daemon 重启期间仍是 active，daemon 重连后 backend 据其上报改 reconnecting→active；sessionStore 状态机内部自治）。
- 不引入加密（happy 的 encryptionKey 是 E2E 中转需要；本项目平台明文，仅持久化 sessionId 等非敏感元数据）。

## 前置依赖

- **task-03**：SessionStore 类已建立（`Map<sessionId, SessionState>`、`create/inject/interrupt/end/get`），child.stdin 长驻、跨 turn 复用、`result` 不 end stdin。本任务在此基础上加 `persist()` / `restore()` 两个方法 + 启动钩子。
- **task-06**：Wave1 端到端跑通（spike-01 R-01 铁证、空闲回收、end_session 统一入口），session 生命周期闭环已验证。task-09 不在 Wave1 之前介入，避免与核心交互未稳定时耦合。
- **task-01**：`agent_sessions` 表（含 `status` 字段：pending/active/reconnecting/ended/failed）+ `agent_session_id` 字段已迁移，本任务复用 `reconnecting` 态。
- **task-04 / task-02**：backend REST + WS 协议通道完备，daemon 重连后能上报 status 翻转。

## 涉及文件

| 操作 | 文件路径 | 改动要点 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/session-store.ts` | 新增 `persist()` / `restore()` / `_sessionFilePath` / `SessionPersistRecord`；`create/end` 触发 persist；启动调用 restore 重 spawn |
| 修改 | `sillyhub-daemon/src/daemon.ts` | daemon 启动流程（loadConfig 之后）调 `sessionStore.restore()`；新增 `_respawnSession(record)` 复用 task-runner buildArgs 路径 |
| 修改 | `sillyhub-daemon/src/adapters/json-rpc.ts` | 新增 `buildResumeHandshake(opts: { threadId, cwd, model })`：`thread/resume` JSON-RPC request（参考 happy `codexAppServerClient.ts:660`），替代 `thread/start` |
| 修改 | `sillyhub-daemon/src/task-runner.ts` | 重 spawn 走原 `_spawnAndStream` 路径；codex thread/resume 通过 `ctx.resumeSessionId` + adapter `buildResumeHandshake` 钩子分流 |
| 修改 | `sillyhub-daemon/src/types.ts` | `LeaseCtx` 增加 `isResume?: boolean` 标记（区分首次 spawn vs 重 spawn），仅 daemon 内部用 |
| 修改 | `backend/app/modules/agent/model.py` | AgentSession.status 枚举补 `reconnecting`（task-01 已规划，本任务消费） |
| 修改 | `backend/app/modules/daemon/service.py` | daemon 重连上报 status=reconnecting → active 翻转逻辑（`syncSessionStatus`） |
| 新增 | `sillyhub-daemon/src/session-store.test.ts` | vitest 单测：persist/restore mock fs + fakeChildProcess |
| 新增 | `sillyhub-daemon/test/fixtures/sessions.sample.json` | 落盘文件 schema 样例（契约测试） |

## 数据模型

### 落盘 schema（`~/.sillyhub/daemon/sessions.json`）

```jsonc
{
  "version": 1,
  "savedAt": "2026-06-18T14:11:24Z",
  "sessions": {
    "<agentSessionId-uuid>": {
      "agentSessionId": "<uuid>",
      "leaseId": "<uuid>",
      "provider": "claude",
      "agentInternalSessionId": "<claude session_id 或 codex thread_id>",
      "config": { "manual_approval": false, "model": "sonnet" },
      "status": "active",
      "turnCount": 3,
      "lastActiveAt": "2026-06-18T14:00:00Z",
      "savedAt": "2026-06-18T14:11:24Z"
    }
  }
}
```

字段说明：

- **顶层 `version`**：schema 版本号（类比 happy sessionsFile），未来字段演进用，本任务固定 `1`。
- **顶层 `savedAt`**：整文件最后写入时间，用于过期清理。
- **`sessions` 是 Map**（key = agentSessionId）：天然去重 + O(1) 查找，类比 happy `Record<string, PersistedSession>`。
- **`agentInternalSessionId`**：claude `session_id`（来自 system/result 事件累积）或 codex `thread_id`（来自 thread/start response）。**重 spawn 时透传**，是 resume 的唯一密钥。
- **不含**：child.stdin 引用、abortController、buffer 等运行时态（无法序列化、也不该跨进程）。
- **不含**：claimToken / encryptionKey（敏感 + 单次 lease 生命周期，重连走 backend 重新发 lease_start 拿新 token）。

### 内存态 ↔ 落盘态映射

| 内存 SessionState 字段 | 落盘 | 备注 |
|---|---|---|
| sessionId (= agentSessionId) | ✅ agentSessionId | 主键 |
| leaseId | ✅ leaseId | 重 spawn 用 |
| provider | ✅ provider | 选 adapter |
| agentInternalSessionId | ✅ | resume 密钥 |
| config | ✅ config | manual_approval / model |
| status | ✅ status | 仅 persist active；ended/failed 不落盘 |
| turnCount | ✅ turnCount | 统计 |
| lastActiveAt | ✅ lastActiveAt | 过期清理用 |
| child / stdin / adapter / abortController | ❌ | 运行时重建 |

## 实现步骤

### 步骤 1：SessionStore.persist() — active session 落盘

文件：`sillyhub-daemon/src/session-store.ts`

1. 新增常量 `SESSION_FILE_PATH = join(homedir(), '.sillyhub', 'daemon', 'sessions.json')`（沿用 `config.ts:40` `DEFAULT_CONFIG_DIR` 目录约定，复用 `loadConfig` 已确保目录存在）。
2. 新增 `SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000`（24h，类比 happy `persistence.ts:415` 14d；本项目 daemon 重启频率高，24h 足够）。
3. 新增方法 `async persist(): Promise<void>`：
   - 遍历 `this._store`（Map），过滤 `status === 'active'` 的条目（`ended` / `failed` 跳过，类比 happy 不持久化已结束 session）。
   - 序列化为 `SessionPersistFile` schema。
   - **原子写**（参考 happy `persistence.ts:436-441`）：先写 `<path>.tmp` → `fs.rename(tmp, path)`（Windows / POSIX 都原子，避免并发写半截文件）。
   - 异常吞掉 + `console.warn`（持久化失败不阻塞主流程，类比 happy try/catch return）。
4. `create(sessionId, ...)` 成功后异步触发 `persist()`（不 await，避免阻塞会话创建）。
5. `end(sessionId)` / 标记 `failed` 后同步触发 `persist()`（让 ended session 立即从磁盘移除，避免重启时误恢复）。
6. 每次 turn 完成（`result` 事件后）也触发一次 persist（更新 `turnCount` / `lastActiveAt`，类比 happy 在 webhook 时 persist）。
   - 节流：500ms 内多次 persist 合并为一次（避免高频写盘，用 `setTimeout` debounce）。

### 步骤 2：SessionStore.restore() — daemon 启动加载 + 重 spawn

文件：`sillyhub-daemon/src/session-store.ts` + `sillyhub-daemon/src/daemon.ts`

1. 新增方法 `async restore(spawner: SessionRespawner): Promise<void>`：
   - 读 `SESSION_FILE_PATH`（`existsSync` 兜底，文件不存在返回空，类比 happy `readPersistedSessions:417-419`）。
   - JSON.parse 失败 → warn + 返回空（不抛，类比 happy `return {}`）。
   - 过滤过期条目（`now - savedAt > SESSION_MAX_AGE_MS` 丢弃，类比 happy L426）。
   - 对每条 `status === 'active'` 的记录：
     - 内存 Map 创建占位 SessionState（`status: 'reconnecting'`，无 child/stdin）。
     - 调 `spawner.respawn(record)` 异步重 spawn（不阻塞 restore 循环，逐个串行避免并发风暴）。
2. daemon.ts 启动流程（loadConfig 之后、connectWS 之前）：
   ```ts
   await this.sessionStore.restore({
     respawn: (record) => this._respawnSession(record),
   });
   ```
3. daemon.ts 新增 `_respawnSession(record: SessionPersistRecord)`：
   - 构造 `LeaseCtx`：复用 record.leaseId / provider / config.model / agentInternalSessionId（填到 `resumeSessionId`）/ `isResume: true` 标记。
   - 调 `taskRunner.runLease(ctx)` —— **复用 Wave1 完全相同的 spawn 路径**（task-runner.ts:288 `runLease`），不新增 spawn 实现。
   - 重 spawn 成功（子进程 spawn 完成 + claude system 事件 / codex thread/start response 到达）→ 内存 status 改 `active`，backend 上报 active。
   - 重 spawn 失败（spawn ENOENT / agent crash）→ 内存 status 改 `failed`，backend 上报 failed，从磁盘移除该条目。
4. **超时保护**：单个 session 重 spawn 等待 `SESSION_RECONNECT_TIMEOUT_MS = 30_000`（30s），未收到首条事件（claude system.init / codex thread/start response）→ 标 failed。
   - 实现方式：`_respawnSession` 内 `Promise.race([runLease(...), timeoutReject])`，超时 kill child。

### 步骤 3：claude 重 spawn — `--resume <agentSessionId>` 路径

文件：`sillyhub-daemon/src/task-runner.ts`（无需新增，**完全复用**）+ `stream-json.ts`（无需新增）

- task-runner.ts L423-430 已经透传 `effectiveCtx.resumeSessionId` 到 `adapter.buildArgs`。
- stream-json.ts L228 `if (opts?.resumeSessionId) args.push('--resume', opts.resumeSessionId)`。
- 重 spawn 时 daemon.ts `_respawnSession` 把 `record.agentInternalSessionId` 填到 `ctx.resumeSessionId`，链路自动打通。
- **首 prompt 处理**：重 spawn 不需要写新 prompt（claude `--resume` 会恢复对话上下文，等用户下一条 inject）。task-runner.ts:769-795 的 stdin prompt 写入分支需在 `ctx.isResume === true` 时跳过（仅 claude；codex 见步骤 4）。
  - 修改 `task-runner.ts:769`：`if (!adapter.buildHandshake && !ctx.isResume)` 跳过 prompt 写入。
- **result 不结束会话**：Wave1 已经做（`result` 不 end stdin），重 spawn 后 agent 收到 `--resume` 后处于等待新输入态，符合预期。

### 步骤 4：codex 重 spawn — `thread/resume` JSON-RPC 路径

文件：`sillyhub-daemon/src/adapters/json-rpc.ts` + `sillyhub-daemon/src/task-runner.ts`

1. json-rpc.ts 新增方法 `buildResumeHandshake(opts: { threadId, cwd, model? }): string[]`：
   - 参考 happy `codexAppServerClient.ts:660 resumeThread` + `:687 this.request('thread/resume', params)`。
   - 序列（替代现有 `buildHandshake` 的 `thread/start`）：
     ```jsonc
     // 1. initialize（同首次）
     { "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "clientInfo": {...} } }
     // 2. notifications/initialized（同首次）
     { "jsonrpc": "2.0", "method": "notifications/initialized" }
     // 3. thread/resume（替代 thread/start）
     { "jsonrpc": "2.0", "id": 2, "method": "thread/resume", "params": { "threadId": "<record.agentInternalSessionId>" } }
     ```
   - `thread/resume` response 含 `result.thread.id`（理论上等于传入 threadId），TaskRunner 现有 L1009-1045 检测 `id === 2 && msg.result.thread.id` 后自动触发 `buildTurnStart` —— **但重 spawn 不需要立刻发 turn/start**（等用户下一条 inject）。
2. task-runner.ts L801 handshake 分支：
   ```ts
   const handshake = ctx.isResume && adapter.buildResumeHandshake
     ? adapter.buildResumeHandshake({ threadId: ctx.resumeSessionId!, cwd: opts.cwd, model: ctx.model })
     : adapter.buildHandshake({ cwd: opts.cwd, prompt, model: ctx.model });
   ```
3. task-runner.ts L1009 turn/start 自动触发分支：`if (!ctx.isResume && adapter.buildTurnStart && ...)` —— 重 spawn 跳过自动 turn/start，等 inject。
4. codex `thread/resume` 失败（thread 不存在 / 已过期，codex 返回 error response -32600/-32000）→ TaskRunner 现有 `parseResponse` 错误分支（L276-293）产 error event → `_spawnAndStream` 标 failed → 重 spawn 失败路径触发。

### 步骤 5：AgentSession.status 加 reconnecting 态

文件：`backend/app/modules/agent/model.py`（task-01 已建表，本任务消费 `reconnecting` 值）+ `backend/app/modules/daemon/service.py`

1. task-01 的 `AgentSession.status` 字段注释已经包含 `reconnecting`（design.md §8.1 表已列），本任务**不改 schema**，仅消费。
2. service.py 新增方法 `mark_session_reconnecting(session_id)` / `mark_session_active(session_id)`：
   - daemon 重连首条 heartbeat / WS 重连事件 → backend 翻所有该 runtime 名下 active session 为 reconnecting。
   - daemon 重 spawn 成功上报 → 翻回 active。
3. WS / REST 端点（task-04 已建）：daemon 通过新增 `daemon:session_status` 消息上报 status 翻转，backend 据此 UPDATE。
   - 协议常量加到 `protocol.ts` MSG 字典（task-02 已留扩展位）。
4. 前端（task-10）订阅 session SSE 看到 reconnecting → active 状态切换，显示恢复中提示。

### 步骤 6：backend 同步 reconnecting / active 状态

文件：`backend/app/modules/daemon/service.py` + `ws_hub.py`

- daemon 启动 restore 阶段，对每条 reconnecting session：
  - 上报 `daemon:session_status { session_id, status: 'reconnecting' }` → backend UPDATE。
- 重 spawn 成功（首条 system/turn 事件到达）：
  - 上报 `daemon:session_status { session_id, status: 'active' }` → backend UPDATE + publish SSE。
- 重 spawn 失败：
  - 上报 `daemon:session_status { session_id, status: 'failed', error: ... }` → backend UPDATE。

## 完成标准（验收 7）

> **daemon 重启后 active 会话 reconnecting → 恢复，历史上下文不丢**。

具体拆解为可测条目（对照 design.md §12 验收 7）：

- [ ] **AC-7.1**：daemon 跑着一个 claude active session（已 ≥1 turn），kill daemon 进程 → 重启 daemon → 30s 内该 session 在 backend `AgentSession.status` 从 active → reconnecting → active 翻转。
- [ ] **AC-7.2**：重启后通过 quick-chat 注入新 prompt，agent 响应**引用了重启前的对话内容**（claude `--resume` 恢复上下文铁证）。
- [ ] **AC-7.3**：codex 同理（thread/resume 恢复 thread_id，新 turn/start 引用前文）。
- [ ] **AC-7.4**：重启前 `ended` / `failed` 的 session 不被恢复（磁盘已移除，restore 跳过）。
- [ ] **AC-7.5**：超过 24h 的 session 记录（人工改 savedAt 模拟）不被恢复（过期清理）。
- [ ] **AC-7.6**：磁盘 `sessions.json` 损坏（手工写无效 JSON）→ daemon 启动 warn 但不崩溃，空 sessionStore 继续运行。
- [ ] **AC-7.7**：并发 persist（debounce 后）+ 重 spawn 不产生半截 JSON（原子 rename 验证）。
- [ ] **AC-7.8**：现有批处理 lease（kind=batch）行为零变化（兼容，验收 8）。

## 测试要点

### 单元测试（`sillyhub-daemon/src/session-store.test.ts`，vitest）

1. **persist 基本路径**：
   - mock `fs/promises.writeFile` + `rename`，create 一个 active session → 调 persist → 断言 `.tmp` 写入内容 schema 正确（含 agentSessionId/leaseId/provider/agentInternalSessionId/config）。
   - 断言 ended / failed session 不进 sessions.json。
2. **persist 原子性**：
   - mock rename 抛 EBUSY → persist 不阻塞、warn 一次、原文件不动。
3. **restore 基本路径**：
   - mock `fs/promises.readFile` 返回固定 JSON → 调 restore(spawner) → 断言 spawner.respawn 被调用 N 次（N = active session 数），每次传入正确 record。
4. **restore 过期清理**：
   - fixture 含 `savedAt = now - 25h` → restore 跳过，spawner 不被调用。
5. **restore 文件不存在**：
   - mock existsSync = false → restore 返回 undefined，spawner 不被调用，不抛错。
6. **restore JSON 损坏**：
   - mock readFile 返回 `'{invalid'` → restore warn + 返回 undefined，不抛。
7. **debounce**：
   - 500ms 内连续 5 次 persist → writeFile 只调用 1 次。
8. **claude buildArgs --resume**（间接，已有 stream-json.test.ts 覆盖，仅 sanity）：传 resumeSessionId 断言 args 含 `--resume <id>`。

### 集成测试（`sillyhub-daemon/test/integration/resume.test.ts`）

1. **claude resume e2e**：
   - 启动 daemon + mock HubClient + FakeClaudeChild（吐 system/session_id=abc + result）。
   - 创建 session、跑一轮 → kill daemon（in-process：stop sessionStore、丢弃 child）。
   - 重启 daemon（new SessionStore + new TaskRunner，复用同 SESSION_FILE_PATH）。
   - 断言 restore 触发 respawn，FakeClaudeChild 被以 `--resume abc` spawn。
   - 模拟 inject 新 prompt → FakeClaudeChild 吐新 result → 通过。
2. **codex thread/resume e2e**：
   - 同上，FakeCodexChild 吐 thread/start response（首次）/ 校验 daemon 发 `thread/resume`（重 spawn）。
3. **超时 failed 路径**：
   - restore 后 FakeClaudeChild 不吐任何事件 30s → session 标 failed、backend 收到上报。

### backend 测试（`backend/tests/modules/daemon/test_session_status.py`）

1. daemon 上报 `session_status reconnecting` → DB AgentSession.status = 'reconnecting'。
2. 上报 `session_status active` → DB 翻 active + SSE publish。
3. 上报 `session_status failed` → DB 翻 failed。

## 风险与注意

| 风险 | 等级 | 应对 |
|---|---|---|
| **resume 依赖 agent 自身会话持久化**：claude `--resume <id>` 需要 claude CLI 把 session 存在 `~/.claude/` 或云端；codex thread 持久化在 codex 服务端。daemon 重启后 agent 内部会话已被清理 → resume 失败 | P1 | 重 spawn 失败时（claude exit 非零 / codex thread/resume error response）→ session 标 failed、backend 翻 failed、前端提示"会话已过期，请新建"。**daemon 不负责保活 agent 内部会话**（design.md §3 非目标）。集成测试用 FakeChild 模拟失败路径。 |
| **磁盘文件并发写**：debounce 合并 + 原子 rename 已经规避大部分；但极端场景（daemon 同时被 SIGKILL 在 rename 中间）→ `.tmp` 残留 | P2 | restore 时 readFile 主路径失败 → 尝试读 `.tmp`（半截但通常 JSON 仍合法）→ 仍失败则 warn + 空启动。daemon 启动时清理残留 `.tmp`。 |
| **reconnecting 超时**：agent 重 spawn 后 hang（claude 等输入但不吐 system 事件 / codex thread/resume response 漏发）→ 永远 reconnecting | P1 | `SESSION_RECONNECT_TIMEOUT_MS = 30_000` 硬超时（步骤 2）→ 标 failed。claude `--resume` 后实测会立刻吐 system.init 事件，超时基本不会触发；codex thread/resume response 必回。 |
| **AgentSession 表 lease 状态**：重 spawn 用原 leaseId 还是新申请 lease？原 lease 在 backend 仍是 active（design.md §8.5 interactive lease 不过期），但 daemon 进程已重启 → backend 视角 lease 仍属本 runtime | P1 | **复用原 leaseId**（不新申请），daemon WS 重连后 backend 识别该 lease 仍归属本 runtime_id（task-04 WS 重连逻辑已就绪）。若 backend 检测 lease 已被其他 daemon 抢占（极少见）→ 重 spawn 失败、标 failed。 |
| **sessionId 术语碰撞**：`agentInternalSessionId`（claude session_id / codex thread_id）vs `AgentSession.id`（本平台 uuid）vs 现有 `AgentRun.session_id`（quick-chat-multiturn 的 claude resume id） | P2 | design.md D-001 / R-05 已规范。落盘字段显式命名 `agentInternalSessionId`，LeaseCtx 仍用 `resumeSessionId`（task-runner 既有字段），不新增混淆。 |
| **重 spawn 时的 workspace / CLAUDE.md**：task-runner.runLease 会重跑 prepareWorkspace + 写 CLAUDE.md，重 spawn 时这是冗余但无害 | P3 | 接受冗余（prepareWorkspace 已 idempotent，git mirror 已存在则跳过 clone；CLAUDE.md 覆盖写一致）。可在 ctx 透传 `skipWorkspaceInit: true` 跳过（YAGNI，先不做）。 |
| **持久化隐私**：sessions.json 含 agentSessionId / leaseId（uuid，非敏感）+ provider/model（非敏感）。无 token / encryptionKey | P3 | 文件权限 0600（参考 credential.ts 模式）；不入日志。 |

## 自审

- ✅ **覆盖 design.md**：§5 Wave3 三条（磁盘持久化 / 重 spawn / reconnecting 态）全部对应步骤 1/2/3-4/5；D-003（Wave1/2 不恢复，Wave3 做）由 depends_on task-03/06 保证前置；FR-08 由 AC-7.1~7.3 覆盖；验收 7 由 AC-7.1~7.8 拆解。
- ✅ **真实代码依据**：
  - task-runner.ts:423-430 `buildArgs({ resumeSessionId })` 透传链路真实存在。
  - stream-json.ts:228 `--resume` 已支持。
  - json-rpc.ts:159 `buildHandshake` 模式可复用，新增 `buildResumeHandshake` 同构。
  - config.ts:40 `DEFAULT_CONFIG_DIR` + loadConfig/saveConfig fs/promises 模式可参照。
  - happy persistence.ts:401-441 `PersistedSession` + 原子写 + 过期清理参考实现完备。
  - happy daemon/run.ts:661 `resumeSession` 模式（spawnTrackedHappyProcess 复用 spawn）参考。
- ✅ **YAGNI**：不做加密、不做 backend 崩溃恢复、不做跨 daemon 迁移、不做 stdin 缓冲持久化（agent 自身负责）。
- ✅ **复用 Wave1**：重 spawn 100% 复用 `taskRunner.runLease` + `_spawnAndStream`，不新增 spawn 实现，仅通过 `ctx.isResume` 标记分支（claude 跳过 prompt、codex 用 thread/resume 替代 thread/start）。
- ✅ **失败兜底**：重 spawn 失败 → session 标 failed（不卡 reconnecting）；磁盘损坏 → 空启动（不崩）；agent 内部会话过期 → 用户友好提示（不静默）。
- ✅ **测试可测**：单测 mock fs + fakeChild；集成测试 kill/restart in-process；backend pytest DB 翻转。
