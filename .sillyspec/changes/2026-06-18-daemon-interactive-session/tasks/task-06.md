---
id: task-06
title: spawn + resume 生命周期联调、并发 inject 防重与空闲回收
wave: W5
priority: P0
depends_on: [task-03, task-04, task-05]
blocks: [task-09]
requirement_ids: [FR-01, FR-02, FR-04, FR-05, FR-06]
decision_ids: [D-002@v2, D-004@v1, D-005@v1]
allowed_paths:
  - sillyhub-daemon/src/config.ts
  - sillyhub-daemon/src/session-store.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/config.test.ts
  - sillyhub-daemon/tests/session-store.test.ts
  - sillyhub-daemon/tests/daemon-session-idle.test.ts
  - sillyhub-daemon/tests/hub-client.test.ts
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/tests/test_session_service.py
  - backend/app/modules/daemon/tests/test_interactive_session_lifecycle.py
  - deploy/.env.example
author: qinyi
created_at: 2026-06-18 15:31:03
---

# spawn + resume 生命周期联调、并发 inject 防重与空闲回收

## 1. 目标与硬约束

依据 `plan.md` 显式 task-06、`design.md` 的 D-002@v2 / §8.5、`decisions.md` 的 D-004@v1，本任务完成 Wave 5 的生命周期收口：

1. Claude 与 Codex 各跑通“创建 session → 首 turn 独立 spawn → 第二 turn 新 spawn + resume → interrupt 当前 turn → 后续继续 → end”端到端链路。
2. backend 与 daemon 两层都阻止同一 AgentSession 的并发 inject；冲突请求不得遗留多余 AgentRun，也不得重复 spawn。
3. daemon 对 `active` 且空闲达到 `session_idle_timeout_sec`（默认 1800 秒）的会话执行自动回收。
4. 手动 end、idle timeout、重复/竞态 end 的数据库终态全部调用 `DaemonService.end_session(...)`；不得另写 session/lease 终态更新分支。
5. `interrupt` 只终止当前 AgentRun 对应的 turn 进程，AgentSession 与 interactive lease 保持可继续；只有 `end_session` 完成 session/lease。
6. interactive lease 不进入 batch lease expiry；batch lease、run 级 SSE 与现有 workspace AgentRun 行为不变。

本任务禁止恢复旧蓝图：不得在 turn 间复用 child/stdin/adapter，不得在 `result` 后保持 stdin 开放，不得要求 spike-01 的长驻进程验证通过。每个 turn 都必须由 task-03 的 `runTurn` 新建进程，后续 turn 只通过 Claude `--resume` 或 Codex `thread/resume` 延续上下文。

## 2. 覆盖范围与前置契约

执行前再次用 `rg` 确认接口存在；若 task-03/04/05 实现签名与蓝图不同，先更新本文再写代码，不得猜测方法。

| 来源 | 本任务依赖的契约 |
|---|---|
| task-03 | `SessionStore.create/get/startTurn/interrupt/end`；`SessionState.lastActiveAt`；同 session 原子 `active → running`；`TaskRunner.runTurn` 每次新 spawn，结果携带 `sessionId`；Claude/Codex resume 失败不降级新上下文 |
| task-04 | `DaemonService.create_session/inject_session/interrupt_session/end_session`；session REST；interactive lease `lease_expires_at=NULL`；`end_session` 同步 session、lease、非终态 runs |
| task-05 | `AgentService.stream_session_logs`；`agent_session:{session_id}` 双 publish；`end_session` publish `session_ended` 并令 SSE 发 done |
| 当前 daemon | `src/daemon.ts` 用 `_fire` 管理 heartbeat/poll/ws 循环；`src/config.ts` 的 `DaemonConfig`/`DEFAULT_CONFIG` 是本地配置唯一入口 |
| 当前 backend | `service.py` 的 `expire_leases` 仅处理有 expiry 的 claimed/pending lease；`handle_lease_expiry` 是 batch run 恢复路径，interactive session 不复用 |
| 当前 REST client | `src/hub-client.ts` 的 `_request` 统一处理 daemon→backend HTTP；本任务新增 idle-end 通知必须复用它，不直接散落 `fetch` |

