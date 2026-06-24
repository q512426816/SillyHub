---
author: qinyi
created_at: 2026-06-24T14:14:57
---

# 决策台账 — daemon 网络层可靠性 + 进程保活增强

本变更的决策台账（只记录有实现/验收影响的决策）。

---

## D-001@v1: 补发幂等 = daemon 持久化已送达 id

- type: architecture
- status: **superseded**（被 D-001@v2 取代）
- source: user
- question: backend submit_messages 跨调用非幂等，daemon 暂存补发重发可能重复写库，怎么处理？
- answer（原）: daemon 落盘暂存时记录每条 message 稳定 id，补发跳过已确认送达的；极小窗口（请求到 backend 但 daemon 超时判失败）容忍重复，依赖前端 normalize 去重；不改 backend。
- superseded 理由: 用户改主意——生产系统要求强一致根治重复，倾向改 backend 加幂等键（见 D-001@v2）。

---

## D-001@v2: 补发幂等 = 改 backend 加 dedup_key 根治

- type: architecture
- status: accepted
- source: user
- question: 同 D-001@v1，但生产系统要强一致。
- answer: backend AgentRunLog 加 `dedup_key` 列 + 部分唯一索引 `(run_id, dedup_key) WHERE dedup_key IS NOT NULL`；submit_messages 用 PG `INSERT ... ON CONFLICT DO NOTHING` 跨调用去重；统一现有 thinking segment 去重（segmentId 作为 dedup_key 来源）。daemon 侧 ResilienceService 给每条 flat message 生成稳定 dedup_key（Claude 用 msg.id，Codex/无 id 用 `${runId}:${turnSeq}:${flatSeq}`）。protocol `messages[].dedup_key` 透传。
- normalized_requirement: 重复 submit 同一 (run_id, dedup_key) 的 message，backend 仅落库一行（幂等）。
- impacts: FR-补发幂等 / backend migration / test_wave5_integration 更新
- evidence: run_sync/service.py:48/98-104（跨调用非幂等注释）、agent/model.py:285（AgentRunLog 无 dedup_key 列）、用户第 8 步回答

---

## D-002@v1: submit_messages 跨调用非幂等（前提）

- type: premise
- status: accepted
- source: code
- question: backend submit_messages 是否跨调用幂等？
- answer: 非幂等。AgentRunLog 是 append-only，仅"单次调用内按 thinking segmentId 去重"（completed_segments set，run_sync/service.py:98-104）；注释明说"跨调用去重交给前端 normalize（task-14）"。
- normalized_requirement: 暂存补发必须依赖 D-001@v2 的 dedup_key 才能避免重复写库。
- impacts: D-001@v2 / FR-补发幂等
- evidence: run_sync/service.py:48/98-104/872/909、test_wave5_integration.py:720-727

---

## D-003@v1: runtime degraded 上报无需 migration

- type: architecture
- status: accepted
- source: code
- question: daemon 断连告警上报 runtime degraded 是否需要改 backend 数据模型？
- answer: 不需要。DaemonRuntime.status 是自由 `String(20)`（model.py:64），已知值 online/offline，新增 `degraded` 仅是新值，无需 migration。daemon 调现有 offline 端点（`POST /api/daemon/runtimes/{id}/offline`，hub-client.ts:303）上报即可。
- normalized_requirement: 断连超阈值时 daemon 调 offline 端点上报 status=degraded，不引入新表/新列。
- impacts: FR-断连告警
- evidence: daemon/model.py:64-67、hub-client.ts:298-303

---

## D-004@v1: 补发触发复用 ws onConnected

- type: architecture
- status: accepted
- source: code
- question: outbox 补发由什么触发？（复用现有信号 vs 新建 drainLoop）
- answer: 复用 ws-client 的 `onConnected` 回调（ws-client.ts:331-335，每次重连成功触发）+ heartbeat healthy 信号双触发。不新建独立周期 drainLoop（避免额外循环与 _fire 重复）。
- normalized_requirement: WS 重连成功或 heartbeat 成功时触发 ResilienceService.drainOutbox()。
- impacts: FR-补发触发
- evidence: ws-client.ts:50-67/331-335、daemon.ts _heartbeatLoop:1440

---

## D-005@v1: 范围 = B（两条 submitMessages 路径 + 终态轻量重试）

- type: architecture
- status: accepted
- source: user（Design Grill C1）
- question: 重试/暂存/dedup 覆盖哪些 daemon→backend 写调用？
- answer: 重试+暂存+dedup 覆盖**两条 submitMessages 路径**（interactive `onTurnMessage` `daemon.ts:1287` + batch `task-runner.ts:1147`，后者原本 fire-and-forget 同样会丢）。`notifyRunResult`/`completeLease`/`notifySessionEnd` 等终态上报**只加 retryTerminal 轻量重试，不暂存补发**（终态可由 backend lease 超时 + daemon recover 兜底，暂存补发易与 backend 已判终态冲突）。
- normalized_requirement: interactive + batch 两条流式消息路径都走 ResilienceService.submitWithRetry；3 个终态端点走 retryTerminal。
- impacts: FR-04 / FR-05 / FR-10
- evidence: task-runner.ts:1147（batch 也调 submitMessages，fire-and-forget）、用户 Grill 回答

---

## D-006@v1: 断连不主动上报 degraded

- type: architecture
- status: accepted
- source: code（Design Grill D1）
- question: daemon 断连告警是否主动上报 runtime degraded？是否需改 backend？
- answer: **不主动上报**。backend `DEFAULT_RUNTIME_STALE_SECONDS=45s`（`runtime/service.py:23` / `cleanup_stale_runtimes`）已因心跳超时自然判 runtime offline，daemon 主动上报滞后且冗余。daemon 侧仅做连续断连计数 + FATAL 日志（运维感知）；核心是保活不退进程，网络恢复后 `_heartbeatLoop` 重新 heartbeat 自动把 runtime 拉回 online（`_is_recent_heartbeat` 判定）。
- normalized_requirement: daemon 不调 offline 端点上报 degraded；仅 FATAL 日志计数；恢复后 heartbeat 自动上线。
- impacts: FR-03
- evidence: runtime/service.py:23（stale=45s）/277-298/314-318
