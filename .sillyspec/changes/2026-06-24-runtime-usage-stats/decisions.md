---
author: qinyi
created_at: 2026-06-24 10:05:00
change: 2026-06-24-runtime-usage-stats
---

# 决策台账(decisions.md)

本次变更的实现/验收决策台账。仅记录有实现影响的决策。

## D-001@v1: cache 采集做成尽力而为(codex 无 cache)

- **type**: boundary
- **status**: accepted
- **source**: code
- **priority**: P1
- **question**: codex / OpenAI 系 runtime 的 usage 是否有 cache_read/cache_creation?
- **answer**: codex 走 OpenAI 系协议,usage 通常只有 input/output,无 cache_read/write;Claude(Anthropic)有 `cache_creation_input_tokens`/`cache_read_input_tokens`;ndjson(opencode/openclaw/pi)有 `tokens.cache.read`/`write`。
- **normalized_requirement**: daemon 各 adapter 能取则取 cache,取不到(codex)则对应字段不写(NULL);前端缓存项在无数据时显示「—」。
- **impacts**: [Wave1 stream-json.ts、codex-app-server-driver.ts, Wave4 卡片缓存显示, R-01]
- **evidence**: `sillyhub-daemon/src/adapters/stream-json.ts:467-474`(只取 input/output)、`codex-app-server-driver.ts:811-813`、`ndjson.ts:322-325`(已有 cache)

## D-002@v1: 时间窗折线分组粒度

- **type**: boundary
- **status**: accepted
- **source**: docs(对话确认 + 内联)
- **priority**: P1
- **question**: 折线图按什么粒度分组?当日(1 天)如何画?
- **answer**: 当日(1d)按小时分组(24 点),7d/30d 按日分组,避免当日窗口折线为空。
- **normalized_requirement**: `window=1d` 时 `daily` 返回 24 个小时桶(date_trunc('hour'));`7d`/`30d` 返回按日桶(date_trunc('day'))。
- **impacts**: [Wave3 get_runtimes_usage 的 date_trunc, RuntimeUsagePointRead.ts, 前端 x 轴]
- **evidence**: 对话式探索 step 6 + 需求澄清 Grill step 7

## D-003@v1: 聚合按 runtime 合并双路径(superseded by v2)

- **type**: architecture
- **status**: superseded
- **source**: code
- **priority**: P0
- **question**: `AgentRun` 无 `runtime_id` 字段,如何按 runtime 聚合 token/cost?
- **answer**: 合并两路径——interactive run 经 `agent_sessions.runtime_id`,batch run 经 `daemon_task_leases.runtime_id`,`GROUP BY runtime_id` SUM 后合并;interactive 与 batch 的 run 互斥挂 session 或 lease,无重复计算。
- **normalized_requirement**: 聚合 SQL UNION 两路径求和,漏掉 lease 路径会少算 batch run 的 token。
- **impacts**: [Wave3 get_runtimes_usage SQL, R-03]
- **evidence**: `backend/app/modules/agent/model.py:195-217`(agent_session_id/lease_id FK)、`router.py:1270-1278`(已有 JOIN daemon_runtimes 模式)

## D-003@v2: 聚合用 LEFT JOIN+COALESCE(替代 UNION 双路径)

- **type**: architecture
- **status**: accepted
- **supersedes**: D-003@v1
- **source**: design-grill
- **priority**: P0
- **question**: D-003@v1 的 UNION 双路径(interactive 经 session.runtime_id + batch 经 lease.runtime_id)是否会重复计算?
- **answer**: 会。interactive run 经 lease 关联(`run_sync/service.py:359-365` close_interactive_run 用 lease.agent_run_id 定位 run)且 agent_session_id 非空(`run_sync/service.py:286` 以 `agent_session_id IS NULL` 区分 batch),故 interactive run 同时有 agent_session_id 和 lease_id,UNION 两路径都会命中 → token 被算两次。
- **normalized_requirement**: 聚合用单条 SQL `agent_runs r LEFT JOIN agent_sessions s ON r.agent_session_id=s.id LEFT JOIN daemon_task_leases l ON r.lease_id=l.id`,`GROUP BY COALESCE(s.runtime_id, l.runtime_id)`。每 run LEFT JOIN 后唯一一行(两 FK 各指向唯一 session/lease 行),COALESCE 优先 session.runtime_id,天然去重。
- **impacts**: [Wave3 get_runtimes_usage SQL, R-03 resolved]
- **evidence**: `run_sync/service.py:359-365, 286`(lease.agent_run_id 定位 + agent_session_id IS NULL 区分 batch)、`agent/model.py:195-202`(agent_session_id FK)、`daemon/model.py:208`(lease.runtime_id)

## D-004@v1: 当日=本地自然日 + 非实时刷新

- **type**: boundary
- **status**: accepted
- **source**: docs(内联)
- **priority**: P2
- **question**: 「当日」时间窗的起点?卡片数字是否实时刷新?
- **answer**: 「当日」= 本地时区今天 00:00 起(`created_at >= today 00:00 local`);卡片数字非实时刷新,进页面 + 切窗时拉取(YAGNI,不做 SSE 推卡片聚合)。
- **normalized_requirement**: since 计算按本地自然日;前端不订阅 usage SSE,仅切窗/进页面触发 `getRuntimesUsage`。
- **impacts**: [Wave3 since 计算(created_at 为 timestamptz,需本地日零点转 UTC), Wave4 数据获取时机]
- **evidence**: 需求澄清 Grill step 7