| ID | 本任务覆盖点 |
|---|---|
| FR-01 | 联调 AgentSession、interactive lease 与每 turn AgentRun 的完整创建/执行关系 |
| FR-02 | inject 原子创建下一 AgentRun，并以新进程 resume；并发请求只允许一个成功 |
| FR-04 | interrupt 仅终止 currentRun，session 保持 active 且可继续 resume |
| FR-05 | 手动与自动结束统一收敛 session、lease、非终态 run 和 session SSE |
| FR-06 / D-004@v1 | daemon 默认 1800 秒 active-idle 检测与自动回收 |
| D-002@v2 | 每 turn 独立 spawn，Claude `--resume` / Codex `thread/resume`，不跨 turn 保存进程 |
| D-005@v1 | session/lease/run 三元关系与 `DaemonService.end_session` 单一收口保持一致 |

扫描文档仍包含旧 Python daemon 描述；与当前 TypeScript 源码冲突时，以 `sillyhub-daemon/src/*.ts` 和已确认模块卡为准。

## 3. 涉及文件

| 操作 | 文件 | 责任 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/config.ts` | 增加 `session_idle_timeout_sec` 与 `session_idle_scan_interval_sec`，默认分别为 1800/60，并做有限值归一化 |
| 修改 | `sillyhub-daemon/src/session-store.ts` | 明确活动时间刷新规则；新增只返回候选的 `listIdleSessions`；保持 store 不持有进程对象 |
| 修改 | `sillyhub-daemon/src/hub-client.ts` | 新增 daemon-originated idle end 通知方法，复用 REST_PREFIX、鉴权和统一错误处理 |
| 修改 | `sillyhub-daemon/src/daemon.ts` | 挂载可取消 idle scan loop；先本地 end，再通知 backend 走统一 `end_session`；单 session 失败不影响扫描其它 session |
| 修改 | `sillyhub-daemon/tests/config.test.ts` | 配置默认值、非法值回退与 scan interval 上界测试 |
| 修改 | `backend/app/modules/daemon/schema.py` | 新增 daemon 内部 end 通知 payload（`lease_id`、受限 `reason`），若 task-02 已定义则复用 |
| 修改 | `backend/app/modules/daemon/router.py` | 增加 daemon-originated end 通知端点；只做鉴权/参数转换并调用 service，不直接改 ORM |
| 修改 | `backend/app/modules/daemon/service.py` | inject 加数据库行锁与非终态 run 防重；`end_session` 增加 origin/notify_daemon 控制并保持唯一终态收口、幂等与 session SSE 终态发布 |
| 修改 | `deploy/.env.example` | 记录 daemon 本地配置方式或 backend 对应默认值；不得让两端出现不一致的隐式默认 |
| 新增/修改 | `sillyhub-daemon/tests/session-store.test.ts` | idle 边界、活动刷新、并发与 end 竞态 |
| 新增 | `sillyhub-daemon/tests/daemon-session-idle.test.ts` | fake timers 驱动扫描循环与 backend 通知 |
| 修改 | `sillyhub-daemon/tests/hub-client.test.ts` | idle end 请求路径、body、鉴权、错误透传 |
| 新增/修改 | `backend/app/modules/daemon/tests/test_session_service.py` | inject 行锁防重、end 单一收口、idle origin、幂等/竞态 |
| 新增 | `backend/app/modules/daemon/tests/test_interactive_session_lifecycle.py` | Claude/Codex spawn+resume、多 run SSE、interrupt/end/idle 集成 |

不修改前端 UI（task-10/11）、permission 流程（task-07/08）或磁盘恢复（task-09）。

## 4. 精确接口

### 4.1 daemon 配置

```typescript
export interface DaemonConfig {
  // existing fields...
  session_idle_timeout_sec: number;
  session_idle_scan_interval_sec: number;
}

