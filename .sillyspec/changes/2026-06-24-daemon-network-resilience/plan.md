---
author: qinyi
created_at: 2026-06-24T14:40:00+08:00
plan_level: full
---

# 实现计划：daemon-network-resilience

> 来源：design.md（§5 Phase1-3 / §6 文件清单 / §7.5 契约表 / §10 风险）、tasks.md（W1-W3 + 23 task）、decisions.md（D-001@v2~D-006 全 accepted，D-001@v1 superseded）。
> 约束：跨子项目（sillyhub-daemon 主 + backend 幂等 + protocol）；W1 先行止血可独立交付；HubClient 保持瘦客户端不动（N-2 蓝图）；每 Wave 独立提交 + 独立验收。

## Spike 前置验证

本变更有两个需提前验证的技术点（W3 才落地，但风险高）：

| 验证点 | 承载 | 不通过后果 |
|---|---|---|
| PG 部分唯一索引 `ON CONFLICT DO NOTHING` 的 `index_where` 写法（R-12） | task-20/21（migration + 集成测试） | 调整为应用层 SELECT 去重（性能下降但功能等价） |
| daemon 重启后 outbox load 恢复 + claim_token rotate 422 容忍（R-07/R-10） | task-15/18（outbox + drain 测试） | 缺失 token 的条目丢弃（可接受，warn 记录） |

## Wave 1（无依赖 — 止血：日志 + 保活，sillyhub-daemon 内独立可交付）
- [x] task-01: `hub-client._request` fetch reject 透传 `TypeError.cause`（不吞底层 code）（覆盖：FR-01）
- [x] task-02: `daemon.ts:1294`（onTurnMessage）+ `:1449`（heartbeat）warn 展开 `{ message, cause: { code, message } }`（覆盖：FR-01）
- [x] task-03: `cli.ts:713-720` unhandledRejection/uncaughtException handler 强化（结构化 FATAL 日志 + 绝不 process.exit）（覆盖：FR-02）
- [x] task-04: `daemon.ts _fire(1421)` 循环自愈——loop 非 AbortError 异常结束时带退避重启（覆盖：FR-02）
- [x] task-05: `daemon.ts` 断连 FATAL 计数（`disconnect_log_threshold_sec` 默认 30s；不主动 degraded，复用 backend 45s offline）（覆盖：FR-03, D-003, D-006）
- [x] task-06: W1 测试——cause 透传 / handler 不退进程 / _fire 自愈 / 断连计数（覆盖：FR-01, FR-02, FR-03）

## Wave 2（依赖 W1 — 重试：interactive + batch + 终态，sillyhub-daemon 内）
- [x] task-07: 新增 `resilience/error-classify.ts`（isRetryable / toCauseInfo 纯函数）（覆盖：FR-04）
- [x] task-08: 新增 `resilience/service.ts` ResilienceService（submitWithRetry + retryTerminal + notifyHeartbeatResult + drainOutbox 占位）（覆盖：FR-04, FR-05）
- [x] task-09: `config.ts` 新增 retry_* 配置项 + 默认值（maxAttempts=3/baseDelayMs=1000/backoffFactor=2/jitter=0.2）（覆盖：FR-04）
- [x] task-10: `daemon.onTurnMessage:1287` 改调 `_resilience.submitWithRetry`（+ 未注入回退直接调 HubClient）（覆盖：FR-04）
- [x] task-11: `task-runner.ts:1147` batch submit 改走 submitWithRetry + 生成 dedup_key（保持非阻塞）（覆盖：FR-10, D-005）
- [x] task-12: notifyRunResult/completeLease/notifySessionEnd 包 `retryTerminal` 轻量重试（覆盖：FR-05）
- [x] task-13: `cli.ts` 注入 ResilienceService（构造时传入 client/outbox/config/logger）（覆盖：FR-04）
- [x] task-14: W2 测试——error-classify / submitWithRetry 重试退避错误分类 / retryTerminal / batch 路径（覆盖：FR-04, FR-05, FR-10）

