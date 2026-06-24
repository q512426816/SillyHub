---
author: qinyi
created_at: 2026-06-24 14:30:00
---

# Tasks — daemon 网络层可靠性 + 进程保活增强

任务按 Wave 分组（细节在 plan 阶段展开）。每任务列：名称 / 文件 / 覆盖 FR·D。

## Wave 1 — 日志可观测 + daemon 保活（止血，独立可交付）

| ID | 名称 | 文件 | 覆盖 |
|---|---|---|---|
| task-01 | hub-client._request fetch reject 透传 cause | `sillyhub-daemon/src/hub-client.ts` | FR-01 |
| task-02 | daemon.ts 两处 warn（onTurnMessage/heartbeat）展开 cause | `sillyhub-daemon/src/daemon.ts` | FR-01 |
| task-03 | cli.ts unhandledRejection/uncaughtException handler 强化（结构化 FATAL + 不退进程） | `sillyhub-daemon/src/cli.ts` | FR-02 |
| task-04 | daemon.ts _fire 循环自愈重启（带退避） | `sillyhub-daemon/src/daemon.ts` | FR-02 |
| task-05 | daemon.ts 断连 FATAL 计数（disconnect_log_threshold_sec） | `sillyhub-daemon/src/daemon.ts` / `config.ts` | FR-03 / D-006 |
| task-06 | W1 测试：cause 透传 + handler 不退进程 + _fire 自愈 | `sillyhub-daemon/src/**/__tests__/` | FR-01/02/03 |

## Wave 2 — submitMessages 重试（interactive + batch + 终态）

| ID | 名称 | 文件 | 覆盖 |
|---|---|---|---|
| task-07 | 新增 resilience/error-classify.ts（isRetryable / toCauseInfo） | `sillyhub-daemon/src/resilience/error-classify.ts` | FR-04 |
| task-08 | 新增 resilience/service.ts ResilienceService（submitWithRetry + retryTerminal + notifyHeartbeatResult） | `sillyhub-daemon/src/resilience/service.ts` | FR-04 / FR-05 |
| task-09 | config 新增 retry_* 配置项 + 默认值 | `sillyhub-daemon/src/config.ts` | FR-04 |
| task-10 | daemon.onTurnMessage 改调 _resilience.submitWithRetry（+ 回退兼容） | `sillyhub-daemon/src/daemon.ts` | FR-04 |
| task-11 | task-runner batch submit（:1147）改走 submitWithRetry + 生成 dedup_key（保持非阻塞） | `sillyhub-daemon/src/task-runner.ts` | FR-10 / D-005 |
| task-12 | notifyRunResult/completeLease/notifySessionEnd 包 retryTerminal | `sillyhub-daemon/src/daemon.ts` / `task-runner.ts` | FR-05 |
| task-13 | cli.ts 注入 ResilienceService | `sillyhub-daemon/src/cli.ts` | FR-04 |
| task-14 | W2 测试：error-classify + submitWithRetry 重试/退避/错误分类 + retryTerminal + batch 路径 | `sillyhub-daemon/src/resilience/__tests__/` | FR-04/05/10 |

## Wave 3 — 失败暂存补发 + 幂等根治（跨子项目，依赖 W2）

| ID | 名称 | 文件 | 覆盖 |
|---|---|---|---|
| task-15 | 新增 resilience/outbox.ts（落盘 JSONL + markDelivered + load 恢复 + 容量上限） | `sillyhub-daemon/src/resilience/outbox.ts` | FR-06 / FR-09 |
| task-16 | dedup_key 生成（dedupKeyFor：Claude msg.id / Codex runId+seq） | `sillyhub-daemon/src/resilience/error-classify.ts` 或 service.ts | FR-08 |
| task-17 | submitWithRetry 用尽入 outbox + 成功 markDelivered | `sillyhub-daemon/src/resilience/service.ts` | FR-06 |
| task-18 | drainOutbox（onConnected/heartbeat healthy 触发 + lease/session 终态校验 + 422 token 容忍） | `sillyhub-daemon/src/resilience/service.ts` / `daemon.ts`（_heartbeatLoop 调 notifyHeartbeatResult，F2） | FR-07 / D-004 |
| task-19 | protocol SubmitMessagesBody.messages[].dedup_key | `sillyhub-daemon/src/protocol.ts` / `backend/app/modules/daemon/schema.py` | FR-08 |
| task-20 | backend AgentRunLog 加 dedup_key 列 + migration（部分唯一索引） | `backend/app/modules/agent/model.py` / `migrations/` | FR-08 / R-12 |
| task-21 | backend submit_messages INSERT ON CONFLICT DO NOTHING（index_where 部分索引）+ 统一 segment 去重 | `backend/app/modules/daemon/run_sync/service.py` | FR-08 / D-001@v2 |
| task-22 | backend submit_messages 测试更新（dedup_key 去重 / NULL 兼容 / segment 统一） | `backend/app/modules/daemon/tests/test_wave5_integration.py` 等 | FR-08 |
| task-23 | W3 测试：outbox 落盘/恢复/drain/token 422/容量 + backend 幂等集成 | `sillyhub-daemon/src/resilience/__tests__/` / `backend/.../tests/` | FR-06/07/08/09 |

## 说明

- W1 先行止血（日志 + 保活），独立可交付、不依赖 backend。
- W2 在 sillyhub-daemon 内完成重试（含 batch + 终态）。
- W3 跨子项目（daemon outbox + backend 幂等 + protocol），依赖 W2 的 ResilienceService。
- 每个 Wave 完成后跑对应测试（`cd sillyhub-daemon && pnpm test` / `cd backend && uv run pytest`）。
