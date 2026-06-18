---
author: qinyi
created_at: 2026-06-18T22:41:08
change: 2026-06-18-daemon-interactive-session
id: task-10
title: "resume 持久化 + 崩溃恢复（SDK 自动持久化 + query({resume}) + reconnecting）"
wave: W5
priority: P1
estimated_hours: 14
depends_on: [task-04, task-05]
blocks: []
requirement_ids: [FR-08]
decision_ids: [D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/src/interactive/session-store-persistence.ts
  - sillyhub-daemon/src/interactive/types.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/interactive/session-store-persistence.test.ts
  - sillyhub-daemon/tests/interactive/session-recovery.test.ts
  - sillyhub-daemon/tests/interactive/daemon-recovery-boot.test.ts
  - backend/app/modules/daemon/model.py
  - backend/app/modules/daemon/service.py
---

# task-10：resume 持久化 + 崩溃恢复（SDK 自动持久化 + query({resume}) + reconnecting）

> v3 重做。依据 `design.md` §5 Wave3、§8.1 status（reconnecting）、§10 R-cwd / R-03；`requirements.md` FR-08；`decisions.md` D-003@v1；`spike-02-architecture-validation.md` §3.7 D3 实测。
>
> **v2→v3 关键差异**：v2（旧 task-09，废弃）每 turn 独立 spawn + `--resume`，崩溃后下一 inject 才重 spawn；**v3 依赖 SDK 自动持久化**——`@anthropic-ai/claude-agent-sdk` 在每个 query 跑完后把 session 落盘到 `~/.claude/projects/<encoded-cwd>/<agent_session_id>.jsonl`（spike D3 实测），daemon 不再自己实现 jsonl 写入，只持久化元数据（session_id / lease_id / agent_session_id / cwd）；崩溃恢复用 `query({ options: { resume: agent_session_id } })` 在**还原的 cwd** 下重建上下文（spike D3 跨进程正确回忆 `ZEBRA-742`）。
>
> **D-003@v1 分阶段**：Wave1/2（task-04/07/08）崩溃 = failed（不恢复）；**Wave3（本任务）才接 resume**。本任务为 daemon 侧恢复的唯一业务入口，task-04 的 SessionManager 提供 `agentSessionId` 写入点，task-05 的 backend service 提供崩溃 currentRun 收敛与 reconnecting→active 状态流转，本任务把二者串成完整恢复链路。

## 1. 目标与硬约束

1. 新增 daemon `src/interactive/session-store-persistence.ts`：把 SessionManager 内存 `SessionStore` 中可恢复的 active session 元数据原子持久化到 `~/.sillyhub/daemon/sessions.json`；崩溃后启动时加载并还原。
2. daemon 启动顺序：load config → `sessionStorePersistence.load()` → 对每条记录向 backend 发 `recover_session_after_daemon_restart`（收敛崩溃 currentRun = failed，session 置 reconnecting）→ `SessionManager.restoreAndReconnect`（用 `query({resume})` 在固定 cwd 重启 driver）→ reconnecting → active。
3. **恢复期间不 spawn 旧进程、不 attach 旧 Query 句柄**：旧 Query 句柄不可序列化、不可恢复；恢复 = 用持久化 `agent_session_id` 调 `ClaudeSdkDriver.start(input, { resume: agent_session_id, cwd })` 启动**新** Query（spike D3 跨进程 resume）。
4. **固定 / 还原 cwd**：SessionState 在 task-04 已固定 `cwd`；持久化记录含 cwd；恢复时 driver 必须用记录 cwd，不接受运行时变更（R-cwd，spike D3 按 cwd 分目录，cwd 不一致 SDK 找不到 `~/.claude/projects/<encoded-cwd>/` 下的 jsonl → onError → failed）。
5. `agent_sessions.status` 增 `reconnecting`（task-02 已建 status 字段，task-05 的 ACTIVE_SESSION_STATUSES 已含 reconnecting）：崩溃时 backend 先写 reconnecting，恢复成功写 active，恢复失败（cwd 不一致 / agent_session_id 缺失 / SDK jsonl 缺失）写 failed。
6. backend 是 session/run/lease 状态真相；daemon `sessions.json` 只是恢复索引——文件与 backend 不一致时以 backend 为准（rejected → daemon 删记录不复活）。
7. batch lease 零影响：sessions.json 只写 interactive session；batch lease 不落盘、不进 recovery endpoint（FR-09 守门）。
8. Wave1/2 行为不变：本任务未合并前，daemon 崩溃 = backend 把 active session 标 failed（task-05 默认路径），不进入本任务的 reconnecting 分支。本任务合并后崩溃才走 reconnecting。

## 覆盖来源

| 来源 | 要求 / 决策 | 本任务落实 |
|---|---|---|
| `plan.md` task-10 | Wave5 P1，depends_on=[task-04, task-05]，blocks=[]；覆盖 FR-08 / D-003@v1 | SessionStore 持久化 + 启动加载 + query resume |
| FR-08 | daemon 重启加载元数据；currentRun 标 failed；session reconnecting→active；下次 inject 用 `query({resume:agent_session_id})` 恢复，固定 cwd，上下文不丢 | §4 持久化 schema + §5 启动恢复流程 + §6 resume query |
| D-003@v1 | Wave1/2 崩溃 = failed；Wave3 新增 persist/restore + agent_sessions.status reconnecting | §8 非目标（Wave1/2 不恢复）+ §5 reconnecting 状态流转 |
| `design.md` §5 Wave3 | SDK 自动持久化 `~/.claude/projects/<encoded-cwd>/<sid>.jsonl`；daemon SessionStore 持久化元数据；崩溃 currentRun failed、session reconnecting；inject 用 `query({resume})` 恢复（固定 cwd） | §3 文件边界 + §4 schema（元数据不含 SDK jsonl，靠 SDK 自动管理）|
| `design.md` §8.1 | status: pending/active/reconnecting/ended/failed | §5 状态流转（reconnecting 唯一新增分支）|
| `design.md` §10 R-cwd | SDK resume 按 cwd 分目录，cwd 不一致 resume 失败 | §4 schema 含 cwd；§6 resume 还原 cwd；§7 边界 1 |
| `design.md` §10 R-03 | daemon 重启 session 内存丢失（Wave1/2）；Wave3 持久化 | §8 非目标 + §5 持久化 |
| `spike-02 §3.7 D3` | SDK **自动持久化** session 到 `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`；新 node 进程 `query({options:{resume:sessionId}})` 恢复，正确回忆 `ZEBRA-742`，session_id 匹配；支撑 Wave3（daemon 只需记 session_id + 固定/还原 cwd） | §6 resume query 调用 + §4 daemon 只持久化元数据 |
| task-04（SessionManager / ClaudeSdkDriver） | SessionState 固定 cwd、driver.start({resume}) 已声明（StartOptions.resume）、agentSessionId 由 onMessage(system/init) 写入 | 本任务接住：启动恢复时调 driver.start({resume:agentSessionId, cwd}) |
| task-05（backend session service） | `end_session` 单一收口；ACTIVE_SESSION_STATUSES 含 reconnecting | 本任务新增 `recover_session_after_daemon_restart` 入口（独立于 end_session，不复用）|

## 2. 真实现状与约束

实现前必须用 `rg` / Read 二次核对，源码变化则先改本任务文档再写代码：

| 事实 | 当前源码锚点 | 本任务用法 |
|---|---|---|
| daemon 配置目录常量 | `sillyhub-daemon/src/config.ts`：`DEFAULT_CONFIG_DIR = ~/.sillyhub/daemon`（terminal-observer.ts:31 / cli.ts:60 引用） | sessions.json 放 `join(DEFAULT_CONFIG_DIR, 'sessions.json')` |
| SessionManager 内存 store | task-04 `src/interactive/session-manager.ts`：`private readonly _store = new Map<string, SessionState>()`；`SessionState` 含 sessionId/leaseId/agentSessionId?/cwd/provider/status/lastActiveAt | 本任务在 SessionManager 加 `snapshot()/restore()/markReconnected()`；不改既有 create/inject/interrupt/end |
| ClaudeSdkDriver.start resume | task-04 `StartOptions extends ClaudeSdkDriverOptions { resume?: string }`；driver 内 `sdkQuery({ prompt, options: { ..., resume: opts.resume } })` | 恢复时 `driver.start(freshInputQueue, { ...opts, resume: agentSessionId })` |
| agentSessionId 写入点 | task-04 SessionManager `_onMessage`：识别 `msg.type==='system' && msg.subtype==='init'` 写 `state.agentSessionId` | 持久化必须等 agentSessionId 写入后；首 turn 未拿到 agentSessionId 崩溃不可恢复（边界 2）|
| backend session service | task-05 `service.py::create_session / inject_session / interrupt_session / end_session`；`ACTIVE_SESSION_STATUSES = {"pending","active","reconnecting"}` | 本任务新增 `recover_session_after_daemon_restart`；不修改既有 4 方法 |
| backend AgentSession status | task-02 `agent_sessions.status: String(20) default="pending"`；reconnecting 在 design §8.1 已规划，task-05 ACTIVE_SESSION_STATUSES 已含 | 本任务 service 层写 reconnecting（无需迁移，status 是 String 自由值）|
| daemon WS 控制消息路由 | task-04 `daemon.ts:_handleWsMessage` 已 case `SESSION_INJECT/INTERRUPT/END` | 恢复后 SESSION_INJECT 复用既有路由（resume Query 已在跑，inject push 到 InputQueue 即续轮）|
| SDK jsonl 自动持久化 | spike D3 实测：`~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`，SDK 自动写，daemon 不管理 | daemon 不读不写该文件；resume 靠 SDK 内部加载 |
| daemon 启动入口 | `sillyhub-daemon/src/daemon.ts`（main 构造 Daemon、启动三循环） | 在三循环（heartbeat/poll/ws）启动前插入 recovery 编排 |

## 3. 修改文件

| 操作 | 文件 | 责任 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/interactive/session-store-persistence.ts` | sessions.json schema 校验、原子写、串行化、损坏隔离；load/save/quarantine |
| 修改 | `sillyhub-daemon/src/interactive/session-manager.ts` | 加 `snapshotPersistable()/restoreAndReconnect()/markReconnected()`；create/inject/interrupt/end/onResult/onMessage 排队 flush；end/fail 删记录 |
| 修改 | `sillyhub-daemon/src/interactive/types.ts` | `PersistedSessionRecord` / `PersistedSessionFile` / `SessionStorePersistence` 接口 |
| 修改 | `sillyhub-daemon/src/daemon.ts` | 启动顺序编排：load → recover → restoreAndReconnect → loops；构造 SessionManager 时注入 SessionStorePersistence |
| 新增 | `sillyhub-daemon/tests/interactive/session-store-persistence.test.ts` | 文件 schema、原子写、串行写、损坏隔离、0o600 |
| 新增 | `sillyhub-daemon/tests/interactive/session-recovery.test.ts` | snapshot/restore/markReconnected；恢复期 spawn=0；resume query 用 agent_session_id + cwd |
| 新增 | `sillyhub-daemon/tests/interactive/daemon-recovery-boot.test.ts` | 启动编排顺序、单项失败隔离、backend rejected 删记录、loops 前完成 |
| 修改 | `backend/app/modules/daemon/service.py` | 新增 `recover_session_after_daemon_restart`（收敛 currentRun、reconnecting→active、token 旋转） |
| 修改 | `backend/app/modules/daemon/model.py` | 若 task-02 未补则在此确认 status String(20) 可含 reconnecting（无 schema 改动，仅注释/常量） |

不得修改：task-04 的 `claude-sdk-driver.ts`（StartOptions.resume 已存在）、`input-queue.ts`、task-05 的 4 个 session REST 方法、task-06 的 SSE、task-08 的 canUseTool、`task-runner.ts`、`protocol.ts`、frontend、SDK 自动持久化的 jsonl 文件。

## 4. 持久化数据与接口（搬砖级）

### 4.1 磁盘 schema（`interactive/types.ts`）

```typescript
export const SESSION_FILE_VERSION = 1 as const;
export const DEFAULT_SESSION_FILE = join(DEFAULT_CONFIG_DIR, 'sessions.json');

export interface PersistedSessionRecord {
  sessionId: string;          // agent_sessions.id（backend 实体）
  leaseId: string;            // interactive lease.id（长生命周期）
  agentSessionId: string;     // SDK session_id（spike D3 resume 用，必需非空）
  cwd: string;                // 固定工作目录（resume 按 cwd 分目录，R-cwd）
  provider: 'claude' | 'codex';
  currentRunId?: string;      // 崩溃时可能在执行的 AgentRun.id（恢复对账用，恢复成功后清空）
  turnCount: number;
  lastActiveAt: number;       // epoch ms
  model?: string;             // 恢复 driver 用（可空）
  pathToClaudeCodeExecutable?: string; // 恢复 driver 用（D-009，可空则恢复时重探）
}

export interface PersistedSessionFile {
  version: typeof SESSION_FILE_VERSION;
  savedAt: string;            // ISO 时间戳
  sessions: PersistedSessionRecord[];
}
```

持久化规则（对齐 FR-08 + spike D3）：

- 仅写可恢复的 `active | running` session；`ended | failed | reconnecting` 不写（reconnecting 是恢复中间态，重启时不应残留）。
- `agentSessionId` 必须非空才作为可恢复记录（首 turn system/init 未拿到就崩溃 → 不可恢复，backend 收 failed，文件不写该 session）。
- `currentRunId` 仅重启对账用；恢复成功（reconnecting→active）后必须清空并再次 flush。
- 禁止写：claim token、API key / credential、prompt 内容、agent 输出、SDK Query 句柄、InputQueue、child/stdin/adapter（均不可序列化且敏感）。
- `pathToClaudeCodeExecutable` 可空：恢复时若空则重新走 agent-detector 探测（D-009）；非空直接复用。
- SDK 自动持久化的 `~/.claude/projects/<encoded-cwd>/<sid>.jsonl` **不由 daemon 管理**：daemon 只持久化元数据索引，jsonl 由 SDK 自己写（spike D3）。

### 4.2 持久化端口（`interactive/session-store-persistence.ts`）

```typescript
export interface SessionStorePersistence {
  load(): Promise<PersistedSessionRecord[]>;
  save(records: readonly PersistedSessionRecord[]): Promise<void>;
  quarantine(reason: string): Promise<void>;
}

export class JsonSessionPersistence implements SessionStorePersistence {
  constructor(filePath: string = DEFAULT_SESSION_FILE);
  load(): Promise<PersistedSessionRecord[]>;
  save(records: readonly PersistedSessionRecord[]): Promise<void>;
  quarantine(reason: string): Promise<void>;
}

export class SessionPersistenceError extends Error {
  readonly code: 'SESSION_FILE_CORRUPT' | 'SESSION_FILE_VERSION' | 'SESSION_FILE_IO';
}
```

实现要点：

- `save` 用同目录临时文件 + `writeFile` + `rename` 原子替换；单一 promise queue 串行写，保证写入顺序与最终一致性（不用 debounce，避免丢最后一次状态变化）。
- 支持的平台写权限 `0o600`（Windows chmod 无效但保留调用，参照 `credential.ts:55` credentials.json 的 0600 模式）。
- `load` 做 version / UUID 字符串 / provider 枚举 / 有限数字 / cwd 非空校验；整文件无法 parse 时重命名为 `sessions.json.corrupt-<epoch>` 后返回空集合（不抛、不崩 daemon）。
- version 不支持 → `quarantine('unsupported_version')` 后返回空集合。
- 文件不存在 → 空数组（不 warn、不创建文件）。

### 4.3 SessionManager 扩展（`interactive/session-manager.ts`）

在 task-04 既有 create/inject/interrupt/end/fail 基础上加：

```typescript
export interface SessionManagerDeps {
  driver: ClaudeSdkDriver;
  persistence: SessionStorePersistence;   // 本任务新增注入
  onTurnResult: (sessionId: string, runId: string, result: SDKResultMessage) => void | Promise<void>;
  onTurnMessage: (sessionId: string, runId: string, msg: SDKMessage) => void | Promise<void>;
  onSessionEnd: (sessionId: string, status: SessionStatus) => void | Promise<void>;
}

export class SessionManager {
  /** 快照可恢复记录（active/running，agentSessionId 非空）。供 flush 持久化。 */
  snapshotPersistable(): PersistedSessionRecord[];

  /**
   * 恢复单条记录：用 agentSessionId 调 driver.start({resume}) 在固定 cwd 重启 driver。
   * 流程：
   *   1. 构造 fresh InputQueue（新对象，不恢复旧队列）。
   *   2. state = { sessionId, leaseId, agentSessionId: record.agentSessionId, cwd: record.cwd,
   *      status:'reconnecting', currentRunId: undefined, inputQueue, lastActiveAt, provider }
   *      写入 _store。
   *   3. query = driver.start(inputQueue, {
   *        pathToClaudeCodeExecutable: record.pathToClaudeCodeExecutable ?? detect(),
   *        cwd: record.cwd,            // R-cwd：必须用记录 cwd
   *        env: { ...process.env },    // spike H1
   *        model: record.model,
   *        resume: record.agentSessionId,  // spike D3 跨进程 resume
   *      })。
   *   4. fire driver.consume(query, { onResult, onMessage, onError })（同 create，长生命周期协程）。
   *   5. driver.start 抛错（executable 缺失 / cwd 不一致 / SDK jsonl 缺失）→ onError → status=failed，
   *      onSessionEnd(failed)，记录从 _store 移除。
   *
   * 注意：restoreAndReconnect 不 push 任何 SDKUserMessage——driver resume 后 SDK 自身不立即产 turn，
   * 等下一次 SESSION_INJECT 才 push 首条恢复后 prompt（spike D3：resume query 不带 prompt 时 SDK 空闲）。
   * 调用方在 backend recover 成功后调 markReconnected 把 status 切 active。
   */
  restoreAndReconnect(record: PersistedSessionRecord): Promise<void>;

  /** reconnecting → active；flush。只能在 restoreAndReconnect 之后调。 */
  markReconnected(sessionId: string): Promise<void>;

  /** 强制把当前内存 store 落盘（daemon stop 用，SIGKILL 兜底靠上次原子快照）。 */
  flush(): Promise<void>;
}
```

排队 flush 时机（复用 task-04 的状态变更点，本任务在每个变更后排队一次 save）：

- `create` 成功 + 首条 system/init 写入 agentSessionId 后 → flush。
- `inject` push 后（turn 开始）→ flush（含 currentRunId）。
- `_onResult` 收尾后（currentRunId 清空）→ flush。
- `interrupt` driver.interrupt 调用后 → flush（currentRunId 仍在，等 result 收尾）。
- `end` / `fail` → 从记录移除后 flush。
- `markReconnected` → flush（currentRunId 已清空）。

约束：

- `_store` 仍是 `Map<string, SessionState>` 单例；不同 session 并发跑（spike H2 跨 session 无关）。
- 恢复后 state 持有的 `query` 是**新** SDK Query（spike D3 跨进程 resume），不引用崩溃前的旧句柄（旧句柄不可恢复）。
- `restoreAndReconnect` 内 driver.start 必须传 `cwd: record.cwd`，不接受运行时 cwd 变更（R-cwd）。

### 4.4 backend 对账接口（`backend/app/modules/daemon/service.py`）

新增独立方法，不复用 task-05 的 end_session / create_session：

```python
@dataclass(frozen=True, slots=True)
class SessionRecoveryResult:
    session_id: uuid.UUID
    lease_id: uuid.UUID
    status: Literal["active", "ended", "failed", "rejected"]
    interrupted_run_status: Literal["failed"] | None = None  # 崩溃 currentRun 收敛结果

async def recover_session_after_daemon_restart(
    self,
    session_id: uuid.UUID,
    *,
    runtime_id: uuid.UUID,
    lease_id: uuid.UUID,
    provider: str,
    agent_session_id: str,
    interrupted_run_id: uuid.UUID | None,
) -> SessionRecoveryResult: ...
```

单数据库事务内必须：

1. `SELECT AgentSession ... FOR UPDATE`，校验 `session.runtime_id == runtime_id`、`session.lease_id == lease_id`、`session.provider == provider`、`lease.kind == 'interactive'` 归属。
2. session 已 `ended | failed` → 返回对应终态（status=ended/failed），不复活、不收敛 run；daemon 据此删本地记录。
3. session 可恢复（active/reconnecting）→ 先写 `status='reconnecting'`、`last_active_at=now`。
4. `interrupted_run_id` 非空 → 只收敛同 session 且 `status IN ('pending','running','pending_approval')` 的该 run：写 `status='failed'`、`finished_at=now`、`output_redacted` 含稳定错误码 `daemon_restarted`；已终态则幂等（不改完成结果）。
5. 同 session 若还存在**另一个**非终态 run（除 interrupted_run_id 外）→ 抛 `DaemonSessionInvariantViolation`（409），禁止猜测或批量失败。
6. commit `reconnecting` + currentRun failed；返回 `SessionRecoveryResult(status='reconnecting', interrupted_run_status='failed')`。
7. daemon 收到 reconnecting 响应后调 `SessionManager.restoreAndReconnect` + `markReconnected`，成功后再发**第二次**轻量对账 `confirm_session_reconnected(session_id)` 把 status 写 active（或复用一次 RPC：recover 返回 active 需在事务内 reconnecting→active，由 daemon 侧 driver.start 成功回调触发——本任务采用两段式，driver.start 成功才 active，失败保持 reconnecting→后续 failed）。

> 状态流转不变量：active（崩溃前）→reconnecting（recover 写）→active（restoreAndReconnect + markReconnected 成功）/ failed（driver.start 抛错或 backend rejected）。reconnecting 是恢复中间态，不长期停留；若 daemon 恢复卡死，由 task-07 空闲扫描或人工 end 收口（不在本任务自动化超时，见边界 5）。

HTTP 契约（daemon→backend 内部端点，不复用用户 session REST）：

```text
POST /api/daemon/internal/sessions/{session_id}/recover
Authorization: daemon 现有认证
Body: { lease_id, runtime_id, provider, agent_session_id, interrupted_run_id? }
→ { session_id, lease_id, status, interrupted_run_status? }
```

- schema DTO 内联在 `router.py`（参照 task-05 模式，不越界改 `daemon/schema.py`）。
- router 只做 DTO 映射 + 鉴权（daemon 身份），不写 ORM。
- 此端点不在 `allowed_paths`（属 task-05 router 范围）；本任务只在 service.py 加方法，router 端点由 task-05 接住（task-05 已 blocks task-10）。若 task-05 未覆盖 router，本任务实施时先与 task-05 协商补到 task-05 allowed_paths，不擅自扩本任务 allowed_paths。

## 5. daemon 启动恢复顺序

在 `daemon.ts` 三循环（heartbeat/poll/ws）启动**前**插入：

```text
load config / construct SessionManager(注入 persistence) / construct HubClient
  → persistence.load()
  → register runtimes（获得当前 backend runtime ids，daemon 启动既有步骤）
  → 对每条记录串行或限流（默认 4 并发）：
      1. HubClient.recoverSession(sessionId, { lease_id, runtime_id, provider, agent_session_id, interrupted_run_id })
         → backend 收敛崩溃 currentRun=failed、session=reconnecting
      2. 若 backend status ∈ {ended, failed, rejected}：
            persistence 从记录移除该条；不调 restoreAndReconnect；继续下一条
      3. 若 backend status == reconnecting：
            await sessionManager.restoreAndReconnect(record)
              → driver.start({resume: agentSessionId, cwd}) 跨进程 resume（spike D3）
            await sessionManager.markReconnected(sessionId)
              → status: reconnecting → active；flush（清 currentRunId）
            HubClient.confirmReconnected(sessionId)  → backend status: reconnecting → active
      4. restoreAndReconnect 抛错（cwd 不一致 / executable 缺失 / SDK jsonl 缺失）：
            sessionManager.fail(sessionId)  → onSessionEnd(failed)
            HubClient.markRecoveryFailed(sessionId)  → backend status: reconnecting → failed
            persistence 从记录移除该条
  → flush（清除 currentRunId / 无效记录）
  → 启动 WS/poll/heartbeat/idle loops
```

恢复循环规则：

- 默认限流 4 个 session 并发；单条失败（backend rejected 或 driver.start 抛错）→ 结构化 warning 后继续其它记录，不崩 daemon。
- 恢复期间该 session 不接受 SESSION_INJECT（backend status=reconnecting，REST 返回 409 稍后重试，task-05 的 `DaemonSessionNotActive` 自然拦）。
- 记录对应 runtime 未注册（runtime_id 不在线）→ 不恢复为 active；backend 收敛旧 run 后 session=failed，daemon 删记录。
- `recoverSession` 成功只表示 backend 元数据可继续，不代表 SDK resume 成功——真正 resume 成功与否由 `driver.start` 是否抛错决定（spike D3 的 jsonl 加载由 SDK 内部完成）。
- 下一 inject 复用既有 task-04 SESSION_INJECT 路由：resume Query 已在跑，InputQueue.push 首条恢复后 prompt → SDK 在 resume 上下文基础上跑新 turn。

## 6. resume query 调用（spike D3）

`SessionManager.restoreAndReconnect` 内的关键调用（搬砖级）：

```typescript
// 1. 新 InputQueue（不恢复旧队列；spike D3 resume query 不带 prompt）
const inputQueue = new InputQueue();

// 2. 写内存 state（reconnecting 中间态，currentRunId 清空）
const state: SessionState = {
  sessionId: record.sessionId,
  leaseId: record.leaseId,
  agentSessionId: record.agentSessionId,   // 保留，resume 用
  cwd: record.cwd,                          // R-cwd：固定
  provider: record.provider,
  status: 'reconnecting',
  currentRunId: undefined,                  // 崩溃 currentRun 由 backend 收敛，daemon 不持有
  inputQueue,
  lastActiveAt: record.lastActiveAt,
};
this._store.set(state.sessionId, state);

// 3. 探测 executable（D-009）
const exe = record.pathToClaudeCodeExecutable ?? this._detectClaudeExecutable();
if (!exe) throw new ClaudeExecutableNotFoundError();

// 4. driver.start({resume}) —— spike D3 跨进程 resume
const query = this._deps.driver.start(inputQueue, {
  pathToClaudeCodeExecutable: exe,
  cwd: record.cwd,                          // R-cwd：必须用记录 cwd
  env: { ...process.env },                  // spike H1 env 继承
  model: record.model,
  resume: record.agentSessionId,            // spike D3：跨进程恢复 ~/.claude/projects/<encoded-cwd>/<sid>.jsonl
});

state.query = query;

// 5. fire consume（同 create，长生命周期协程）
void this._consumeInBackground(state);
```

spike D3 实测证据（§3.7 D3）：SDK 自动持久化到 `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`；新 node 进程 `query({options:{resume:sessionId}})` 正确回忆 `ZEBRA-742`，session_id 匹配。**daemon 不读不写该 jsonl**，完全靠 SDK 内部加载。

> 注意：resume query 启动后 SDK 不会主动产 turn（spike D3 resume 不带 prompt）；driver.consume 协程空转等 InputQueue.push。下一次 SESSION_INJECT 推首条 prompt 时，SDK 在 resume 上下文基础上跑新 turn——上下文连续（ZEBRA-742 可回忆）。

## 7. 边界处理（至少覆盖以下，全部上单测）

| # | 场景 | 必须行为 |
|---|---|---|
| 1 | resume 时 cwd 不一致（记录 cwd 与 SDK jsonl 实际目录不匹配） | SDK 在错误 cwd 找不到 `~/.claude/projects/<encoded-cwd>/<sid>.jsonl` → driver.start 抛错或 consume 立即 onError → `SessionManager.fail`；onSessionEnd(failed)；HubClient.markRecoveryFailed；记录移除。R-cwd 兜底（spike D3 caveat） |
| 2 | agentSessionId 缺失（首 turn system/init 未到就崩溃） | 不写入 sessions.json（snapshotPersistable 过滤 agentSessionId 空）；backend 无对应可恢复记录 → session 由 task-05 默认路径标 failed；不进入恢复分支 |
| 3 | sessions.json 磁盘损坏 / 非法 JSON / version 不支持 | `quarantine` 重命名为 `sessions.json.corrupt-<epoch>`；load 返回空集合；daemon 正常启动（不崩、不 warn 洪水）；不尝试猜测字段 |
| 4 | SDK jsonl 缺失（`~/.claude/projects/<encoded-cwd>/<sid>.jsonl` 被删 / 用户清理 ~/.claude） | driver.start({resume}) 时 SDK 找不到 session → onError → fail；daemon 不直接检测 jsonl 存在性（SDK 内部管理），靠 driver 抛错兜底；记录移除 |
| 5 | reconnecting 超时 / daemon 恢复卡死（driver.start hang） | 本任务**不实现**自动超时（非目标）；reconnecting 长期停留由 task-07 空闲扫描（last_active_at 超 30min）或人工 end 收口；恢复循环对单条记录加保护性 await 超时（默认 30s）→ 当条 fail 继续，不卡整个启动 |
| 6 | 崩溃时存在 running currentRun | backend `recover_session_after_daemon_restart` 把记录中的同 session run 标 failed / `daemon_restarted`；session 写 reconnecting；daemon 启动恢复期 spawn 旧进程次数 = 0（新 Query 不算 spawn 旧进程）；恢复成功后 currentRunId 清空 |
| 7 | 崩溃时 session 空闲、无 currentRun | 不创建虚假 run；backend 校验 + 写 reconnecting；daemon restoreAndReconnect → markReconnected → active；下一 inject 才跑新 turn |
| 8 | session 已 ended/failed（backend 真相） | recover 返回 ended/failed；daemon 删本地记录，不复活 session/lease；不调 restoreAndReconnect |
| 9 | runtime/lease/provider/session 任一不匹配 | recover 返回 rejected；daemon 删记录；不改其它 run、不旋转 token、不建立本地 session |
| 10 | interrupted_run_id 指向别的 session | backend invariant violation / rejected；绝不按 UUID 直接更新跨 session run |
| 11 | interrupted run 已 completed/failed（崩溃前刚好收尾） | 对账幂等，保留原终态/结果；session 仍可继续恢复（reconnecting→active） |
| 12 | 多个 session 同时恢复，其中一个 driver.start 抛错 | 失败隔离；其它 session 继续 active；失败项不进 active store、从 sessions.json 移除；日志不含 token/prompt |
| 13 | save 并发与进程退出 | persistence promise queue 保证顺序；daemon stop await 最后一次 flush；SIGKILL 由上一次原子快照兜底；文件始终是完整 JSON |
| 14 | end/idle 与 persist 竞态 | 终态（end/fail）的"删除记录"写必须排在旧 active 快照后；重启不得复活已结束 session（backend ended 拒绝 → 删记录） |
| 15 | 旧 claim token 泄露 / 重放 | token 不落盘（sessions.json 禁止写 token）；interactive lease claim token 不在本任务旋转（task-05 管理 lease，本任务只读 lease_id）；恢复后 SESSION_INJECT 复用既有 lease 认证 |
| 16 | batch lease 混入恢复 | sessions.json 只写 interactive session（provider 过滤 + SessionManager 只管 interactive）；batch lease 不落盘、不进 recover endpoint；FR-09 守门测试全绿 |
| 17 | 重复 task_available 重放 / WS 重连（恢复后） | 恢复后 session 已在 _store + 已 restoreAndReconnect；task-04 既有 `_interactiveSessionsByLease` 命中跳过重复 create；恢复路径不重复调 driver.start |
| 18 | Wave1/2 行为（本任务未合并） | daemon 崩溃 → backend task-05 默认把 active session 标 failed（无 reconnecting 分支）；本任务合并后才走 reconnecting。回退路径：删 sessions.json 即回到 Wave1/2 行为 |

## 8. 非目标（本任务不做的事）

- **不实现 Wave1/2 崩溃恢复**：本任务未合并前 daemon 崩溃 = failed（D-003@v1 Wave1/2）；只有本任务合并后才走 reconnecting→active。
- **不管理 SDK jsonl 文件**：`~/.claude/projects/<encoded-cwd>/<sid>.jsonl` 由 SDK 自动写（spike D3）；daemon 不读、不写、不备份、不清理；resume 完全靠 SDK 内部加载。
- **不持久化不可恢复对象**：SDK Query 句柄、InputQueue 缓冲、child/stdin/adapter/AbortController、permission request、未消费输出、完整 AgentRunLog（日志真相在 backend / Redis）。
- **不 attach / 探测 / 复用 daemon 崩溃前的 OS 子进程或 SDK Query**：恢复 = 新 Query + resume（spike D3 跨进程语义），旧句柄不可恢复。
- **不在 daemon 启动时为每条 session 立即跑一个 turn**：resume query 不带 prompt（spike D3），driver.consume 协程空转等下一次 inject；不预热、不发空 prompt。
- **不实现 reconnecting 自动超时**：单条记录恢复有保护性 await 超时（30s）但不改 session 状态；session 级 reconnecting 长停留由 task-07 空闲扫描 / 人工 end 收口。
- **不修改 task-04 的 ClaudeSdkDriver / InputQueue**：`StartOptions.resume` 已声明，本任务只消费；create/inject/interrupt/end 既有逻辑不动。
- **不修改 task-05 的 4 个 session REST 方法**：本任务在 service.py 加 `recover_session_after_daemon_restart` 独立方法；router 内部端点由 task-05 allowed_paths 接住（协商）。
- **不修改 canUseTool / permission 链路**：task-08 负责；恢复后的 session 若触发 canUseTool 走既有 task-08 路径。
- **不实现 session 级 SSE 恢复 / 历史回放**：task-06 / task-12 负责；前端 reconnecting 状态展示由 task-11。
- **不修改 AgentSession model / alembic**：task-02 已建 status String(20)，reconnecting 是自由值无需迁移。
- **不跨主机迁移 session / 多 daemon 抢占**：runtime_id 不匹配直接 reject。
- **不读 credentials.json**：env 继承 `process.env`（spike H1，task-04 已落实）。
- **不实现 CodexAppServerDriver resume**：codex thread/resume 由后续独立任务；本任务 provider 非 claude → 恢复时 throw UnsupportedProviderError（同 task-04 边界）。

## 9. 参考

- `design.md` §5 Wave3（resume 持久化 + 崩溃恢复：SDK 自动持久化 + daemon 元数据 + query resume + 固定 cwd + reconnecting）、§8.1 status（reconnecting）、§10 R-cwd（resume 按 cwd 分目录）/ R-03（Wave1/2 不恢复，Wave3 持久化）。
- `requirements.md` FR-08（resume 持久化恢复）。
- `decisions.md` D-003@v1（Wave1/2 不崩溃恢复，Wave3 resume 持久化）。
- `spike-02-architecture-validation.md` §3.7 D3（SDK 自动持久化 `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`；新进程 `query({options:{resume:sessionId}})` 正确回忆 `ZEBRA-742`；支撑 Wave3，daemon 只需记 session_id + 固定/还原 cwd）。
- spike sandbox 脚本（仓库外）：`%TEMP%\claude-sdk-spike\d3.mjs`（resume 实测，可复跑）。
- task-04（SessionManager / ClaudeSdkDriver / StartOptions.resume / SessionState 固定 cwd / agentSessionId 写入点）。
- task-05（backend session service / ACTIVE_SESSION_STATUSES 含 reconnecting / end_session 单一收口）。
- task-02（agent_sessions.status String(20)，reconnecting 自由值）。
- `sillyhub-daemon/src/config.ts`（DEFAULT_CONFIG_DIR = ~/.sillyhub/daemon）。
- `sillyhub-daemon/src/credential.ts:31-55`（credentials.json 0600 原子写模式参考）。
- `backend/app/modules/daemon/service.py`（task-05 `_get_owned_session_for_update` / `_publish_session_event` 容错模式参考）。

## 10. TDD 实施顺序

严格"测试先红 → 最小实现 → 重构 → 全量回归"。SDK 调用一律 mock（不连真实 bigmodel，避免 CI 依赖网络/鉴权）；spike D3 已在仓库外 sandbox 证毕，本任务测试用 mock SDK 复现 resume 形态。

### Step 1：文件 schema 与原子写（Red）

- 写 `session-store-persistence.test.ts`：
  - 不存在文件 → load 返回 `[]`（不 warn、不创建）。
  - 合法 v1（含 1-2 条 PersistedSessionRecord）→ load 返回原结构。
  - 非法 version（version=2 / 缺 version）→ quarantine + 空集合。
  - 损坏 JSON（截断 / 非法字符）→ 重命名为 `sessions.json.corrupt-<epoch>` + 空集合。
  - save 用临时文件 + rename（mock fs.writeFile/rename 验证调用顺序）；并发 save 经 promise queue 串行（最后一条 win）。
  - save 内容不含 token/prompt/output（白名单过滤断言）。
  - `0o600` 权限调用（Windows 无效但保留）。
- 红后实现 `JsonSessionPersistence`；不接 daemon 生命周期。

### Step 2：SessionManager snapshot/restore（Red）

注入 mock ClaudeSdkDriver + mock SessionStorePersistence（spy load/save）+ mock deps：

- `snapshotPersistable`：active session + agentSessionId 非空 → 在结果中；ended/failed/agentSessionId 空 → 不在。
- `restoreAndReconnect(record)`：
  - 构造 fresh InputQueue（mock 验证不恢复旧队列）。
  - state.status='reconnecting'、currentRunId=undefined、agentSessionId=record.agentSessionId、cwd=record.cwd 写入 _store。
  - driver.start 调用一次，opts.resume === record.agentSessionId、opts.cwd === record.cwd（R-cwd 断言）。
  - driver.start 抛 ClaudeExecutableNotFoundError → onError → fail → onSessionEnd(failed)；记录从 _store 移除。
  - driver.consume fire 后台协程（mock 验证不阻塞 restoreAndReconnect 返回）。
- `markReconnected`：reconnecting → active；flush 调用一次；非 reconnecting 状态调 → 抛错。
- `flush`：把 snapshotPersistable 结果调 persistence.save。
- 恢复期 driver.start 调用次数 = 1（per session），不 push 任何 SDKUserMessage（resume 不带 prompt，spike D3）。
- 红后实现 session-manager.ts 扩展。

### Step 3：backend recover service（Red）

- 写 `test_session_recovery.py`（如 task-05 未覆盖）：
  - session/lease/runtime/provider 所有权匹配 → status=reconnecting、currentRun failed(daemon_restarted)。
  - interrupted_run_id 已终态 → 幂等，不改完成结果。
  - interrupted_run_id 指向别的 session → invariant violation。
  - 同 session 另一个非终态 run → invariant violation。
  - session 已 ended/failed → 返回终态，不复活。
  - runtime/lease/provider 不匹配 → rejected。
  - PostgreSQL 下并发 recover 同 session → 串行（FOR UPDATE）。
- 红后实现 `recover_session_after_daemon_restart`；不修改 task-05 既有 4 方法。

### Step 4：daemon 启动编排（Red）

mock persistence + mock HubClient + mock SessionManager，在 daemon 启动函数注入：

- load 返回 2 条记录 → 对每条调 HubClient.recoverSession。
- backend status=reconnecting → 调 SessionManager.restoreAndReconnect + markReconnected + HubClient.confirmReconnected。
- backend status=ended/failed/rejected → 不调 restoreAndReconnect；persistence 从记录移除。
- restoreAndReconnect 抛错 → sessionManager.fail + HubClient.markRecoveryFailed + 移除记录；继续下一条。
- 全部恢复完成后才启动三循环（heartbeat/poll/ws）——断言 loops 启动在 restoreAndReconnect 之后。
- 限流 4 并发（5 条记录时第 5 条等前面有 slot）。
- 红后修改 daemon.ts 启动编排。

### Step 5：resume query 集成（Red）

- mock ClaudeSdkDriver：`start(input, opts)` 断言 `opts.resume === record.agentSessionId`、`opts.cwd === record.cwd`、`opts.pathToClaudeCodeExecutable` 非空。
- 恢复后模拟 SESSION_INJECT：调 `sessionManager.inject(sessionId, prompt, newRunId)` → InputQueue.push 被调（mock 验证）；driver.consume 在恢复后收到 push 跑新 turn（mock SDK 吐 result）→ onTurnResult。
- 断言新 run_id 与崩溃 run_id 不同；旧 Query 句柄未被引用（_store 中 state.query 是新对象）。
- cwd 不一致场景：mock driver.start 抛错 → fail → onSessionEnd(failed)；记录移除。

### Step 6：回归

```bash
cd sillyhub-daemon
pnpm test -- session-store-persistence session-recovery daemon-recovery-boot
pnpm test -- claude-sdk-driver session-manager input-queue daemon-kind-dispatch   # task-04 回归
pnpm typecheck
pnpm test      # 全量回归，batch 测试零失败

cd ..
uv run pytest backend/app/modules/daemon/tests/test_session_recovery.py backend/app/modules/daemon/tests/test_session_service.py
uv run ruff check backend/app/modules/daemon
```

若 `.sillyspec/local.yaml` 定义了替代命令，以该文件为准。PostgreSQL 才能证明 `FOR UPDATE` 并发语义；SQLite 只用于分支单测。

## 11. 验收标准

| ID | 验证步骤 | 通过标准 | 覆盖 |
|---|---|---|---|
| AC-10-01 | active session 完成一轮（首 turn result + agentSessionId 写入）后查 sessions.json | v1 JSON 只含白名单元数据；有 agentSessionId + cwd；无 token/prompt/output/Query/InputQueue | FR-08 |
| AC-10-02 | running turn 中 kill daemon，再启动 | 旧 currentRun=failed 且 error=`daemon_restarted`；session 出现 reconnecting→active；启动期 driver.start（新 Query）=1 次，spawn 旧进程 = 0 次 | FR-08 / D-003@v1 |
| AC-10-03 | 恢复后查 driver.start 参数 | opts.resume === 持久化 agentSessionId；opts.cwd === 持久化 cwd（R-cwd 还原，spike D3） | FR-08 / R-cwd |
| AC-10-04 | 恢复后对 session 发下一次 inject | 新 AgentRun、新 turn；resume Query 在恢复上下文基础上跑（mock SDK 验证 InputQueue.push → result）；新 run_id 与崩溃 run_id 不同 | FR-08 / spike D3 |
| AC-10-05 | backend 对账 currentRun | 只收敛持久化 currentRunId；已终态不覆盖；跨 session id 被拒绝（invariant） | FR-08 |
| AC-10-06 | 损坏 / 未知版本 sessions.json 启动 | 文件被 quarantine（重命名 corrupt-<epoch>）；daemon 正常启动；不恢复半条记录、不 spawn | FR-08 / 健壮性 |
| AC-10-07 | ended/failed session 残留记录 | backend 拒绝复活（返回 ended/failed）；daemon 清记录；session/lease 终态不变 | FR-08 |
| AC-10-08 | 多 session 恢复且一条 driver.start 抛错 | 其它记录正常 reconnecting→active；失败项 failed 并移除；日志不含 token/prompt | FR-08 |
| AC-10-09 | runtime/lease/provider 不匹配 | recover 返回 rejected；daemon 删记录；不旋转 token、不建本地 session | FR-08 |
| AC-10-10 | resume cwd 不一致 | driver.start 抛错（SDK 找不到 jsonl）→ fail → onSessionEnd(failed)；记录移除；R-cwd 兜底 | R-cwd / spike D3 |
| AC-10-11 | SDK jsonl 缺失（用户清 ~/.claude） | driver.start({resume}) onError → fail；记录移除；不直接检测 jsonl | spike D3 |
| AC-10-12 | agentSessionId 缺失（首 turn 前崩溃） | 不写入 sessions.json；backend 默认路径标 failed；不进恢复分支 | D-003@v1 |
| AC-10-13 | 运行 batch 回归 | batch lease 不落盘、不调 recover endpoint；现有 claim/expire/cancel/TaskRunner 全绿（FR-09 守门） | FR-09 |
| AC-10-14 | 运行定向与全量测试 | daemon typecheck/test（含 task-04 回归）+ backend pytest/ruff 全通过；diff 只在 allowed_paths 内 | 工程约束 |
| AC-10-15 | Wave1/2 行为（删 sessions.json） | daemon 崩溃 → backend task-05 标 failed（无 reconnecting 分支）；回退路径成立 | D-003@v1 |

## 12. 完成定义

- D-003@v1（Wave3 resume）在代码与测试中有直接证据：sessions.json 持久化 + 启动加载 + `query({resume:agent_session_id})` 跨进程恢复（spike D3 形态）+ reconnecting 状态流转。
- spike D3 的"SDK 自动持久化 + 跨进程 resume + 固定 cwd"结论均有对应实现落点：daemon 只持久化元数据、不管理 jsonl；恢复用 driver.start({resume})；cwd 还原（R-cwd）。
- FR-08 全链路（崩溃 → 持久化加载 → backend 收敛 currentRun → reconnecting → driver resume → active → 下一 inject 上下文连续）由自动化测试证明。
- AC-10-01 ~ AC-10-15 全部通过；所有异常路径有明确错误码，禁止裸 `try/catch` 吞错。
- batch 路径（FR-09）与 task-04 SessionManager 既有逻辑零回归。
- 未越过 allowed_paths：未改 claude-sdk-driver.ts / input-queue.ts / task-runner.ts / protocol.ts / frontend / SDK jsonl 文件 / AgentSession model。
