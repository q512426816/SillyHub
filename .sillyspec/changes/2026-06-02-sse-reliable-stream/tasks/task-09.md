---
author: qinyi
created_at: 2026-06-02T16:21:37
id: task-09
title: 同步 agent 模块文档
priority: P1
estimated_hours: 0.5
depends_on: [task-03]
blocks: []
allowed_paths:
  - .sillyspec/docs/backend/modules/agent.md
---

# task-09: 同步 agent 模块文档

## 修改文件

- `.sillyspec/docs/backend/modules/agent.md` — 对外接口表、设计决策表、变更索引表、关键逻辑描述

## 实现要求

### 1. 对外接口表 — 更新 `GET /stream` 端点描述

在「对外接口」表格中，找到 `GET /workspaces/{ws}/agent/runs/{id}/stream` 行，将「说明」列从：

> SSE 实时日志流

更新为：

> SSE 实时日志流；支持 `after` 查询参数（UUID，可选）续传断线日志

更新后完整行：

```
| `GET /workspaces/{ws}/agent/runs/{id}/stream` | `stream_run_logs()` | SSE 实时日志流；支持 `after` 查询参数（UUID，可选）续传断线日志 | 前端 |
```

### 2. 设计决策表 — 增加 `log_id` 事件字段决策

在「设计决策」表格末尾新增一行：

```
| SSE 事件携带 `log_id`（AgentRunLog.id UUID） | 前端通过 log_id Set 去重回填与实时推送的交集事件，替代 timestamp+content 拼接去重 | 2026-06-02-sse-reliable-stream |
```

### 3. 变更索引表 — 增加 2026-06-02-sse-reliable-stream 记录

在「变更索引」表格末尾新增一行：

```
| 2026-06-02 | 2026-06-02-sse-reliable-stream | SSE 端点增加 `after` 查询参数（UUID）实现断线续传；SSE 事件增加 `log_id` 字段支持可靠去重；前端 `AgentRunStreamClient` 封装连接管理、重连、回填、去重 |
```

### 4. 关键逻辑描述更新

在「关键逻辑」第 5 条「流式日志：通过 Redis Pub/Sub SSE 实时推送 agent 输出」后补充说明，更新为：

> 流式日志：通过 Redis Pub/Sub SSE 实时推送 agent 输出。SSE 端点支持 `after` 查询参数（AgentRunLog.id UUID），DB replay 阶段只返回 id 在指定 log 之后的记录，实现断线续传。SSE 事件携带 `log_id` 字段用于前端去重。

### 5. frontmatter 更新

- `最后更新` 日期保持 `2026-06-02`（已是当前值）
- `最近变更` 更新为 `2026-06-02-sse-reliable-stream`

## 边界处理

1. **仅更新文档，不涉及代码变更**：本任务纯文档同步，不改后端或前端代码
2. **不修改其他模块文档**：只更新 `agent.md`，前端 INTEGRATIONS 文档由 task-10 负责
3. **保持与 design.md 一致**：所有描述必须与 `2026-06-02-sse-reliable-stream/design.md` 中的 API 设计和决策吻合
4. **保持文档结构完整**：不删除任何现有行或列，只做更新和追加
5. **UUID 类型准确性**：`after` 参数类型为 UUID（非整数），文档描述需准确反映 `AgentRunLog.id` 的 UUID 类型
6. **变更索引日期对齐**：使用 `2026-06-02` 日期，与变更目录名中的日期一致

## 非目标

- 不修改其他模块文档（task、workspace、spec_workspace 等）
- 不更新前端 INTEGRATIONS 文档（task-10 负责）
- 不修改代码文件
- 不修改 design.md 或 plan.md
- 不新增独立章节，只更新现有表格和关键逻辑描述

## 参考

- design.md 决策 3（`after` 参数）和决策 4（`log_id` 去重）
- plan.md task-09 定义
- `agent.md` 当前版本：最后更新 2026-06-02，最近变更 2026-06-02-spec-bootstrap-agent-stream-interaction
- task-03 中 `AgentRunLog.id` 类型为 UUID（非自增整数）

## TDD 步骤

本任务为文档同步，无代码测试。验证步骤如下：

1. 读取更新后的 `agent.md`
2. 确认对外接口表中 `GET /stream` 行包含 `after` 查询参数（UUID，可选）说明
3. 确认设计决策表包含 `log_id` 事件字段决策行
4. 确认变更索引表包含 `2026-06-02-sse-reliable-stream` 记录
5. 确认关键逻辑第 5 条包含 `after` 参数和 `log_id` 字段描述
6. 确认文档中所有 UUID 类型描述与 design.md 一致
7. 确认 `最近变更` 已更新为 `2026-06-02-sse-reliable-stream`

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 检查对外接口表 `GET /stream` 行 | 说明列包含 `after` 查询参数（UUID，可选）续传断线日志描述 |
| AC-02 | 检查设计决策表 | 包含 `log_id` 事件字段决策行，来源为 `2026-06-02-sse-reliable-stream` |
| AC-03 | 检查变更索引表 | 包含 `2026-06-02-sse-reliable-stream` 记录，摘要涵盖 `after` 参数和 `log_id` 字段 |
| AC-04 | 检查关键逻辑第 5 条 | 包含 `after` 参数（AgentRunLog.id UUID）和 `log_id` 字段描述 |
| AC-05 | 检查类型准确性 | `after` 参数类型描述为 UUID（非整数），与 AgentRunLog.id 类型一致 |
| AC-06 | 检查文档完整性 | 无现有行被删除或覆盖，所有更新为追加或行内修改 |
| AC-07 | 检查 frontmatter `最近变更` | 值为 `2026-06-02-sse-reliable-stream` |