## Wave 3（依赖 W2 — 暂存补发 + 幂等根治，跨子项目）
- [ ] task-15: 新增 `resilience/outbox.ts`（落盘 JSONL `~/.sillyhub/daemon/outbox/<runId>.jsonl` + markDelivered + load 恢复 + 容量上限）（覆盖：FR-06, FR-09）
- [ ] task-16: `dedupKeyFor`（Claude msg.id 优先；否则 `${runId}:${turnSeq}:${flatSeq}`）（覆盖：FR-08）
- [ ] task-17: submitWithRetry 用尽入 outbox + 成功 markDelivered（覆盖：FR-06）
- [ ] task-18: drainOutbox 实现（ws onConnected / heartbeat healthy 触发；补发前校验 lease 未过期 + session 非 ended；遇 422 token 失效丢弃；`_heartbeatLoop` 成功调 notifyHeartbeatResult）（覆盖：FR-07, D-004）
- [ ] task-19: protocol SubmitMessagesBody.messages[].dedup_key（sillyhub-daemon protocol.ts + backend schema.py 透传）（覆盖：FR-08）
- [ ] task-20: backend `AgentRunLog` 加 `dedup_key` 列 + migration（部分唯一索引 `WHERE dedup_key IS NOT NULL`）（覆盖：FR-08, R-12）
- [ ] task-21: backend `run_sync/service.py submit_messages` 用 `INSERT ON CONFLICT DO NOTHING`（index_where 部分索引）+ 统一 thinking segment 去重（覆盖：FR-08, D-001@v2, D-002）
- [ ] task-22: backend submit_messages 测试更新（dedup_key 去重 / NULL 兼容 / segment 统一）（覆盖：FR-08）
- [ ] task-23: W3 测试——outbox 落盘/恢复/drain/token 422/容量 + backend 幂等集成（覆盖：FR-06, FR-07, FR-08, FR-09）

## 调用点搜索（构造/接口变更调用方全量纳入）

- `submitMessages` 调用点（改走 submitWithRetry）：`grep -rn "\.submitMessages(" sillyhub-daemon/src` →
  - `daemon.ts:1287`（interactive onTurnMessage）→ task-10
  - `task-runner.ts:1147`（batch，原 fire-and-forget）→ task-11
  - （`hub-client.ts:107` 是方法定义非调用；`daemon.ts:247` 是类型引用）
- 终态上报调用点（包 retryTerminal）：`notifyRunResult`（daemon onTurnResult）/ `completeLease`（task-runner）/ `notifySessionEnd`（daemon onSessionEnd）→ task-12
- ResilienceService 注入点：`cli.ts` 构造 Daemon 时 → task-13
- backend `submit_messages` 写入点：`run_sync/service.py:48`（唯一写入 AgentRunLog 的 submit 路径）→ task-21
- 结论：无遗漏调用点，全部纳入对应 task。

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | hub-client cause 透传 | W1 | P0 | — | FR-01 | `_request` 不吞 TypeError.cause |
| task-02 | daemon 两处 warn 展开 cause | W1 | P0 | task-01 | FR-01 | 1294/1449 |
| task-03 | cli handler 强化不退进程 | W1 | P0 | — | FR-02 | 713-720 |
| task-04 | _fire 循环自愈 | W1 | P0 | — | FR-02 | 1421 带退避重启 |
| task-05 | 断连 FATAL 计数 | W1 | P1 | — | FR-03/D-003/D-006 | 不主动 degraded |
| task-06 | W1 测试 | W1 | P0 | 01-05 | FR-01/02/03 | vitest |
| task-07 | error-classify.ts | W2 | P0 | — | FR-04 | isRetryable/toCauseInfo |
| task-08 | ResilienceService | W2 | P0 | task-07 | FR-04/05 | submitWithRetry/retryTerminal |
| task-09 | config retry_* | W2 | P1 | — | FR-04 | 默认值 |
| task-10 | onTurnMessage 改调 | W2 | P0 | task-08 | FR-04 | 1287 + 回退 |
| task-11 | batch task-runner 改调 | W2 | P0 | task-08 | FR-10/D-005 | 1147 + dedup_key |
| task-12 | 终态 retryTerminal | W2 | P1 | task-08 | FR-05 | result/complete/end |
| task-13 | cli 注入 ResilienceService | W2 | P0 | task-08/15 | FR-04 | 构造注入 |
| task-14 | W2 测试 | W2 | P0 | 07-12 | FR-04/05/10 | vitest |
| task-15 | outbox.ts | W3 | P0 | — | FR-06/09 | 落盘+恢复+容量 |
| task-16 | dedupKeyFor | W3 | P0 | — | FR-08 | msg.id/runId+seq |
| task-17 | submitWithRetry 入 outbox | W3 | P0 | task-08/15/16 | FR-06 | 用尽入/成功移 |
| task-18 | drainOutbox | W3 | P0 | task-15/17 | FR-07/D-004 | 触发+校验+422 |
| task-19 | protocol dedup_key | W3 | P0 | — | FR-08 | daemon+backend |
| task-20 | backend dedup_key 列+migration | W3 | P0 | — | FR-08/R-12 | 部分唯一索引 |
| task-21 | backend ON CONFLICT 去重 | W3 | P0 | task-20 | FR-08/D-001@v2/D-002 | index_where |
| task-22 | backend 测试更新 | W3 | P0 | task-21 | FR-08 | test_wave5 等 |
| task-23 | W3 测试 | W3 | P0 | 15-22 | FR-06/07/08/09 | daemon+backend |

