---
author: qinyi
created_at: 2026-06-24T14:14:57
---

# daemon 网络层可靠性 + 进程保活增强

变更名：`2026-06-24-daemon-network-resilience`
子项目：sillyhub-daemon（主） + backend（幂等根治，少量） + protocol（共享）

> 本版已并入 Design Grill（Step 12）修正：D1 断连感知、C1 范围=B、C2 token 失效容忍、F1 部分索引 conflict target、F2 drain 注入点。

---

## 1. 背景

daemon（sillyhub-daemon）连远程 backend（`https://crrcdt.ppdmq.top`，阿里云）时，公网链路瞬时抖动暴露三类严重缺陷：

1. **进程自杀**：`cli.ts:710-720` 注释自承——三循环（heartbeat/poll/ws）fire-and-forget 的 async 若抛未捕获 rejection，Node 默认 `--unhandled-rejections=throw` 会让 daemon **静默 exit 1**。实测一次抖动期间 daemon 因 `error=The operation was aborted due to timeout` 累积而自行终止，进程退出、pid 文件消失、服务器端 runtime 离线。现有 handler 只写 stderr，不重启循环、也不保证进程不死。
2. **消息丢失**：`HubClient` 是无重试瘦客户端（`hub-client.ts:135`，蓝图 N-2），`submitMessages` 单次失败即丢弃流式 message。实测一个 interactive turn 的 12 条流式消息全部 submit 超时丢失，backend 侧 AgentRun 内容/token 残缺。**batch task-runner 同样 fire-and-forget**（`task-runner.ts:1147`），同样会丢。
3. **日志不可定位**：`fetch failed`（undici 包装错误）把真实原因（`ECONNREFUSED`/`ENOTFOUND`/`ETIMEDOUT`/证书错误）吞在 `e.cause`，daemon 两处 warn（`daemon.ts:1294` / `:1449`）只打 message。

根因（已排查确认）：远程 backend 健康（外部 12/12 成功 + heartbeat 端点 422 存活 + api-key 有效 + nginx 正常）；本机 Clash 仅系统代理无 TUN，daemon `fetch` 不读代理直连 backend，**元凶是公网链路真实抖动**，叠加 daemon 自身健壮性缺陷。

## 2. 设计目标

- **G1 进程保活**：网络故障绝不导致 daemon 进程退出；三循环异常退出能自愈重启。
- **G2 消息不丢**：submit 失败的流式消息本地暂存，backend 连通后按序补发（覆盖 interactive + batch 两条 submitMessages 路径）。
- **G3 生产强一致**：补发幂等，重复 message 不重复写库（backend 跨调用去重根治）。
- **G4 日志可定位**：网络错误暴露底层 cause（code）。
- **G5 对 backend 友好**：重试仅限可恢复错误 + 退避抖动，不制造请求风暴。

## 3. 非目标

- 不改 daemon 与 LLM 子进程（codex/claude）的代理交互（`all_proxy` 影响 LLM API 是另一回事）。
- 不做 runtime 健康状态的前端展示（属另一变更范围）。
- 不为终态上报（result/complete/end）做暂存补发（语义易与 backend 已判终态冲突；靠轻量重试 + backend lease 超时 + daemon recover 兜底）。
- 不改 WS 协议本身（仅 REST submit_messages 加可选字段）。
- 不处理同机多 daemon 实例的 ownership（已有 ql-006 runtime lock 覆盖）。

## 4. 拆分判断

4 点围绕同一主题（网络层健壮性）且有依赖链（②重试用尽才触发③暂存，④保活贯穿全局），不适合拆成独立变更；非批量场景。作为一个变更按依赖分 Wave 实现。

## 5. 总体方案

架构选型 **方案 B：独立 ResilienceService**（HubClient 保持瘦客户端不动，可靠性逻辑集中到 ResilienceService）。

### Phase 1 — 日志可观测（①）+ daemon 保活（④）

