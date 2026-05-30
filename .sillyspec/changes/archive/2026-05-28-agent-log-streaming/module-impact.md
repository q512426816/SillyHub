---
author: qinyi
created_at: 2026-05-30 23:40:00
---

# 模块影响分析

## 变更：2026-05-28-agent-log-streaming

> 已有代码实现的变更。module-map.yaml 不存在，基于 design.md 声明范围分析。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 |
|------|----------|----------|-------------|
| agent | 逻辑变更 | backend/app/modules/agent/adapters/claude_code.py | `_exec_stream` 改逐行读取 + Redis PUBLISH |
| agent | 接口变更 | backend/app/modules/agent/router.py | 新增 `GET /{run_id}/stream` SSE 端点 |
| agent | 逻辑变更 | backend/app/modules/agent/service.py | 新增 `stream_run_logs` 方法（Redis subscribe + SSE 生成器） |
| frontend | 接口变更 | frontend/src/lib/agent.ts | 新增 `streamAgentRunLogs` EventSource 消费函数 |
| frontend | 逻辑变更 | frontend/src/app/.../agent/page.tsx | running 时用 SSE 替代轮询 |

## 未匹配文件

| 文件路径 | 说明 |
|----------|------|

## 更新结果

| 模块文档 | 操作 | 状态 |
|----------|------|------|
| （均不存在） | 不新建 | ⏭ 跳过 |
