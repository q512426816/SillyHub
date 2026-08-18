---
schema_version: 1
doc_type: module-card
module_id: resilience
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 网络层韧性三件套（resilience）

## 定位
daemon 网络层韧性三件套（目录 `src/resilience/`，3 文件）：service 重试编排
（ResilienceService）、outbox 失败消息落盘暂存（FileOutbox）、error-classify
错误分类纯函数。解决 WS/HTTP 断线时流式消息与终态上报不丢：退避重试用尽入
outbox，恢复后 drain 补发；幂等靠 dedup_key + backend ON CONFLICT DO NOTHING。

## 契约摘要
- `ResilienceService(client: SubmitClient, outbox: Outbox|null, retry: RetryConfig, logger, validity?: DrainValidityChecker|null)`：
  - `submitWithRetry(leaseId, claimToken, runId, envelopes)`——流式消息退避重试；
    4xx fail-fast 立即抛；用尽入 outbox（outbox 为 null 则 warn 丢，W2 行为）；
    成功 markDelivered。
  - `retryTerminal<T>(call)`——终态上报（notifyRunResult/completeLease 等）轻量
    重试，不暂存，用尽抛（幂等靠 claim_token rotate 兜底）。
  - `notifyHeartbeatResult(ok)`——维护 healthy 信号，ok 且有 outbox 时触发 drain。
  - `drainOutbox()`——按 runId 顺序补发 pending（ws onConnected / 心跳健康触发）。
- `Envelope = { message, dedup_key }`；`OutboxEntry = { leaseId, claimToken, runId, envelopes, ts }`；
  `Outbox` 接口：enqueue / markDelivered / pendingByRun / runs / load。
- `FileOutbox(dir, { maxPerRun, maxTotal }, logger)`——每 run 一个 `<dir>/<runId>.jsonl`。
- `isRetryable(err)`：TypeError（fetch failed）/ TimeoutError / HubHttpError
  status∈{429,500,502,503,504} → true；AbortError（主动停止）与其余 4xx → false。
- `toCauseInfo(err)`：压平为 `{ message, code?, status? }` 供日志。
- `dedupKeyFor(msg, runId, turnSeq?, flatSeq?)`：msg.id 优先，否则 `runId:turnSeq:flatSeq`。
- `RetryConfig`（来自 DaemonConfig 的 retry_* 字段）：maxAttempts / baseDelayMs /
  backoffFactor / jitter；退避延迟 `base × factor^i ± jitter`，截断 MAX_BACKOFF_MS=8000。
- `DrainValidityChecker = { isLeaseValid(leaseId), isSessionEnded(runId) }`——
  daemon 注入的补发前终态校验（true = 不可补发应丢弃）；未注入时 drain 仅按
  网络结果处理（422 仍丢弃）。
- 依赖 hub-client（HubHttpError / SubmitClient 最小接口避免循环 import）；被
  cli / daemon / task-runner 使用。

## 关键逻辑
```
submitWithRetry: for i < maxAttempts: submitMessages(..., messages 含 dedup_key 顶层注入)
  成功 → markDelivered；4xx → 抛；可重试 → sleep(base×factor^i ± jitter, 截断 8s)
  用尽 → outbox.enqueue(entry) 或 warn 丢
drainOutbox(防重入 _draining):
  lease 过期 / session ended（validity 校验）→ 丢弃该 run
  422（claim_token rotate 失效 R-10）/ 其它 4xx（终态业务错）→ 丢弃
  可重试用尽 → 保留 entry 待下轮；成功 → markDelivered
FileOutbox.markDelivered: 读全 → 过滤 dedup_key → 写临时 → rename（原子）；
  enqueue 超容量（per-run/total）丢最旧 + warn（R-04）
```

## 注意事项
- dedup_key 提交时注入 message 顶层字段（envelope.dedup_key 仅 daemon 内部
  markDelivered 用）；明确不用 content-hash——相同内容不同 turn/seq 不去重（R-01 误去重）。
- isRetryable 里 AbortError 判断必须先于 TimeoutError（某些 abort 场景 name 含
  timeout 字样）。
- drainOutbox 外层兜底 catch：runs()/校验回调抛异常时记 warn 不重抛，_draining
  由 finally 复位（D4 2026-07-24：void 调用未捕获会成 unhandled rejection）。
- FileOutbox eviction 同步 await 落盘（fire-and-forget 会与外部 rm -rf 在 Windows
  上竞态 EBUSY）；load 启动 glob 读入内存，损坏行跳过 + warn 不整体崩。
- daemon→backend 的 usage/cost 上报也走本服务（notifyRunResult + mergeAdapterUsage），
  非 submitMessages 直传。
- drain 触发点：ws onConnected 重连成功 + 心跳恢复 healthy 两处；W2 阶段 outbox
  可为 null（submitWithRetry 用尽仅 warn 丢），W3（task-15/17/18）起接通真实 FileOutbox。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