- **日志 cause 透传**：`hub-client._request` 的 fetch reject 透传 `TypeError.cause`；`daemon.ts:1294`（onTurnMessage catch）/ `:1449`（heartbeat catch）warn 展开为 `{ message, cause: { code, message } }`。
- **handler 强化**：`cli.ts:713-720` 的 `unhandledRejection`/`uncaughtException` handler 改为——结构化 FATAL 日志（落 daemon 日志通道，非仅 stderr）+ **绝不 `process.exit`**（吞掉事件保活，但完整记录便于排查）。
- **循环自愈**：`daemon.ts _fire(1421)` 的 `.catch` 内，若 loop 因非 AbortError 异常结束，**自动重新 `_fire` 该循环**（带退避防快速重启风暴），保证三循环永死。
- **断连感知（Grill D1 修正）**：**不主动上报 degraded**——backend `DEFAULT_RUNTIME_STALE_SECONDS=45s`（`runtime/service.py:23` / `cleanup_stale_runtimes`）已因心跳超时自然判 runtime offline，daemon 主动上报滞后且冗余。daemon 侧仅做连续断连计数 + FATAL 日志（运维感知）；核心是保活不退进程，网络恢复后 `_heartbeatLoop` 重新 heartbeat 自动把 runtime 拉回 online（backend `_is_recent_heartbeat` 判定）。config `disconnect_log_threshold_sec`（默认 30s）仅控制 FATAL 日志阈值。

### Phase 2 — submitMessages 重试（②）

> **覆盖范围（Grill C1=B）**：重试+暂存+dedup 覆盖**两条 submitMessages 路径**——interactive `onTurnMessage`（`daemon.ts:1287`）与 batch `task-runner`（`task-runner.ts:1147`，原 fire-and-forget），都改走 ResilienceService。`notifyRunResult`/`completeLease`/`notifySessionEnd` 等终态上报**只加轻量重试（retryTerminal，不暂存补发）**——终态可由 backend lease 超时 + daemon recover 兜底。

- 新增 `sillyhub-daemon/src/resilience/service.ts`（ResilienceService）。
- `submitWithRetry(leaseId, claimToken, runId, envelopes)`：
  - **错误分类 `isRetryable(err)`**：可重试 = `TypeError`（fetch failed）/ `TimeoutError`（AbortSignal.timeout）/ `HubHttpError` 且 status∈{5xx, 429}；不可重试 = `HubHttpError` 4xx（401/403/404/422 直接抛）。
  - **重试**：3 次，退避 `baseDelay × factor^i`（默认 1000ms × 2^i = 1s/2s/4s），±20% 抖动，总上限 ~8s。config 可覆盖。
  - 用尽仍失败 → 进入 Phase 3 暂存。
- `retryTerminal<T>(call)`：终态上报轻量重试（同 isRetryable + 少量次数，不暂存，4xx 直接抛）。
- **调用点改造**：`daemon.onTurnMessage:1287` 与 `task-runner:1147` 改调 `_resilience.submitWithRetry`；`notifyRunResult`/`completeLease`/`notifySessionEnd` 包 `retryTerminal`。`_resilience` 未注入时回退直接调 HubClient（向后兼容 + 测试可注入 mock）。

### Phase 3 — 失败暂存补发（③）+ 幂等根治（D-001@v2）

**daemon**：
- ResilienceService 内置 Outbox（`src/resilience/outbox.ts`），落盘 `~/.sillyhub/daemon/outbox/<runId>.jsonl`（独立目录，避开被测试污染的 `daemon.log`）。
- 每条 message 包装成 `Envelope { message, dedup_key }`。`dedup_key` 确定性生成（见 §7）。
- 重试用尽 → `outbox.enqueue(entry)`（含 leaseId/claimToken/runId/envelopes/ts）；submit 成功 → `markDelivered(runId, dedupKeys)` 原子移除。
- `drainOutbox()`：由 ws `onConnected`（`ws-client.ts:331`）或 heartbeat healthy（`_heartbeatLoop` 成功调 `_resilience.notifyHeartbeatResult(true)`，Grill F2）触发；按 runId 顺序补发；补发前校验 **lease 未过期 + session 非 ended**（ended → warn 丢弃）。
- **claim_token 失效容忍（Grill C2）**：claim_token 在 session recover 时 rotate（`router.py:576`），outbox 暂存的 token 重启/长时间后可能失效。补发遇 422（token 校验失败）→ **warn 丢弃该条**（不无限重试），避免死循环。
- 容量上限：`outbox_max_per_run`（默认 500）/ `outbox_max_total`（默认 5000），超限丢最旧 + warn（防膨胀）。
- **daemon 启动恢复**：构造时 `load()` 现有 outbox 文件，重建 pending 队列。

