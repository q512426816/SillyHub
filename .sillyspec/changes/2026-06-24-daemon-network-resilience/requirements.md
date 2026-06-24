---
author: qinyi
created_at: 2026-06-24 14:30:00
---

# Requirements — daemon 网络层可靠性 + 进程保活增强

## 角色

| 角色 | 说明 |
|---|---|
| daemon（sillyhub-daemon） | 本地守护进程，发起 submitMessages/终态上报/heartbeat，本变更主体 |
| backend | 接收 submit_messages，写 AgentRunLog；本变更加 dedup_key 幂等 |
| interactive session（claude/codex driver） | 经 onTurnMessage 上交流式消息 |
| batch task-runner | 经 _submitEvent 上交流式消息（fire-and-forget） |
| 运维/用户 | 依赖日志定位网络故障、依赖 daemon 不中断 |

## 功能需求（FR）

### FR-01 网络错误日志暴露 cause（①）
daemon 网络请求失败时，日志暴露底层 cause code（`ECONNREFUSED`/`ENOTFOUND`/`ETIMEDOUT`/证书等），而非仅 `fetch failed`。
- Given daemon → backend 的 fetch 抛 TypeError（fetch failed）
- When hub-client._request reject / daemon.ts onTurnMessage catch / _heartbeatLoop catch 记日志
- Then 日志含 `{ message, cause: { code, message } }`

### FR-02 daemon 进程保活（④）
网络故障下 daemon 进程不退出；三循环异常退出能自愈重启。
- Given 三循环（heartbeat/poll/ws）某 loop 抛非 AbortError 异常
- When `_fire` catch 捕获
- Then 该 loop 自动重启（带退避），进程**不 exit**；unhandledRejection/uncaughtException handler 记 FATAL 但不 process.exit

### FR-03 断连感知（不主动 degraded）
daemon 仅做连续断连 FATAL 计数；不主动上报 degraded（复用 backend 45s 心跳超时 offline）。
- Given heartbeat 连续失败超 `disconnect_log_threshold_sec`（默认 30s）
- When 计数超阈值
- Then 记 FATAL 日志；**不**调 offline 端点；网络恢复后 heartbeat 自动把 runtime 拉回 online

### FR-04 submitMessages 重试 + 错误分类（②·interactive + batch）
两条 submitMessages 路径（interactive onTurnMessage、batch task-runner）改走 ResilienceService.submitWithRetry。
- Given submit 抛可重试错误（fetch failed/timeout/5xx/429）
- When submitWithRetry 处理
- Then 重试 3 次，退避 1s→2s→4s（±20% 抖动），总上限 ~8s
- Given 抛不可重试错误（4xx 401/403/404/422）
- Then 立即抛出，不重试

### FR-05 终态上报轻量重试（范围 B）
notifyRunResult/completeLease/notifySessionEnd 包 retryTerminal 轻量重试，不暂存。
- Given 终态上报抛可重试错误
- When retryTerminal 处理
- Then 少量重试（不暂存补发）；4xx 直接抛

### FR-06 失败暂存 outbox（③）
重试用尽后，message 落盘暂存。
- Given submitWithRetry 3 次重试均失败
- When 用尽
- Then envelopes（含 dedup_key）append 到 `~/.sillyhub/daemon/outbox/<runId>.jsonl`
- And submit 成功后 markDelivered 原子移除
- And 超 per-run/total 容量上限丢最旧 + warn

### FR-07 补发 drain（触发 + 校验 + token 容忍）
ws onConnected / heartbeat healthy 触发 drainOutbox，按序补发，校验终态，容忍 token 失效。
- Given outbox 有 pending 且 ws 重连成功（onConnected）或 heartbeat 成功
- When drainOutbox
- Then 按 runId 顺序补发；补发前校验 lease 未过期 + session 非 ended（ended → warn 丢弃）
- And 遇 422（claim_token rotate 失效）→ warn 丢弃该条，不无限重试

### FR-08 幂等 dedup_key 根治（D-001@v2·backend + protocol）
backend AgentRunLog 加 dedup_key + 部分唯一索引 + ON CONFLICT DO NOTHING；daemon 生成稳定 dedup_key。
- Given daemon 重发同一 (run_id, dedup_key) 的 message
- When backend submit_messages 写入
- Then ON CONFLICT (run_id, dedup_key) DO NOTHING，**仅落库一行**
- Given message 无 dedup_key（旧路径）
- Then dedup_key=NULL 不受约束，照常 append（兼容）

### FR-09 daemon 重启恢复 outbox
daemon 启动时加载现有 outbox 文件，重建 pending 队列。
- Given outbox 文件有未补发项 + daemon 重启
- When ResilienceService 构造 load()
- Then pending 队列重建，待 drain 触发补发

### FR-10 batch task-runner 走 ResilienceService（范围 B）
batch task-runner 的 submitMessages（`task-runner.ts:1147`）改走 submitWithRetry + 生成 dedup_key。
- Given batch task 产出流式 message
- When _submitEvent
- Then 走 _resilience.submitWithRetry（保持非阻塞），生成 dedup_key

## 非功能需求

- **NFR-01 兼容**：ResilienceService 未注入时回退直接调 HubClient；dedup_key nullable 向后兼容；config 新项有默认值。
- **NFR-02 对 backend 友好**：重试仅限可恢复错误，4xx fail-fast，退避+抖动，max 3 次，避免请求风暴。
- **NFR-03 可测**：ResilienceService/Outbox/error-classify 可独立单测；backend submit_messages 去重有集成测试。
- **NFR-04 跨平台**：outbox 路径用 os.homedir()，Windows/macOS 一致（沿用现有 config.ts 约定）。

## 决策覆盖关系

| 决策 | 覆盖 FR |
|---|---|
| D-001@v2 幂等=backend dedup_key 根治 | FR-08 |
| D-002@v1 submit_messages 跨调用非幂等（前提） | FR-08 |
| D-003@v1 runtime status 自由 String | FR-03（无需 migration） |
| D-004@v1 补发触发复用 ws onConnected | FR-07 |
| D-005@v1 范围=B（两条 submit + 终态轻量重试） | FR-04 / FR-05 / FR-10 |
| D-006@v1 断连不主动 degraded | FR-03 |