export const DEFAULT_CONFIG = Object.freeze({
  // existing defaults...
  session_idle_timeout_sec: 1800,
  session_idle_scan_interval_sec: 60,
});
```

`loadConfig` 对用户 JSON 做运行时归一化：timeout 必须是有限正数，最小 60 秒；scan interval 必须是有限正数，最小 1 秒且不得大于 timeout。非法值回退默认并记录一次 warn 的位置由 daemon 启动层负责；禁止直接读取 `process.env` 绕过 config。

### 4.2 SessionStore idle 查询

沿用 task-03 的 camelCase：

```typescript
export interface IdleSessionCandidate {
  sessionId: string;
  leaseId: string;
  lastActiveAt: number;
}

export class SessionStore {
  listIdleSessions(nowMs: number, idleTimeoutMs: number): IdleSessionCandidate[];
}
```

语义：

- 只返回 `status === 'active'` 的 session；`running`/`interrupting` 不在扫描结果，避免把长 turn 当空闲。
- 满足 `nowMs - lastActiveAt >= idleTimeoutMs` 才返回；方法纯查询，不改状态、不 cancel、不发 HTTP。
- `create`、成功接受 `startTurn`、turn 收敛回 active、interrupt 收敛回 active 时更新 `lastActiveAt`。
- 被拒绝的并发 inject、只读 get、idle scan 本身不刷新时间。
- `SessionState` 继续禁止 child/stdin/adapter/readline 字段。

### 4.3 daemon → backend idle end

HubClient 新增：

```typescript
interface SessionEndNoticeBody {
  lease_id: string;
  reason: 'idle';
}