**backend**：
- `AgentRunLog` 加 `dedup_key` 列（`agent/model.py:285`）。
- migration：加列 + **部分唯一索引** `CREATE UNIQUE INDEX ix_agent_run_logs_run_dedup ON agent_run_logs (run_id, dedup_key) WHERE dedup_key IS NOT NULL`（NULL 不约束，向后兼容）。
- `run_sync/service.py submit_messages`：写入改用 PG `INSERT ... ON CONFLICT DO NOTHING`（`sqlalchemy.dialects.postgresql.insert`）。**Grill F1**：部分唯一索引的 conflict target 需用 `on_conflict_do_nothing(index_elements=["run_id","dedup_key"], index_where=text("dedup_key IS NOT NULL"))` 指定，实现时验证。统一现有 thinking segment 去重（segmentId 作为 dedup_key 来源）。
- 协议 `SubmitMessages` 请求 schema（`daemon/schema.py:173`）`messages: list[dict]` 透传 `dedup_key`。

## 6. 文件变更清单

### sillyhub-daemon
| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `src/resilience/service.ts` | ResilienceService：submitWithRetry + retryTerminal + 错误分类 + drainOutbox + notifyHeartbeatResult |
| 新增 | `src/resilience/outbox.ts` | Outbox：落盘 JSONL + markDelivered + load 恢复 + 容量上限 + 422 丢弃 |
| 新增 | `src/resilience/error-classify.ts` | isRetryable / toCauseInfo 纯函数 |
| 新增 | `src/resilience/__tests__/*.test.ts` | ResilienceService / Outbox / error-classify 测试 |
| 修改 | `src/hub-client.ts` | `_request` fetch reject 透传 cause |
| 修改 | `src/daemon.ts` | onTurnMessage 改调 submitWithRetry；`_fire` 循环自愈；`_heartbeatLoop` 成功调 notifyHeartbeatResult(true)（F2）+ 断连 FATAL 计数（D1，不主动 degraded）；notifyRunResult/notifySessionEnd 包 retryTerminal；两处 warn 展开 cause |
| 修改 | `src/task-runner.ts` | batch submitMessages（`:1147`）改走 submitWithRetry + 生成 dedup_key；completeLease 包 retryTerminal |
| 修改 | `src/cli.ts` | unhandledRejection/uncaughtException handler 强化（结构化 FATAL + 不退进程）；注入 ResilienceService |
| 修改 | `src/config.ts` | 新增 retry_*/outbox_*/disconnect_log_threshold_sec 配置项 + 默认值 |
| 修改 | `src/protocol.ts` | SubmitMessagesBody.messages[].dedup_key 类型 |

### backend
| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `app/modules/agent/model.py` | AgentRunLog 加 `dedup_key` 列 |
| 新增 | `migrations/versions/2026xxxx_add_agent_run_log_dedup_key.py` | 加列 + 部分唯一索引 |
| 修改 | `app/modules/daemon/run_sync/service.py` | submit_messages 用 INSERT ON CONFLICT DO NOTHING（index_where 部分索引）；统一 segment 去重 |
| 修改 | `app/modules/daemon/schema.py` | SubmitMessages 请求 messages 透传 dedup_key |
| 修改 | `app/modules/daemon/tests/test_wave5_integration.py` 等 | 补 dedup_key 去重用例 |

### protocol（共享契约）
- `SubmitMessagesBody.messages[]` 新增可选 `dedup_key: string`。

## 7. 接口定义

