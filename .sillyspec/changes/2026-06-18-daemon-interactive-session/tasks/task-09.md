---
author: qinyi
created_at: 2026-06-18 15:31:03
change: 2026-06-18-daemon-interactive-session
id: task-09
title: "session 元数据持久化与 daemon 重启收敛"
wave: W6
priority: P1
estimated_hours: 16
depends_on: [task-03, task-06]
blocks: []
requirement_ids: [FR-08]
decision_ids: [D-002@v2, D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/session-store.ts
  - sillyhub-daemon/src/session-persistence.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/tests/session-persistence.test.ts
  - sillyhub-daemon/tests/session-store.test.ts
  - sillyhub-daemon/tests/daemon-session-recovery.test.ts
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/tests/test_session_recovery.py
---

# session 元数据持久化与 daemon 重启收敛

## 1. 目标与硬约束

依据 `plan.md` 显式 task-09、`requirements.md` FR-08、`decisions.md` D-002@v2/D-003@v1，本任务只实现以下恢复语义：

1. daemon 将 active interactive session 的**可恢复元数据**持久化到 `~/.sillyhub/daemon/sessions.json`。
2. daemon 重启时加载元数据；若记录含 `currentRunId`，先由 backend 将该 in-flight `AgentRun` 收敛为 `failed`，再把 `AgentSession` 从 `reconnecting` 恢复为 `active`。
3. 重启恢复阶段**不 spawn agent、不 attach 旧进程、不发送空 prompt、不调用 `TaskRunner.runTurn`**。
4. 恢复后的下一次 `SESSION_INJECT` 才创建并执行新的 AgentRun；task-03 的 `SessionStore.startTurn` 使用持久化的 `agentSessionId`，Claude 新进程走 `--resume`，Codex 新 app-server 进程走 `thread/resume` 后 `turn/start`。
5. 旧 child/stdin/readline/adapter/AbortController 不可序列化、不可恢复、不可出现在 SessionStore 恢复记录中。
6. backend 是 session/run/lease 状态真相；daemon 本地文件只是恢复索引。文件记录与 backend 不一致时，以 backend 校验结果为准。

这取代旧 task-09 的“daemon 启动时立即重 spawn/等待首事件”方案。不得保留兼容分支，也不得新增 `isResume` 后在启动阶段调用 `runLease`/`runTurn`。

## 2. 覆盖来源与当前源码依据

- Requirements：FR-08，daemon 重启时加载持久化 metadata、收敛崩溃时 currentRun，并让 session 恢复为可继续状态。
- Decisions：D-002@v2 固定“每 turn 独立 spawn + resume”；D-003@v1 固定恢复能力属于独立持久化层。
- Design：§5 Wave 3、§8.1 `reconnecting` 状态、§12 验收标准 7；其中“重 attach”按 D-002@v2 解释为下一 turn 新 spawn + resume，不能恢复旧进程。
- Plan：Wave 6 task-09；依赖 task-03 的 turn runner 和 task-06 的生命周期/idle 收口。

实现前必须重新用 `rg` 确认接口存在；源码变化时先修本文档，不按旧行号编造调用：

| 依据 | 当前事实 | 本任务用法 |
|---|---|---|
| `tasks/task-03.md` | `SessionStore` 仅保存元数据；`startTurn` 派生 `resumeSessionId`；`TaskRunner.runTurn` 每 turn 新 spawn | 恢复只重建 store；下一 inject 原样复用 `startTurn` |
| `tasks/task-06.md` | store 有 `lastActiveAt` 与 idle end；`end` 是本地唯一删除入口 | persist 覆盖 create/turn/end/idle 变更，不复制 idle 收口 |
| `sillyhub-daemon/src/config.ts` | `DEFAULT_CONFIG_DIR = ~/.sillyhub/daemon` | sessions 文件放同一目录 |
| `sillyhub-daemon/src/task-runner.ts` | 真实执行入口为 `runLease(ctx)`；task-03 将新增 `runTurn(ctx)`；现有 cancel 以 leaseId 追踪当前执行 | restore 禁止调用执行入口；新 turn 仍由 task-03 路径执行 |
| `sillyhub-daemon/src/adapters/stream-json.ts` | `buildArgs({resumeSessionId})` 已生成 `--resume <id>` | 下一 inject 的 Claude 新 spawn 复用 |
| `sillyhub-daemon/src/adapters/json-rpc.ts` | 当前首 turn 为 initialize → `thread/start` → `turn/start`；task-03 增加 `thread/resume` | 下一 inject 的 Codex 新 spawn 复用 |
| `sillyhub-daemon/src/hub-client.ts` | `_request` 是 daemon→backend HTTP 唯一封装 | 恢复对账通过 HubClient，不散落 fetch |
| `backend/app/modules/daemon/service.py` | service 负责 lease/run/session 状态事务 | in-flight run 失败和 session 状态切换只在 service 完成 |

扫描模块文档仍混有旧 Python daemon 描述；冲突时以当前 TypeScript 源码、D-002@v2 和本任务硬约束为准。

## 3. 涉及文件

| 操作 | 文件 | 责任 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/session-store.ts` | 导出可持久化快照、恢复 metadata、在状态变更后调持久化端口；不持有进程对象 |
| 新增 | `sillyhub-daemon/src/session-persistence.ts` | schema 校验、原子写、损坏文件隔离、串行化写入 |
| 修改 | `sillyhub-daemon/src/daemon.ts` | 启动时 restore → backend reconcile → activate；明确禁止 restore 期间 spawn |
| 修改 | `sillyhub-daemon/src/hub-client.ts` | 新增 daemon 身份的 session recovery 对账调用 |
| 修改 | `backend/app/modules/daemon/schema.py` | recovery 请求/响应 DTO |
| 修改 | `backend/app/modules/daemon/router.py` | daemon recovery 内部端点，只做鉴权与 DTO 映射 |
| 修改 | `backend/app/modules/daemon/service.py` | 锁 session/lease/run，rotate claim token，收敛 currentRun，返回恢复上下文 |
| 新增 | `sillyhub-daemon/tests/session-persistence.test.ts` | 文件 schema、原子写、串行写、损坏文件测试 |
| 修改 | `sillyhub-daemon/tests/session-store.test.ts` | restore 后无 spawn、下一 turn resume 测试 |
| 新增 | `sillyhub-daemon/tests/daemon-session-recovery.test.ts` | 启动恢复顺序和失败隔离测试 |
| 新增/修改 | `backend/app/modules/daemon/tests/test_session_recovery.py` | 对账事务、所有权、幂等、token rotation 测试 |

不修改 adapter 的 resume 算法、不新增启动期握手、不修改 session SSE/UI/permission；这些分别属于 task-03、task-05/11、task-07/08。

## 4. 持久化数据与接口

### 4.1 磁盘 schema

```typescript
export const SESSION_FILE_VERSION = 1 as const;
export const DEFAULT_SESSION_FILE = join(DEFAULT_CONFIG_DIR, 'sessions.json');

export interface PersistedSessionRecord {
  sessionId: string;          // AgentSession.id
  leaseId: string;            // interactive lease.id
  runtimeId: string;          // backend 分配的 provider runtime id
  provider: 'claude' | 'codex';
  agentSessionId: string;     // Claude session_id / Codex thread_id
  currentRunId?: string;      // 崩溃时可能仍在执行的 AgentRun.id
  turnCount: number;
  lastActiveAt: number;       // epoch milliseconds
  config: Record<string, unknown>;
}

export interface PersistedSessionFile {
  version: typeof SESSION_FILE_VERSION;
  savedAt: string;
  sessions: PersistedSessionRecord[];
}
```

持久化规则：

- 仅写可继续的 `active|running|interrupting` session；序列化时统一记录为 metadata，不把运行态对象写入 JSON。
- `agentSessionId` 必须存在才可作为可恢复记录；首 turn 尚未取得内部 id 时崩溃，不能伪造 resume，backend 收敛为 failed，文件记录移除。
- `currentRunId` 仅用于重启对账；恢复成功后必须清空并再次持久化。
- 禁止写 `claimToken`、API key、credential、prompt、输出、child/stdin/adapter/AbortController。
- 不按任意 24h TTL 自行删除 active session；有效性由 backend session/lease 真相和 task-06 idle 规则决定。
- config 只允许 task-03 明确的非敏感白名单（`model`、`manual_approval` 等）；未知或敏感 key 在序列化前过滤。

### 4.2 持久化端口

```typescript
export interface SessionSnapshotSource {
  snapshotPersistable(): PersistedSessionRecord[];
}

export interface SessionPersistence {
  load(): Promise<PersistedSessionRecord[]>;
  save(records: readonly PersistedSessionRecord[]): Promise<void>;
  quarantine(reason: string): Promise<void>;
}

export class JsonSessionPersistence implements SessionPersistence {
  constructor(filePath: string = DEFAULT_SESSION_FILE);
  load(): Promise<PersistedSessionRecord[]>;
  save(records: readonly PersistedSessionRecord[]): Promise<void>;
  quarantine(reason: string): Promise<void>;
}
```

`save` 必须使用同目录临时文件、`writeFile`、`rename` 的原子替换，并通过单一 promise queue 串行写；不能用 debounce 丢失最后一次状态变化。写入权限在支持的平台设为 `0o600`。`load` 必须做 version、UUID/字符串、provider、有限数字和 config 形状校验；整文件无法解析时将其重命名为 `sessions.json.corrupt-<timestamp>` 后返回空集合。

### 4.3 SessionStore 恢复接口

task-03 的 `SessionState` 保持不含进程对象，并增加/实现：

```typescript
export interface RestoredSessionInput {
  record: PersistedSessionRecord;
  baseCtx: LeaseCtx;           // backend recovery 返回的新 claimToken/执行上下文
}

export class SessionStore {
  restoreMetadata(input: RestoredSessionInput): SessionState;
  markRecovered(sessionId: string): SessionState;
  snapshotPersistable(): PersistedSessionRecord[];
  flush(): Promise<void>;
}
```

语义：

1. `restoreMetadata` 新建 `status='reconnecting'` 的内存项，保留 `agentSessionId/turnCount/lastActiveAt`，但 `currentRunId` 清空；它不得调用 runner。
2. `markRecovered` 只允许 `reconnecting → active`，随后 `flush()`。
3. `startTurn` 在 reconnecting 时必须拒绝；恢复为 active 后，下一 inject 使用既有 `agentSessionId` 派生 `resumeSessionId`。
4. create、接受 startTurn、turn 收敛、interrupt 收敛、end/fail/idle end 后都必须排队保存；`end/fail` 要把记录从文件移除。
5. daemon `stop()` 在取消当前任务后 `await sessionStore.flush()`，但 SIGKILL 仍由上一次原子快照兜底。

## 5. backend 对账接口

### 5.1 HTTP 契约

新增 daemon 内部端点，不复用用户 session REST：

```text
POST /api/daemon/sessions/{session_id}/recover
Authorization: daemon 现有认证
```

```python
class SessionRecoveryRequest(BaseModel):
    lease_id: uuid.UUID
    runtime_id: uuid.UUID
    interrupted_run_id: uuid.UUID | None = None
    provider: Literal["claude", "codex"]
    agent_session_id: str = Field(min_length=1, max_length=255)

class SessionRecoveryResponse(BaseModel):
    session_id: uuid.UUID
    lease_id: uuid.UUID
    runtime_id: uuid.UUID
    status: Literal["active", "ended", "failed", "rejected"]
    claim_token: str | None = None
    execution_context: dict[str, Any] | None = None
    interrupted_run_status: Literal["failed"] | None = None
```

HubClient：

```typescript
export interface SessionRecoveryRequest {
  lease_id: string;
  runtime_id: string;
  interrupted_run_id?: string;
  provider: 'claude' | 'codex';
  agent_session_id: string;
}

export interface SessionRecoveryResponse {
  session_id: string;
  lease_id: string;
  runtime_id: string;
  status: 'active' | 'ended' | 'failed' | 'rejected';
  claim_token?: string;
  execution_context?: Record<string, unknown>;
  interrupted_run_status?: 'failed';
}

class HubClient {
  recoverSession(
    sessionId: string,
    body: SessionRecoveryRequest,
  ): Promise<SessionRecoveryResponse>;
}
```

### 5.2 service 事务

```python
async def recover_session_after_daemon_restart(
    self,
    session_id: uuid.UUID,
    *,
    runtime_id: uuid.UUID,
    lease_id: uuid.UUID,
    interrupted_run_id: uuid.UUID | None,
    provider: str,
    agent_session_id: str,
) -> SessionRecoveryResult: ...
```

单个数据库事务内必须：

1. `SELECT AgentSession ... FOR UPDATE`，校验 session.runtime_id、lease_id、provider 和 `kind='interactive'` lease 归属。
2. session 已 ended/failed 时返回对应终态；不复活、不旋转 token，daemon 删除本地记录。
3. session 可恢复时先置 `reconnecting`。
4. 若 `interrupted_run_id` 非空，只允许收敛同 session 且处于 `pending|running|pending_approval` 的该 run：写 `status='failed'`、`finished_at=now`、稳定错误码 `daemon_restarted`；已终态则幂等，不修改完成结果。
5. 若同 session 还存在另一个非终态 run，报 invariant violation，禁止猜测或批量失败。
6. 为原 interactive lease 旋转 claim token，并返回新的明文 token；数据库仅保存 hash，旧 token 立即失效。不得把 token写磁盘。
7. 生成 task-03 `baseCtx` 所需的 execution context；成功后将 session 置回 `active` 并 commit。
8. 返回 active 后 daemon 才 `restoreMetadata`/`markRecovered`；任何校验失败都不建立本地 session。

`reconnecting → active` 可以在同一 service 调用中完成；测试必须在 service 状态写入/事件发布边界证明顺序。若 task-05 已提供 session 状态事件，则依次 publish reconnecting、active；不得新增同义 WS 状态协议。

## 6. daemon 启动顺序

```text
load config / construct client
  → sessionPersistence.load()
  → register runtimes（获得当前 backend runtime ids）
  → 对每条记录串行或限流 recoverSession()
      → backend 收敛旧 currentRun + rotate claim token
      → SessionStore.restoreMetadata(recovery context)
      → SessionStore.markRecovered()
  → flush（清除 currentRunId/无效记录）
  → 启动 WS/poll/heartbeat/idle loops
```

恢复循环规则：

- 默认限流 4 个 session；单条失败记录结构化 warning 后继续其它记录。
- 恢复期间不接受该 session 的 inject；backend status 为 reconnecting，REST 应返回明确 409/稍后重试。
- 记录对应 provider runtime 未注册时不恢复为 active；backend 收敛旧 run 后将 session 置 failed，daemon 删除记录。
- `recoverSession` 成功只表示元数据可继续，不代表 agent 可 resume。真正的 Claude/Codex resume 成功与否由下一次 inject 的 `runTurn` 结果决定。
- 下一 inject 失败时沿 task-03/task-06 规则处理，不在 recovery 中回退为首 turn 或自动创建新内部会话。

## 7. 边界条件

| # | 场景 | 必须行为 |
|---|---|---|
| 1 | daemon 崩溃时存在 running currentRun | backend 仅把记录中的同 session run 标 failed/`daemon_restarted`；session 回 active；启动期 spawn 次数为 0 |
| 2 | 崩溃时 session 空闲、无 currentRun | 不创建虚假 run；校验并旋转 token后恢复 active；下一 inject 才 spawn |
| 3 | 下一 inject（Claude） | 新 child args 含持久化 session id 的 `--resume`；不能无 resume 降级 |
| 4 | 下一 inject（Codex） | 新 app-server 依次 initialize、`thread/resume {threadId}`、`turn/start`；不能启动期预热进程 |
| 5 | sessions.json 不存在 | 空恢复正常启动，不 warn、不创建 session |
| 6 | JSON 损坏或 version 不支持 | 隔离损坏文件并空恢复；daemon 不崩溃；不尝试猜测字段 |
| 7 | session 已 ended/failed | backend 返回终态；daemon 删除记录，不复活 session/lease |
| 8 | runtime/lease/provider/session 任一不匹配 | recovery rejected；不改其它 run、不旋转 token、不建立本地 session |
| 9 | interrupted_run_id 指向别的 session | invariant/rejected；绝不按 UUID 直接更新跨 session run |
| 10 | interrupted run 已 completed/failed | 对账幂等，保留原终态/结果；session 可继续恢复 |
| 11 | 首 turn 未取得 agentSessionId 就崩溃 | 不可恢复上下文；backend 收敛 currentRun/session 为 failed，记录移除 |
| 12 | 多个 session 同时恢复，其中一个 HTTP 失败 | 失败隔离；其它 session 继续；失败项不进入 active store |
| 13 | save 并发与进程退出 | promise queue 保证顺序；stop await 最后一写；文件始终是完整 JSON |
| 14 | end/idle 与 persist 竞态 | 终态删除写必须排在旧 active 快照后，重启不得复活已结束 session |
| 15 | 旧 claim token 泄露/重放 | token 不落盘；recovery 旋转后旧 token验证失败，新 token只保存在内存 baseCtx |
| 16 | batch lease | 不写 sessions.json、不进 recovery endpoint，现有 claim/heartbeat/complete/expiry 行为零变化 |

## 8. TDD 实施顺序

严格执行“测试先红 → 最小实现 → 重构 → 回归”，每一步保留失败与通过证据。

### Step 1：文件 schema 与原子写（Red）

- 写 `session-persistence.test.ts`：不存在文件、合法 v1、非法 version/字段、损坏 JSON 隔离、临时文件 rename、`0o600`、并发 save 顺序。
- 最小实现 `JsonSessionPersistence`；不得先接 daemon 生命周期。

### Step 2：SessionStore 快照/恢复（Red）

- 覆盖 active/running/interrupting 快照、ended/failed 删除、敏感字段过滤、`restoreMetadata` 状态门、`markRecovered`。
- 注入 spy `TurnRunner`，断言 load/restore/markRecovered 全过程 `runTurn` 调用 0 次。
- 恢复 active 后调用一次 `startTurn`，断言 ctx.resumeSessionId 等于持久化 agentSessionId，才允许 runner 调用 1 次。

### Step 3：backend 对账事务（Red）

- 测试 session/lease/runtime/provider 所有权、currentRun 精确收敛、已终态幂等、多个 active run invariant、token rotation、ended/failed 不复活。
- 实现 schema/router/service；router 不写 ORM，不捕获后伪造成功。

### Step 4：daemon 启动编排（Red）

- fake persistence + fake HubClient + fake SessionStore，验证 register 后 recover、loops 前完成、单项失败隔离、无 spawn。
- 覆盖恢复成功 flush 清 currentRun、rejected 删除记录、stop await flush。

### Step 5：下一 turn resume 集成（Red）

- Claude：恢复期间 spawn=0；模拟 SESSION_INJECT 后 spawn=1 且 args 含 `--resume old-session-id`。
- Codex：恢复期间 spawn=0；inject 后新进程发 initialize → thread/resume → turn/start。
- 两者均断言新 run_id 与崩溃 run_id 不同，旧 child 不存在且未 attach。

### Step 6：回归

```powershell
Set-Location sillyhub-daemon
pnpm test -- session-persistence session-store daemon-session-recovery
pnpm test -- task-runner-turn json-rpc stream-json
pnpm typecheck
pnpm test

Set-Location ..
uv run pytest backend/app/modules/daemon/tests/test_session_recovery.py backend/app/modules/daemon/tests/test_session_service.py
uv run ruff check backend/app/modules/daemon
```

若 `.sillyspec/local.yaml` 定义了替代命令，以该文件为准。PostgreSQL 才能证明 `FOR UPDATE` 并发语义；SQLite 只用于分支单测。

## 9. 验收标准

| ID | 验证步骤 | 通过标准 |
|---|---|---|
| AC-09-01 | active session 完成一轮后检查 sessions.json | v1 JSON 只含白名单元数据；有 agentSessionId；无 token/prompt/child/stdin |
| AC-09-02 | running turn 中 kill daemon，再启动 | 旧 run=failed 且 error=`daemon_restarted`；session 出现 reconnecting→active；旧 lease 保持 interactive |
| AC-09-03 | 统计 daemon 启动恢复期间 spawn/runTurn | 两者均为 0；没有 `--resume`、thread/resume、空 prompt 或预热子进程 |
| AC-09-04 | 恢复后对 Claude 发下一次 inject | 新 AgentRun、新 child；使用旧 agentSessionId 的 `--resume`；历史上下文可引用 |
| AC-09-05 | 恢复后对 Codex 发下一次 inject | 新 AgentRun、新 app-server；initialize→thread/resume→turn/start；thread id 不变 |
| AC-09-06 | 对账检查 currentRun | 只收敛持久化 currentRunId；已终态不覆盖；跨 session id 被拒绝 |
| AC-09-07 | 检查 claim token | 文件无 token；recovery 返回新 token；旧 token失效；新 token支持下一 turn 上报 |
| AC-09-08 | 损坏/未知版本 sessions.json 启动 | 文件被隔离，daemon 正常启动；不恢复半条记录、不 spawn |
| AC-09-09 | ended/failed/idle-ended session 残留记录 | backend 拒绝复活，daemon 清记录，session/lease 终态不变 |
| AC-09-10 | 多 session 恢复且一条失败 | 其它记录正常 active；失败项不进入 store；日志不含 token/prompt |
| AC-09-11 | 运行 batch 回归 | batch lease 不落盘、不调用 recovery endpoint，原 runLease/claim/complete/expiry 全绿 |
| AC-09-12 | 运行定向与全量测试 | daemon typecheck/test、backend pytest/ruff 全部通过 |

## 10. 非目标

- 不恢复、attach、探测或复用 daemon 崩溃前的 OS 子进程。
- 不在 daemon 启动时为每个 session spawn 一个等待输入的 agent。
- 不持久化 stdin 缓冲、permission request、未消费输出或完整 AgentRunLog；日志真相在 backend/task-05。
- 不跨主机迁移 session，不做多 daemon 抢占；runtime 不匹配直接拒绝。
- 不修改 Claude/Codex resume 协议；task-03 已提供新 spawn + resume 链路。
- 不新增后台无限重试。恢复失败可观察并隔离，由用户重试启动或结束 session。

## 11. 实现检查清单

- [ ] 写代码前重读 `.claude/CLAUDE.md`、daemon `CONVENTIONS.md`/`ARCHITECTURE.md`，用 `rg` 确认接口。
- [ ] 测试先行，至少观察每组目标测试按预期失败一次。
- [ ] restore 路径没有 `spawn`、`runLease`、`runTurn`、`buildHandshake` 调用。
- [ ] 下一 inject 严格复用 task-03 的 startTurn/runTurn，不另建第二套 resume runner。
- [ ] in-flight run 的失败和 session 状态只由 backend service 事务写入。
- [ ] 原子写串行且终态删除不会被旧快照覆盖。
- [ ] token/credential/prompt/输出未落盘、未进日志/测试快照。
- [ ] batch 路径与 task-06 idle/end 单一收口无回归。
- [ ] 对照 AC-09-01～AC-09-12 记录命令和断言证据。
