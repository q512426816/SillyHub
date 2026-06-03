---
author: qinyi
created_at: 2026-06-02T16:00:00
---

# Requirements

## 角色

| 角色 | 说明 |
|---|---|
| 前端用户 | 通过 Workspace 详情页和 Agent 控制台查看实时日志流 |
| AgentRunStreamClient | 前端 SSE 连接管理器，处理连接/重连/去重/状态 |
| 平台后端 | 提供 SSE stream 和 logs 回填 API |

## 功能需求

### FR-01: 后端 SSE 支持续传参数

Given 调用者请求 `GET /api/workspaces/{ws}/agent/runs/{id}/stream?after={log_id}`
When 后端处理 SSE stream 请求
Then DB replay 阶段只返回 `id > after` 的 AgentRunLog 记录
And Redis Pub/Sub 阶段正常订阅不受影响

Given 调用者未传 `after` 参数
When 后端处理请求
Then 行为与当前完全一致（返回所有日志）

### FR-02: SSE 事件携带 log_id

Given 后端通过 SSE 推送日志事件
When 事件格式序列化
Then 每个事件包含 `log_id` 字段（AgentRunLog.id）
And 保留原有 `channel`、`content`、`timestamp` 字段

### FR-03: AgentRunStreamClient 连接管理

Given 前端创建 `AgentRunStreamClient` 实例
When 调用 `connect(token)` 方法
Then 内部创建 EventSource 并连接到对应 run 的 SSE 端点
And 状态变为 `connecting` → `connected`
And 通过 `onStatusChange` 回调通知状态变更

Given 调用 `disconnect()` 方法
When 连接处于任何状态
Then 关闭 EventSource，状态变为 `disconnected`
And 不触发自动重连

### FR-04: 断线自动重连

Given SSE 连接处于 `connected` 状态
When EventSource 触发 `onerror`
Then 自动执行重连流程：关闭旧连接 → 刷新 token → 回填日志 → 重建连接

Given 重连流程执行中
When 获取新 token 失败或回填请求失败
Then 计入重试次数，等待指数退避后重试
And 退避序列：1s, 2s, 4s, 8s, 16s

Given 连续重试 5 次均失败
When 达到最大重试次数
Then 状态变为 `error`
And 不再自动重试

### FR-05: 断线日志回填

Given SSE 连接断开并准备重连
When 获取到新 token 后
Then 调用 `GET /logs?after={lastLogId}` 获取断线期间日志
And 将回填日志通过 `onMessage` 回调按序发送给消费者
And 记录回填日志中最大 `log_id` 作为新的 `lastLogId`

Given 回填日志和 SSE 新事件存在重叠
When 两者都包含相同 `log_id` 的事件
Then 通过 `log_id` Set 去重，只处理一次

### FR-06: log_id 去重

Given SSE 事件携带 `log_id` 字段
When 前端收到事件
Then 维护 `Set<number>` 记录已处理的 log_id
And 重复 log_id 的事件被忽略

Given 回填日志和 SSE 推送可能重叠
When log_id 已存在于 Set 中
Then 该事件被安全丢弃，不触发 `onMessage`

### FR-07: Workspace 详情页集成

Given Workspace 详情页使用 `AgentRunStreamClient`
When Bootstrap 按钮触发后
Then 使用新的 `AgentRunStreamClient` 替换手动 EventSource 管理
And UI 展示连接状态指示器
And 日志列表展示去重后的完整日志

## 非功能需求

- 可靠性：断线重连成功率 > 99%，日志零丢失。
- 性能：重连 + 回填总耗时 < 3 秒。
- 兼容性：`after` 参数可选，不影响现有未传参的调用方。
- 可维护性：`AgentRunStreamClient` 作为独立模块，不耦合页面组件。
- 无新依赖：纯前端逻辑，不引入第三方库。