### ResilienceService（sillyhub-daemon）
```ts
interface RetryConfig { maxAttempts: number; baseDelayMs: number; backoffFactor: number; jitter: number }
// 默认 maxAttempts=3, baseDelayMs=1000, backoffFactor=2, jitter=0.2

interface Envelope { message: Record<string, unknown>; dedup_key: string }

class ResilienceService {
  constructor(client: HubClient, outbox: Outbox, retry: RetryConfig, logger: Logger)
  // 流式消息：错误分类→重试→用尽入 outbox；成功 markDelivered（interactive + batch 两条路径共用）
  async submitWithRetry(leaseId: string, claimToken: string, runId: string, envelopes: Envelope[]): Promise<void>
  // 终态上报轻量重试：isRetryable 才重试，不暂存，4xx 直接抛
  async retryTerminal<T>(call: () => Promise<T>): Promise<T>
  // ws onConnected / heartbeat healthy 触发：按 runId 顺序补发 pending（遇 422 token 失效丢弃）
  async drainOutbox(): Promise<void>
  // heartbeat 成功→healthy+触发drain+清断连计数；失败→断连计数，超阈值 FATAL
  notifyHeartbeatResult(ok: boolean): void
}

function isRetryable(err: unknown): boolean   // TypeError/TimeoutError/5xx/429 → true；4xx → false
function dedupKeyFor(msg, runId, seq): string  // Claude msg.id 优先；否则 `${runId}:${turnSeq}:${flatSeq}`
```

### Outbox（sillyhub-daemon）
```ts
interface OutboxEntry { leaseId: string; claimToken: string; runId: string; envelopes: Envelope[]; ts: string }
interface Outbox {
  enqueue(entry: OutboxEntry): Promise<void>
  markDelivered(runId: string, dedupKeys: string[]): Promise<void>
  pendingByRun(runId: string): OutboxEntry[]
  load(): Promise<void>  // 启动恢复
}
```

### backend submit_messages 去重（关键伪码）
```python
from sqlalchemy.dialects.postgresql import insert as pg_insert
stmt = pg_insert(AgentRunLog).values(rows)
stmt = stmt.on_conflict_do_nothing(
    index_elements=["run_id", "dedup_key"],
    index_where=text("dedup_key IS NOT NULL"),  # Grill F1：匹配部分唯一索引
)
```

## 7.5 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| submit message（正常/重试） | daemon ResilienceService | backend submit_messages | leaseId, claimToken, agentRunId, messages[].dedup_key | append / dedup_key 命中→ON CONFLICT DO NOTHING |
| submit message（暂存） | daemon Outbox | 本地落盘 | 同上 + ts | outbox pending |
| drain outbox | daemon ResilienceService（onConnected/heartbeat healthy） | backend | 同上 | pending → delivered；遇 422 token 失效丢弃 |
| 终态上报（result/complete/end） | daemon retryTerminal | backend | 各端点字段 | 轻量重试，不暂存；backend lease 超时兜底 |
| lease 失效校验 | daemon（补发前） | backend（隐式） | leaseId | 过期 → warn 丢弃 |
| session 终态 | daemon SessionManager → ResilienceService | — | sessionId, status | ended/failed → 丢弃该 session 待补发项 |
| heartbeat | daemon | backend | runtimeId | 成功→healthy+drain；失败→断连计数；backend 45s 超时自然 offline，恢复后 heartbeat 上线 |

## 8. 数据模型

`AgentRunLog`（`agent/model.py:285`）新增列：
- `dedup_key: str | None = Field(default=None, sa_column=Column(String(100), nullable=True))`

migration：
```sql
ALTER TABLE agent_run_logs ADD COLUMN dedup_key VARCHAR(100);
CREATE UNIQUE INDEX ix_agent_run_logs_run_dedup
  ON agent_run_logs (run_id, dedup_key) WHERE dedup_key IS NOT NULL;
```

`DaemonRuntime.status`（`model.py:64`）：自由 `String(20)`，无需 migration。

## 9. 兼容策略

