---
author: qinyi
created_at: 2026-05-28 13:25:00
---

# Proposal

## 动机

Agent 运行时（如 Bootstrap、任务执行）可能持续数分钟甚至数十分钟。当前日志只能在运行结束后一次性查看，用户无法实时观察 Agent 行为，导致：(1) 长时间运行无法判断是否卡死；(2) 出错时无法及时中断；(3) 调试效率低。

## 关键问题

1. **`proc.communicate()` 阻塞**：`ClaudeCodeAdapter._exec_stream` 等待子进程完全结束后才处理 stdout，中间过程对平台完全不透明。
2. **3 秒轮询 DB**：前端通过定时器轮询 DB 日志表，但 DB 日志本身就是进程结束后才写入的，轮询也无法获取实时数据。
3. **无运行时可观测性**：Agent 运行中用户只能看到 "status: running"，没有任何中间输出。

## 变更范围

- 后端：将 `ClaudeCodeAdapter._exec_stream` 改为逐行流式读取 stdout，通过 Redis Pub/Sub 实时发布
- 后端：新增 SSE 端点 `GET /api/workspaces/{id}/agent/runs/{run_id}/stream`
- 前端：Agent Console 页面 running 状态下用 `EventSource` 实时消费日志

## 不在范围内

- 不做历史日志回放（completed/failed 仍用现有 DB 查询接口）
- 不做 WebSocket（日志推送是单向场景，SSE 足够）
- 不做 Redis Streams 持久化（running 阶段丢少量消息可接受，结束后 DB 有完整记录）
- 不做用户中途输入/交互（仅日志展示）
- 不改动 `AgentRunLog` 数据模型和 DB 写入逻辑
- 不做跨节点消息中继（单实例部署足够，未来多实例时再引入 Redis Streams）

## 成功标准

- Agent 运行中，前端在 stdout 产生后 1 秒内可见对应日志行
- SSE 断连后浏览器自动重连，重连后继续接收新日志
- Agent 运行结束后 SSE 流正常关闭（发送 `event: done`）
- 现有 DB 日志查询接口行为不变
- 已有测试全部通过
