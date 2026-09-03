---
schema_version: 1
doc_type: module-card
module_id: hooks-message-queue
author: qinyi
created_at: 2026-08-22T02:45:00
---

# 会话消息排队 Hook（hooks-message-queue）

## 定位

`src/hooks/` 目录首个模块（2026-08-21-session-message-queue 新建目录）：会话消息排队
状态机 `useMessageQueue`（2026-08-25-011 起为**服务端排队**版：入队=POST inject 忙轮落
`agent_session_queued_messages`，展示=GET /queue，前端不再持有投递状态机），纯 React hook
无 react-query 依赖（dialog 模式无 QueryClientProvider），被 components-daemon 的
SessionPanel（page/dialog 双模式）消费。

## 契约摘要

- `useMessageQueue({ sessionId, sessionActive })`
  - 返回：`{ queue, removeEntry(id), retryEntry(id), reorderEntry(ids), editEntry(id, prompt), dispatchNowEntry(id), isQueueFull, queueCount, refresh() }`
- 五操作统一模式：调对应端点 → 无论成败一律 `load` 以服务端为准收敛（不本地造状态）。
  失败反馈分层（ql-20260903-014）：**404/409/422 = 已知竞态静默**（条目恰被派发删除 /
  会话非 active / 参数过期，load 后自然收敛）；**网络/5xx/权限等真实失败
  `notify.error(err, fallback)`**（旧版全静默导致「编辑弹回、删除复活」无解释）。
- `QueueEntry`：`{ id, prompt, attachmentIds, displayPrompt, status: "pending"|"failed", errorMsg?, position?, createdAt }`
- `QUEUE_MAX_PENDING = 5`（导出；与后端 SESSION_QUEUE_MAX_PENDING 同值，面板满员 toast 文案取值）。

## 关键逻辑

```
入队:      调用方直接 POST inject（忙轮后端自动落队），hook 只负责队列展示与操作
轮询:      sessionActive 期间 5s 兜底 + SSE turn 事件后 refresh()（主要靠事件）
满员:      isQueueFull = queue.length >= 5（D-002；发送侧拦截在 SessionPanel，toast 明示）
失败可见:  RECONCILE_SILENT_STATUSES = {404, 409, 422} 静默，其余 toast（ql-20260903-014）
竞态防护:  epoch 递增丢弃迟到响应 + mountedRef 卸载丢弃 + sessionId 切换清队
```

## 注意事项

- 改投递/失败语义前先读 use-message-queue.ts 头注释（D-001~D-004 / R-02~R-04 / ql-20260903-014 设计依据）。
- 单测（`__tests__/use-message-queue.test.ts`）覆盖五操作双行为与失败分层，改动必须跑。
- 调用方（SessionPanel）的发送必须在 resolve 前置好 currentRunId（占位 id 同步置位），
  否则破坏 turn 串行。

## 人工备注

（无）
