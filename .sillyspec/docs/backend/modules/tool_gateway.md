---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# tool_gateway

> 最后更新：2026-05-31
> 最近变更：`bead9ea` fix: QA round 1 — 6 issues; `30fc0bf` Tool Gateway 通用化 — policy engine, run_tests, http_get, audit dual write
> 模块路径：`app/modules/tool_gateway/**`

## 职责

工具操作网关，为 Agent 在 Worktree Lease 内执行工具调用提供统一的验证、执行、审计入口。支持 7 种工具类型（file_read / file_write / file_list / file_search / shell_exec / run_tests / http_get），内置策略引擎（ToolPolicy）控制工具白名单、命令黑名单、路径限制、域名白名单、资源上限等。每次操作双写审计日志（ToolOperationLog + workflow.AuditLog）。

## 当前设计（架构 + 关键逻辑）

**两层架构**：`ToolGatewayService`（执行层）+ `ToolPolicyService`（策略层，无状态静态方法）。

1. 请求进入 → 验证 lease 有效性 + 权限 → 加载 ToolPolicy
2. `ToolPolicyService.check()` 三步校验：工具白名单 → 命令黑名单（shell/run_tests）→ 域名白名单+SSRF 防护（http_get）
3. `ToolPolicyService.apply_limits()` 计算有效超时和输出上限
4. `_dispatch()` 路由到对应 handler，handler 内执行路径越界检查 + shell 命令危险模式拦截
5. 结果写入 ToolOperationLog + AuditLog（双写），提交事务

**安全机制**：
- 路径沙箱：`validate_path()` 确保 target 在 lease_root 内
- Shell 黑名单：`SHELL_BLOCKED_PATTERNS` 拦截 sudo/rm -rf/mkfs/dd 等危险命令
- SSRF 防护：`ToolPolicyService._check_not_private_ip()` 拦截内网 IP 解析
- 输出脱敏：`redact_output()` 处理敏感信息
- 资源限制：默认超时 30s，最大输出 64KB

**V1 Approval Stubs**：4 个审批端点（pending/history/approve/reject）当前返回空数据，预留 V2 完整审批流程。

## 对外接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | `/worktrees/{lease_id}/tools` | 执行工具操作 | 登录用户 |
| GET | `/workspaces/{ws_id}/approvals/pending` | 待审批列表（V1 stub） | WORKSPACE_READ |
| GET | `/workspaces/{ws_id}/approvals/history` | 审批历史（V1 stub） | WORKSPACE_READ |
| POST | `/workspaces/{ws_id}/approvals/{req_id}/approve` | 审批通过（V1 stub） | CHANGE_APPROVE |
| POST | `/workspaces/{ws_id}/approvals/{req_id}/reject` | 审批拒绝（V1 stub） | CHANGE_APPROVE |
| POST | `/workspaces/{ws_id}/tool-policies` | 创建工具策略 | WORKSPACE_ADMIN |
| GET | `/workspaces/{ws_id}/tool-policies` | 列出工具策略 | WORKSPACE_READ |
| GET | `/workspaces/{ws_id}/tool-policies/{pid}` | 获取工具策略 | WORKSPACE_READ |
| PATCH | `/workspaces/{ws_id}/tool-policies/{pid}` | 更新工具策略 | WORKSPACE_ADMIN |
| DELETE | `/workspaces/{ws_id}/tool-policies/{pid}` | 删除工具策略 | WORKSPACE_ADMIN |

## 关键数据流

```
Agent 调用 → POST /worktrees/{lease_id}/tools
  → ToolGatewayService.execute()
    → _get_lease_and_task()          # 验证 lease + 获取 allowed_paths
    → ToolPolicyService.check()      # 策略校验（白名单/黑名单/SSRF）
    → ToolPolicyService.apply_limits()  # 计算资源上限
    → _dispatch() → handler()        # 路由 + 执行
    → 写入 ToolOperationLog          # 操作日志
    → 写入 AuditLog                  # 审计日志（双写）
    → return ToolExecuteResponse
```

## 设计决策

| 决策 | 原因 |
|------|------|
| 策略引擎无状态（静态方法） | 便于测试，避免隐藏 DB 依赖，策略对象由调用方传入 |
| 审计双写（ToolOperationLog + AuditLog） | ToolOperationLog 提供工具级别详情；AuditLog 提供跨模块统一审计视图 |
| Shell 黑名单用正则而非 allowlist | 危险命令集合有限且明确，黑名单更直观；后续可升级为 allowlist |
| default_policy() 非持久化 | 无策略关联时使用宽松默认值，不产生脏数据 |
| V1 Approval Stubs 返回空 | 审批流程复杂度较高，分阶段交付 |
| SSRF 防护始终启用 | 即使 allowed_domains 为空也检查私有 IP，防止 DNS rebinding |

## 依赖关系

- **上游**：worktree（WorktreeLease）、task（Task.allowed_paths）、workflow（AuditLog 模型）
- **下游**：git_gateway（redact_output）
- **基础设施**：asyncio.create_subprocess_exec、httpx（http_get）、socket（SSRF 检查）

## 注意事项

- `MAX_OUTPUT_SIZE = 64_000`，超长输出会被截断，可能丢失关键信息
- Shell 命令超时硬上限 120s，`_handle_shell_exec` 和 `_handle_run_tests` 均使用 `asyncio.wait_for`
- `run_tests` 支持 pytest 和 go_test 两种 runner，pytest 输出会被解析为结构化 JSON
- `http_get` 使用 httpx 异步客户端，最大重定向 3 次
- 策略名称在同一 workspace 内唯一（唯一索引 `ux_tool_policy_workspace_name`）

## 变更索引

| 日期 | 变更 |
|------|------|
| 2026-05-31 | 初始归档文档 |
