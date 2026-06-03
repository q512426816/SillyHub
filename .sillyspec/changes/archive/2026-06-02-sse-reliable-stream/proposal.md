---
author: qinyi
created_at: 2026-06-02T16:00:00
---

# Proposal

## 动机

Agent SSE stream 存在多个可靠性问题：

1. **断线无重连**：EventSource `onerror` 后直接关闭，网络波动导致日志流永久中断。
2. **Token 过期中断**：EventSource 通过 `?token=` 传递 JWT，token 过期后无法续期，必须关闭重建连接。
3. **去重不可靠**：前端使用 `timestamp+channel+content` 拼接做去重 key，同一秒内相同内容的日志会被误判为重复。
4. **无续传能力**：SSE 连接建立后只订阅新事件，无法从断线处恢复，断线期间的日志丢失。
5. **状态管理分散**：EventSource 生命周期散落在 `page.tsx`，无统一状态通知，UI 无法感知连接状态。

参考 happy 项目 `apiSocket.ts` 的连接管理模式，将 SSE 连接管理抽象为独立客户端类，吸收其状态管理、token 刷新和重连策略。

## 关键问题

1. EventSource 不支持动态修改 URL 参数，token 过期后必须销毁重建。
2. 断线期间产生的日志需要回填机制，否则用户看到的内容不完整。
3. 当前去重策略基于内容哈希，在高频日志场景下不可靠。

## 变更范围

- 新增前端 `AgentRunStreamClient` 类，封装 SSE 连接生命周期。
- 后端 `/stream` 端点增加 `after` 参数支持续传。
- SSE 事件增加 `log_id` 字段用于可靠去重。
- Workspace 详情页替换手动 EventSource 为 `AgentRunStreamClient`。

## 不在范围内（显式清单）

- 不将 SSE 协议替换为 Socket.IO。
- 不改变 Redis Pub/Sub 的 channel 和消息格式。
- 不改变 `/logs` 端点的分页行为。
- 不实现前端多标签页间的日志同步（各自独立连接即可）。
- 不引入新的数据库表或迁移。

## 成功标准（可验证）

- 断开网络后恢复，SSE 流自动重连并回填断线期间日志。
- Token 过期后自动刷新并重建连接，用户无感知。
- 使用 `log_id` 去重，无日志丢失或误去重。
- UI 实时显示连接状态（connecting/connected/error）。
- 重连失败 5 次后标记 error 状态，显示可操作的错误提示。
