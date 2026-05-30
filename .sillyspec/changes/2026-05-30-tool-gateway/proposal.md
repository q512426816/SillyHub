---
author: qinyi
created_at: 2026-05-30T20:50:00
---

# Proposal — Tool Gateway 通用化

## 动机

当前 tool_gateway 仅支持 5 种基础工具类型（file_read/write/list/search + shell_exec），且缺少统一的策略管控机制。Agent 在执行任务时无法被精细化地限制使用哪些工具、访问哪些路径、连接哪些域名。随着 Agent 自主能力增强（已完成 Kill API + Diff Collector），亟需一个通用化的 Tool Gateway，为每个 AgentRun 提供可控的、可审计的工具执行环境。

## 关键问题

1. **无策略引擎**：所有 AgentRun 使用相同的工具权限，无法按任务/场景区分。高权限操作（如 shell_exec、file_write）无法按需限制。
2. **缺少 test/network 工具**：Agent 无法在 lease 内运行测试并获取结构化结果，也无法安全地访问外部 API（如 PyPI、GitHub API）。
3. **审计不完整**：当前仅写 ToolOperationLog，未接入平台级 AuditLog，无法在变更审计链中追踪工具调用。

## 变更范围

- 新建 `tool_policies` 表，支持按 workspace 管理工具策略
- AgentRun 新增 `tool_policy_id` FK 关联策略
- 新建 `tool_policy.py` 统一策略校验服务
- 新增 `run_tests` 工具：结构化测试执行 + 结果解析
- 新增 `http_get` 工具：白名单域名只读 HTTP
- 审计双写：ToolOperationLog + workflow.AuditLog
- 新增 5 个 Policy CRUD API 端点
- 新增 Alembic 迁移
- 完整测试覆盖（≥20 新测试）

## 不在范围内（显式清单）

- 不做工具审批工作流（已有 V1 stub，V2 待后续变更）
- 不做 WebSocket 流式输出（已有 Redis Pub/Sub 日志流）
- 不做 MCP 协议集成
- 不做前端 UI
- 不做工具调用限流/配额
- 不修改 git_gateway 模块（保持独立）

## 成功标准（可验证）

- 4 类 tool (file/shell/test/network) 全部实现 + 可通过 API 调用
- ToolPolicy 可创建、查询、更新、删除
- AgentRun 可关联 ToolPolicy，未关联时使用默认策略
- 路径逃逸测试通过（不能访问 lease 外文件）
- shell 命令黑名单生效
- http_get 域名白名单生效
- 超时和输出大小上限生效
- 所有 tool 调用同时出现在 ToolOperationLog 和 AuditLog
- 后端测试 ≥ 20 新增，全套 648+ 无回归