class HubClient {
  endSessionFromDaemon(
    sessionId: string,
    body: SessionEndNoticeBody,
  ): Promise<Record<string, unknown>>;
}
```

建议端点：

```text
POST /api/daemon/sessions/{session_id}/end-notify
body: {"lease_id":"...","reason":"idle"}
```

该端点是 daemon 身份调用面，不复用用户手动 end 的请求 schema。router 必须验证 daemon principal，并把 `notify_daemon=False` 传给 service，避免 daemon 已本地 end 后 backend 再发 SESSION_END 形成回环。若现有认证依赖无法区分 daemon API key，则沿用 daemon lease 端点相同的认证依赖，不新增无认证入口。

### 4.4 `DaemonService.inject_session` 防重

对 task-04 接口保持兼容，内部增加事务门：

```python
async def inject_session(
    self,
    session_id: uuid.UUID,
    *,
    prompt: str,
) -> AgentRun: ...
```

固定顺序：

1. `SELECT AgentSession ... FOR UPDATE` 锁 session 行。
2. 校验 status=`active`。
3. 查询该 session 是否存在 `AgentRun.status IN ('pending', 'running')`；存在则抛 `DaemonSessionTurnConflict`（409），不得创建新 run、不得增加 turn_count、不得发 WS。
4. 创建唯一新 AgentRun，更新 `turn_count`、`last_active_at`，flush/commit。
5. 发送 SESSION_INJECT。
6. WS 发送失败保持 task-04 已定义的 pending run 可观察语义；但后续 retry 必须先由明确的失败/补偿路径收敛该 pending run，不能绕过非终态检查再造一个 run。

数据库行锁负责“不产生重复 AgentRun”，task-03 SessionStore 状态门负责“不重复 spawn”；两层均需测试，不能只依赖 fire-and-forget WS 的 daemon 检查。

### 4.5 `DaemonService.end_session` 单一收口

```python
async def end_session(
    self,
    session_id: uuid.UUID,
    *,
    reason: Literal["manual", "idle", "failed"] = "manual",
    notify_daemon: bool = True,
    expected_lease_id: uuid.UUID | None = None,
) -> AgentSession: ...
```

所有结束路径的 ORM 更新只能存在于此方法：

1. `SELECT AgentSession ... FOR UPDATE`。
2. 不存在抛 404；提供 `expected_lease_id` 且不匹配时抛 409，禁止旧/伪造 daemon 结束别的 session。
3. 已 `ended` 时幂等返回；不得重复 WS、重复 Redis `session_ended` 或重复改 runs。
4. `notify_daemon=True`（用户手动 end）时先发 SESSION_END；发送失败只 warn，DB 仍必须收口。
5. `notify_daemon=False`（idle notice）不回推 WS。
6. 同一事务把 session 标 ended、`ended_at/updated_at` 写入；interactive lease 标 completed；session 下 pending/running run 标 failed/cancelled（沿 task-04 最终选定状态）；commit。
7. commit 后沿 task-05 约定 publish 唯一一条 `session_ended`，reason 原样为 `manual|idle|failed`；publish 失败不回滚 DB。

router、idle loop、异常清理不得复制第 6 步的 SQL/ORM 更新。`complete_lease`、`expire_leases`、`handle_lease_expiry` 不作为 interactive session 的结束入口。

### 4.6 idle scan loop

```typescript
private async _idleSessionLoop(signal: AbortSignal): Promise<void>;
private async _reclaimIdleSession(candidate: IdleSessionCandidate): Promise<void>;
```

流程：

1. `start()` 通过现有 `_fire((signal) => ...)` 挂载 loop；`stop()` 复用 AbortController 统一退出。
2. 每个 interval 读取 `sessionStore.listIdleSessions(Date.now(), timeoutMs)`。
3. 对每个候选再次按 sessionId 获取状态；仍 active 才调用 `sessionStore.end(sessionId)`，利用 store 自身状态门解决 scan 与 inject 竞态。
4. 本地 end 成功后调用 `client.endSessionFromDaemon(sessionId, {lease_id, reason:'idle'})`。
5. 单个通知失败记录结构化 warn（session_id/lease_id/reason，不记录 prompt/token），继续扫描其他 session。失败后的 backend 对账/重试不在本任务引入无限循环；task-09 持久化恢复负责后续崩溃场景。

不得用 `setInterval(async () => ...)` 产生重叠扫描；使用可 await、可 abort 的串行循环。

## 5. 实现方案与端到端联调

### 5.1 Claude

1. 创建 session，首 run 进程 A 的 args 不含 `--resume`。
2. 首 turn result 提取 `session_id=S1`，进程 A stdin 关闭并 exit。
3. inject 创建第二 AgentRun，进程 B 与 A 对象/PID 不同，args 含 `--resume S1`。
4. 单一 session SSE 连接依次收到 run A、run B 的事件，每条含对应 `run_id`。
5. 第三 turn running 时 interrupt，只终止进程 C；session 回 active，lease 不 completed。
6. 再 inject 创建进程 D，仍 `--resume S1`；end 后 session ended、lease completed、SSE done。

### 5.2 Codex

与 Claude 同流程，但断言：

- 首进程 initialize → `thread/start` → `turn/start`，得到 `threadId=T1`；
- 第二/后续进程 initialize → `thread/resume {threadId:T1}` → `turn/start`；
- 每轮 `turn/completed` 后进程退出；不得在新进程跳过 initialize/resume 直接发 turn/start。

### 5.3 idle

会话完成一个 turn 回 active，fake clock 推进到 timeout 边界；daemon 只回收该 session，本地 store 删除，backend 经 end-notify 调同一 `end_session(reason='idle', notify_daemon=False)`，session SSE 收到唯一 done。旁边 running session 与 batch lease 均不受影响。

## 6. 边界条件

至少覆盖以下边界：

1. **同 session 两个并发 inject**：backend 行锁后只创建一个 AgentRun；另一个 409；daemon 最多 spawn 一次。
2. **不同 session 并发 inject**：允许并行建 run/spawn，禁止用全局锁串行所有 session。
3. **inject 与 idle scan 竞态**：只有一个状态转换成功；若 inject 先进入 running，scan 跳过；若 idle end 先成功，inject 返回 409 且不建 run。
4. **manual end 与 idle notice 竞态**：`end_session` 行锁 + terminal 幂等保证只更新/发布一次，最终 reason 以首个成功收口者为准。
5. **end 与 turn completion 竞态**：迟到的 runTurn completion 不得把 store/DB session 从 ended 改回 active，也不得把 lease 改回 active。
6. **timeout 边界**：`elapsed=timeout-1ms` 不回收，`elapsed=timeout` 回收；非法 timeout/interval 归一化，不出现 busy loop。
7. **running 长 turn**：即使 lastActiveAt 超时也不回收；仅 active 空闲态进入候选。
8. **idle end HTTP 失败**：daemon 不崩溃、不阻塞其它候选；日志不含 prompt/凭证；不得反复 cancel 已删除的本地 session。
9. **lease_id 不匹配**：end-notify 返回冲突，backend session/lease/run 不变。
10. **重复 end-notify**：返回已 ended 状态，不重复 publish SSE done。
11. **resume 失败**：Claude `--resume` 或 Codex `thread/resume` 失败不得降级普通 spawn；session 进入 task-03 定义的 failed 状态，idle loop 不把 failed 重写 ended。
12. **首 turn 无内部 session id**：第二 turn 被拒绝，不创建无上下文进程；联调明确暴露错误。
13. **SSE 断线重连**：task-05 的 DB terminal fallback 仍能对已 ended session立即 done；单 turn done 不关闭 session SSE。
14. **batch 兼容**：`agent_session_id=NULL` 的 run 不参与 inject 防重/session publish/idle scan；batch lease expiry、heartbeat、complete 路径零变化。

## 7. TDD 实施顺序

必须记录至少一次目标测试按预期失败，再写最小实现。

### Step 1：backend 并发门（先红）

- 写两个并发事务调用 `inject_session` 的测试；断言只一条新增 AgentRun、turn_count 只加一、WS 只发一次、另一请求为稳定 409。
- 写 active session 已有 pending/running run 的冲突测试。
- 实现 session 行锁、非终态 run 查询与 `DaemonSessionTurnConflict`。

### Step 2：`end_session` 单一收口（先红）

- 写 manual/idle 并发、重复 idle notice、lease mismatch、daemon offline 测试。
- 断言 ORM 终态更新只有 service 方法执行；session_ended 只 publish 一次。
- 实现 `notify_daemon`/`expected_lease_id` 与 end-notify router；保留 task-05 publish 契约。

### Step 3：SessionStore idle 纯函数（先红）

- fake time 覆盖 active/running/interruption/ended/failed 与 timeout 边界。
- 覆盖 create/start/turn completion/interrupt 的 lastActiveAt 更新。
- 实现 `listIdleSessions`，不在该方法做 I/O。

### Step 4：daemon loop 与 HubClient（先红）

- fake timers 驱动一个 scan tick；断言本地 end 后发送正确 REST path/body。
- 覆盖 abort、单候选失败继续、多 tick 不重叠、scan/inject 竞态。
- 实现 config、HubClient 方法和 `_idleSessionLoop`。

### Step 5：spawn + resume 集成（先红）

- 使用 fake child/fake backend 输出，不调用真实付费 CLI：Claude 两 turn 两 child + `--resume`；Codex 两进程 + thread/resume。
- 接入 backend fake DB/Redis/WS，断言 AgentSession 1:N AgentRun、session SSE 跨 run 连续、interrupt/end 分离。
- 再做一次真实 Claude 与 Codex smoke（环境具备凭证时）；真实 smoke 是联调证据，不替代可重复测试。

### Step 6：回归

```powershell
Set-Location sillyhub-daemon
pnpm test -- session-store
pnpm test -- daemon-session-idle hub-client
pnpm typecheck
pnpm test