- **daemon**：ResilienceService 未注入时回退直接调 HubClient；新 config 项有默认值。
- **backend**：`dedup_key` nullable + 部分唯一索引；无 dedup_key 的 message（旧 daemon / batch 未改路径）行不变（NULL 不约束）。ON CONFLICT 仅对非 NULL dedup_key 生效。
- **protocol**：`messages[].dedup_key` 可选；旧 daemon 不发 → backend 当 NULL。
- **现有 thinking segment 去重**：dedup_key 作为通用去重键后，`completed_segments` 可保留或简化为 dedup_key 来源，不破坏现有行为。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | dedup_key 生成不稳定 → 去重失效或误去重 | P0 | Claude 优先 msg.id；Codex/无 id 用 `${runId}:${turnSeq}:${flatSeq}` 确定性；避免 content-hash；测试覆盖 |
| R-02 | AgentRunLog 加列 migration 失败 | P1 | 部分唯一索引向后兼容；本项目可清空兜底 |
| R-03 | 重试风暴加重 backend 压力（auth 占连接耗尽历史） | P1 | 仅重试可恢复错误；4xx fail-fast；退避+抖动；max 3 次 |
| R-04 | outbox 无限膨胀 | P1 | per-run/total 容量上限；超限丢最旧 + warn |
| R-05 | 保活后 WS 重连风暴（同机多实例 ownership） | P1 | 复用 ql-006 runtime lock；_fire 自愈只重启循环不新建连接 |
| R-06 | handler 强化后吞掉真 bug | P1 | FATAL 结构化日志保留（cause + stack） |
| R-07 | daemon 重启恢复 outbox 时 lease 已失效 | P1 | drain 前校验 lease + session 终态，失效则 warn 丢弃 |
| R-08 | ON CONFLICT 与现有 segment 去重冲突 | P2 | 统一到 dedup_key；现有测试回归 |
| R-09 | 终态上报（result/complete/end）失败 → AgentRun 卡 running | P1 | retryTerminal 轻量重试；backend lease 超时 + daemon recover 兜底 |
| R-10 | claim_token rotate → outbox 补发 422 死循环 | P1 | 补发遇 422 丢弃 + warn（C2），不无限重试 |
| R-11 | batch task-runner submit 改走 ResilienceService 影响 fire-and-forget 语义 | P2 | 保持非阻塞（submitWithRetry 内部异步重试）；测试覆盖 batch 去重 |
| R-12 | 部分唯一索引 conflict target 写法不当 → 去重不生效 | P1 | index_where 指定（F1）；migration + 集成测试验证 ON CONFLICT 实际生效 |

## 11. 决策追踪

| 决策 ID | 内容 | 覆盖 | 状态 |
|---|---|---|---|
| D-001@v2 | 幂等=改 backend dedup_key 根治（生产强一致） | §5 Phase3 / §8 / §7 backend 去重 | accepted |
| D-002@v1 | submit_messages 跨调用非幂等（前提） | §1 背景 | accepted（code） |
| D-003@v1 | runtime status 自由 String，无需 migration | §5 Phase1 / §8 | accepted（code） |
| D-004@v1 | 补发触发复用 ws onConnected | §5 Phase3 drainOutbox | accepted（code） |
| D-005@v1（Grill） | 范围=B：两条 submitMessages 路径全覆盖 + 终态轻量重试 | §5 Phase2 范围说明 | accepted（user） |
| D-006@v1（Grill） | 断连不主动 degraded，复用 backend 45s offline | §5 Phase1 断连感知 | accepted（code：stale=45s） |

## 12. 自审

- [x] 必填章节齐全。
- [x] 生命周期契约表覆盖 session/lease/daemon/heartbeat/submit/dedup/终态，每事件有代码任务。
- [x] 文件清单含 sillyhub-daemon + backend + protocol，含 batch task-runner 改造（Grill C1）。
- [x] Grill 5 修正已并入（D1 断连感知 / C1 范围B / C2 token 失效 / F1 部分索引 index_where / F2 drain 注入）。
- [x] 幂等 D-001@v2 代价已记录（test_wave5_integration 等更新）。
- [x] 兼容策略覆盖 daemon/backend/protocol 三层回退。
- [x] Wave 依赖：W1（日志+保活）→ W2（重试，含 batch+终态）→ W3（暂存补发+backend 幂等）。
- [x] 新增 R-09~R-12 覆盖终态/token rotate/batch 语义/部分索引风险。
