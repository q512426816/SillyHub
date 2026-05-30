---
author: qinyi
created_at: 2026-05-30T20:50:00
---

# Requirements — Tool Gateway 通用化

## 角色

| 角色 | 说明 |
|------|------|
| 开发者 | 创建/管理 ToolPolicy，启动 AgentRun 时指定策略 |
| Agent | 在 ToolPolicy 约束下执行工具调用 |
| 平台管理员 | 查看审计日志，追踪所有工具调用 |

## 功能需求

### FR-01: ToolPolicy CRUD

Given 一个 workspace 存在
When 开发者 POST /api/workspaces/{ws_id}/tool-policies 并提供 name + 配置
Then 创建 ToolPolicy 并返回 201

Given 一个 workspace 已有 ToolPolicy
When 开发者 GET /api/workspaces/{ws_id}/tool-policies
Then 返回该 workspace 下所有 policy 列表

Given 一个 ToolPolicy 存在
When 开发者 PATCH /api/workspaces/{ws_id}/tool-policies/{id} 修改配置
Then 更新 policy 并返回 200

Given 一个 ToolPolicy 存在
When 开发者 DELETE /api/workspaces/{ws_id}/tool-policies/{id}
Then 删除 policy，关联的 AgentRun.tool_policy_id 置 NULL

### FR-02: AgentRun 关联 ToolPolicy

Given 一个 AgentRun 正在创建
When 指定 tool_policy_id
Then AgentRun 记录关联该 policy

Given 一个 AgentRun 正在创建
When 未指定 tool_policy_id
Then AgentRun 使用 default_policy（全量允许 + 全局安全限制）

### FR-03: 策略校验 — 工具白名单

Given ToolPolicy.allowed_tools = ["file_read", "file_list"]
When Agent 调用 shell_exec
Then 返回 403 TOOL_OPERATION_FORBIDDEN

Given ToolPolicy.allowed_tools = ["file_read", "file_list"]
When Agent 调用 file_read
Then 正常执行

### FR-04: 策略校验 — 路径限制

Given ToolPolicy.allowed_paths = ["src/", "tests/"]
When Agent 调用 file_read path="../../etc/passwd"
Then 返回 403 TOOL_PATH_FORBIDDEN（路径逃逸）

Given ToolPolicy.allowed_paths = ["."]
When Agent 调用 file_read path="src/main.py"
Then 正常执行

### FR-05: 策略校验 — shell 命令黑名单

Given ToolPolicy.blocked_commands = ["curl", "wget"]
When Agent 调用 shell_exec command="curl"
Then 返回 403 TOOL_OPERATION_FORBIDDEN

Given 全局 SHELL_BLOCKED_PATTERNS 包含 sudo
When Agent 调用 shell_exec command="sudo"
Then 返回 403 TOOL_OPERATION_FORBIDDEN（全局黑名单始终生效）

### FR-06: 策略校验 — 资源限制

Given ToolPolicy.max_timeout = 30
When Agent 调用 shell_exec timeout=60
Then 实际超时被限制为 30s

Given ToolPolicy.max_output_size = 32000
When 工具输出 50000 字符
Then 输出被截断为 32000 字符

### FR-07: run_tests 工具

Given lease 处于 locked 状态且 policy 允许 run_tests
When Agent 调用 run_tests runner="pytest" path="tests/"
Then 在 lease root 下执行 pytest，返回结构化结果 (passed/failed/skipped 计数 + 失败列表)

Given run_tests 执行超时
When 超过 policy.max_timeout
Then 终止进程，返回 result_code=-1 + 超时信息

### FR-08: http_get 工具

Given ToolPolicy.allowed_domains = ["api.github.com", "pypi.org"]
When Agent 调用 http_get url="https://api.github.com/repos/..."
Then 执行 HTTP GET 并返回响应（截断到 max_output_size）

Given ToolPolicy.allowed_domains = ["pypi.org"]
When Agent 调用 http_get url="https://evil.com/..."
Then 返回 403 TOOL_OPERATION_FORBIDDEN（域名不在白名单）

Given http_get URL 指向内网 IP (10.x, 172.16-31.x, 192.168.x)
When Agent 调用 http_get
Then 返回 403 TOOL_OPERATION_FORBIDDEN（SSRF 防护）

### FR-09: 审计双写

Given 任意工具调用执行成功
When ToolGatewayService.execute() 完成
Then 同时存在 ToolOperationLog 记录和 AuditLog 记录

Given AuditLog 记录
When 查看 details_json
Then 包含 tool_type、params、result_code 信息

## 非功能需求

- **安全性**：路径逃逸防护、命令黑名单、域名白名单、SSRF 防护（禁止内网 IP）
- **性能**：审计双写使用同一 session 的 add+commit，无额外连接开销
- **可测试**：所有工具类型和策略规则都有单元测试，路径逃逸和 SSRF 有专门测试用例
- **可观测**：structlog 记录每次工具调用的 tool_type、lease_id、result_code
- **兼容性**：现有 API 不变更，tool_type 向后兼容，未关联 policy 的 run 使用默认策略
