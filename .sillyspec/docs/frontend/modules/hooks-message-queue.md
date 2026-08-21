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
状态机 `useMessageQueue`，纯 React hook 无 UI 依赖，被 components-daemon 的
SessionPanel（page/dialog 双模式）消费。

## 契约摘要

- `useMessageQueue(options: UseMessageQueueOptions): UseMessageQueueReturn`
  - options：`{ sessionId, sessionActive, hasCurrentRun, onSend(prompt, attachmentIds) => Promise<void>, maxQueue?=5 }`
  - 返回：`{ queue, enqueue(prompt, attachmentIds, displayPrompt): boolean（满员 false）, removeEntry(id), retryEntry(id), isQueueFull, queueCount }`
- `QueueEntry`：`{ id, prompt, attachmentIds, displayPrompt, status: "pending"|"sending"|"failed", errorMsg?, createdAt }`

## 关键逻辑

```
投递条件:  sessionActive && !hasCurrentRun && 队头 pending（effect 监听两标志 + 队列自身）
排队语义:  running / reconnecting / pending 期间入队等投递（D-001 前端等 active，后端 inject 守卫不动）
满员:      默认 5 条，enqueue 返 false 由调用方提示（D-002）
失败:      onSend 抛错 → 队头标 failed(errorMsg) 停队不跳过，重试仅用户 retryEntry 触发（D-003）
附件:      只引用已落库 attachmentIds，随 prompt 一次投递（D-004）
清队:      sessionId 变化清空（排队消息不跨会话携带）
防竞态:    sendingRef 防重入 + queueRef 镜像防陈旧闭包 + 每次仅投一条靠 effect 续投
```

## 注意事项

- 改投递条件 / 状态语义前先读 use-message-queue.ts 头注释（D-001~D-004 设计依据）。
- 单测 15 用例（`__tests__/use-message-queue.test.ts`）覆盖连发保护与条件翻转，改动必须跑。
- 调用方（SessionPanel）的 onSend 必须在 resolve 前置好 currentRunId（占位 id 同步置位），
  否则 effect 会在 hasCurrentRun=false 窗口连发破坏 turn 串行。

## 人工备注

（无）