## 关键路径

task-03/04（W1 保活）→ task-08（W2 ResilienceService）→ task-15（W3 outbox）→ task-20/21（W3 backend 幂等）→ task-23（W3 集成测试）

> W1 保活是止血核心（用户遇到的进程自杀）；W2 ResilienceService 是 W3 的前置（outbox 由 submitWithRetry 触发）；W3 backend 幂等（dedup_key）是生产强一致的关键，跨子项目需 daemon（task-16/19）与 backend（task-20/21）协同。

## 全局验收标准

- **sillyhub-daemon**：`cd sillyhub-daemon && pnpm test`（vitest）通过 + `pnpm typecheck`（tsc --noEmit）通过。
- **backend**：`cd backend && uv run pytest -q`（含 `test_wave5_integration` / `test_run_sync_cache_parse` 去重用例）通过 + `uv run ruff check . && uv run ruff format --check . && uv run mypy app` 通过。
- **backend migration**：`cd backend && uv run alembic upgrade head` 成功（dedup_key 列 + 部分唯一索引）。
- **进程保活（FR-02）**：模拟三循环抛非 AbortError 异常，daemon 进程不 exit、loop 自愈重启。
- **消息不丢（FR-06/07/09）**：模拟 submit 3 次重试全失败 → 消息落盘 outbox → 模拟 ws onConnected → drain 补发成功；daemon 重启后 load 恢复 pending。
- **幂等（FR-08/D-001@v2）**：重复 submit 同一 `(run_id, dedup_key)` → backend AgentRunLog 仅落库一行（ON CONFLICT DO NOTHING）；无 dedup_key 的 message 照常 append（NULL 不约束）。
- **日志（FR-01）**：fetch failed 日志含 cause.code（如 ECONNREFUSED）。
- **token 失效容忍（FR-07/R-10）**：drain 遇 422 → warn 丢弃该条，不无限重试。
- **兼容（NFR-01）**：ResilienceService 未注入时 onTurnMessage/task-runner 回退直接调 HubClient。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v2 | task-16/19/20/21/22 | AC: 重复 (run_id,dedup_key) 仅落库一行（ON CONFLICT） |
| D-002@v1 | task-21 | AC: submit_messages 跨调用去重生效（前提：非幂等→dedup_key 根治） |
| D-003@v1 | task-05 | AC: 不调 offline 端点上报 degraded；FATAL 计数 |
| D-004@v1 | task-18 | AC: ws onConnected / heartbeat healthy 触发 drain |
| D-005@v1 | task-11/12 | AC: interactive+batch 两条 submit 走 submitWithRetry；终态走 retryTerminal |
| D-006@v1 | task-05 | AC: 断连不主动 degraded，复用 backend 45s offline |

| FR | 覆盖任务 | 验收证据 |
|---|---|---|
| FR-01 | task-01/02/06 | fetch failed 日志含 cause.code |
| FR-02 | task-03/04/06 | 三循环异常进程不退 + 自愈重启 |
| FR-03 | task-05/06 | 断连 FATAL 计数，不主动 degraded |
| FR-04 | task-07/08/09/10/14 | submitWithRetry 3 次退避 + 错误分类 |
| FR-05 | task-08/12/14 | 终态 retryTerminal 轻量重试 |
| FR-06 | task-15/17/23 | 用尽入 outbox + markDelivered |
| FR-07 | task-18/23 | drain 触发 + 终态校验 + token 422 容忍 |
| FR-08 | task-16/19/20/21/22/23 | dedup_key 幂等根治（daemon 生成 + backend ON CONFLICT） |
| FR-09 | task-15/23 | daemon 重启 load 恢复 outbox |
| FR-10 | task-11/14 | batch task-runner 走 submitWithRetry + dedup_key |