Set-Location ..\backend
uv run pytest app/modules/daemon/tests/test_session_service.py -q
uv run pytest app/modules/daemon/tests/test_interactive_session_lifecycle.py -q
uv run pytest -q
```

若仓库真实测试路径与上述蓝图不同，以 `rg --files` 查到的现有布局为准，更新文档后执行。

## 8. 验收表

| ID | 验收条件 | 证据 |
|---|---|---|
| AC-06.1 | Claude 首 turn 普通 spawn，第二 turn 新进程带同一 `--resume` id；每轮完成后 child exit | fake-child 集成 + 真实 smoke 日志（脱敏） |
| AC-06.2 | Codex 后续 turn 在新进程 initialize 后 `thread/resume`，再 `turn/start`；thread id 不变 | JSON-RPC transcript 单测/集成 |
| AC-06.3 | 同 session 并发 inject 只产生一个 AgentRun、一次 WS inject、一次 spawn；冲突返回 HTTP 409 | backend 并发事务测试 + daemon store 测试 |
| AC-06.4 | 不同 session 可并行执行 | daemon 并发测试 |
| AC-06.5 | interrupt 只终止 currentRun，session/lease 仍 active，下一 turn 可 resume 新 spawn | 生命周期集成测试 |
| AC-06.6 | 手动 end、idle timeout、并发重复 end 最终都经 `DaemonService.end_session`；session ended、lease completed、非终态 run 收敛 | service 测试 + SQL 状态断言 |
| AC-06.7 | 默认 1800 秒；仅 active 空闲 session 被回收；running session 不误杀；边界值准确 | fake timers |
| AC-06.8 | session SSE 单连接跨多个 run，事件带 run_id；结束只产生一个 session_ended/done | Redis/SSE 集成测试 |
| AC-06.9 | resume 失败不降级新会话；首 turn 缺内部 id 不允许第二 turn | adapter/runner failure 测试 |
| AC-06.10 | batch lease、run 级 SSE、workspace AgentRun 的 heartbeat/expiry/complete 行为不变 | daemon/backend 全量回归 |
| AC-06.11 | daemon `pnpm typecheck`、`pnpm test` 与 backend `uv run pytest` 通过 | 命令输出 |

## 9. 非目标与实现注意

- task-03 已规定 `lastActiveAt` 与 SessionStore 状态机；本任务只增加 idle 查询/循环及联调，不把 store 改成长驻进程容器。
- task-04 的旧文字若仍写“inject 写 stdin”，执行时必须按 D-002@v2 解释为“创建下一 AgentRun 并触发新 spawn”；不得照旧文字实现。
- task-05 的 `session_ended.reason` 统一使用 `manual|idle|failed`；不要再引入 `idle_timeout` 同义值。
- end-notify 是进入统一 service 的 transport，不是第二套收尾业务逻辑。
- 空闲回收只结束 `active`；running turn 的执行 timeout 仍由 TaskRunner 既有 timeout 负责，两者不可混用。
- 不做 task-09 的磁盘 persist/restore；daemon 或 backend 重启后的对账不在本任务扩展。
- 不做 UI、权限审批、多 daemon 亲和或跨主机迁移。
- 不将真实 Claude/Codex 凭证、prompt、完整输出写入测试快照或联调证据。

## 10. 完成检查清单

- [ ] 写代码前重新读取 `.claude/CLAUDE.md`、daemon/backend CONVENTIONS 与 ARCHITECTURE。
- [ ] 用 `rg` 确认 task-03/04/05 最终方法、错误类、测试 helper 与 route auth 依赖真实存在。
- [ ] 测试先红后绿，并保留并发事务测试，不用顺序 mock 冒充并发。
- [ ] 一个 turn 一个 AgentRun、一个新 child；无跨 turn stdin/adapter 引用。
- [ ] backend 与 daemon 两层并发门均存在。
- [ ] 所有 session/lease ORM 终态只在 `DaemonService.end_session` 更新。
- [ ] idle loop 可 abort、不重叠、单 session 失败隔离。
- [ ] session SSE done 唯一，run 级 SSE 与 batch 路径不变。
- [ ] 对照 AC-06.1～AC-06.11 逐项记录证据。
