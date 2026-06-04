---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# tool_gateway
> 最后更新：2026-06-01
> 最近变更：scan（初始生成）
> 模块路径：backend/app/modules/tool_gateway/**

## 职责

作为 agent 执行工具操作的安全网关。所有 agent 对文件系统、Shell、HTTP 的操作都经过此模块，受策略（ToolPolicy）约束，并记录审计日志。

## 当前设计

```
router.py         ── 工具执行 HTTP 入口（/tool-gateway）
policy_router.py  ── 策略 CRUD HTTP 入口（/tool-policies）
service.py        ── ToolGatewayService，工具执行调度 + 路径/命令校验
tool_policy.py    ── ToolPolicy 模型 + ToolPolicyService 策略引擎
model.py          ── ToolOperationLog (SQLModel table)
schema.py         ── ToolExecuteRequest / ToolExecuteResponse
policy_schema.py  ── ToolPolicyCreate / Update / Read
tests/            ── test_service.py / test_policy.py / test_router.py
```

支持 7 种工具类型：`file_read` / `file_write` / `file_list` / `file_search` / `shell_exec` / `run_tests` / `http_get`。

每个工具操作需关联一个有效的 `WorktreeLease`（通过 lease_id），操作范围限制在 lease 对应的 worktree 目录内。

## 对外接口（表格）

### 工具执行端点

| 方法 | 路径 | 说明 | 返回类型 |
|------|------|------|----------|
| POST | `/tool-gateway/execute` | 执行工具操作 | `ToolExecuteResponse` |
| GET | `/tool-gateway/pending-approvals` | 列出待审批操作 | `list` |
| GET | `/tool-gateway/approval-history` | 列出审批历史 | `list` |
| POST | `/tool-gateway/approve` | 批准操作请求 | — |
| POST | `/tool-gateway/reject` | 拒绝操作请求 | — |

### 策略管理端点

| 方法 | 路径 | 说明 | 返回类型 |
|------|------|------|----------|
| POST | `/tool-policies` | 创建策略 | `ToolPolicyRead` |
| GET | `/tool-policies` | 列出策略 | `list[ToolPolicyRead]` |
| GET | `/tool-policies/{policy_id}` | 获取单个策略 | `ToolPolicyRead` |
| PATCH | `/tool-policies/{policy_id}` | 更新策略 | `ToolPolicyRead` |
| DELETE | `/tool-policies/{policy_id}` | 删除策略 | — |

所有端点需要认证 + `require_permission`。

## 关键数据流

1. **execute**：
   - 验证 lease 有效性 -> 获取关联 Task 和 Workspace
   - 加载 ToolPolicy（无则用 default_policy）
   - `ToolPolicyService.check()` 策略检查（工具白名单 / 命令黑名单 / 域名白名单 / SSRF）
   - `ToolPolicyService.apply_limits()` 应用限制（timeout cap）
   - `_dispatch()` 分发到对应 handler
   - 写入 `ToolOperationLog` + `AuditLog`
   - 返回脱敏后的输出

2. **策略引擎**：
   - `check()`：allowed_tools 检查 -> blocked_commands 检查 -> allowed_domains 检查 + SSRF 防护
   - `apply_limits()`：返回 PolicyLimits（effective_timeout 等），不修改 params

3. **安全校验**：
   - `validate_path()`：路径必须在 allowed_paths 内，防止路径遍历
   - `validate_shell_command()`：黑名单危险命令（sudo / rm -rf / mkfs / dd / shutdown / nc / crontab）

## 设计决策（表格）

| 决策 | 原因 |
|------|------|
| 网关模式 | 所有 agent 工具操作集中管控，避免直接访问文件系统 |
| Lease 绑定 | 操作范围绑定 worktree lease，确保隔离性 |
| 策略白名单 + 黑名单 | 双重防护：工具类型白名单 + 命令黑名单 |
| SSRF 防护 | http_get 强制检查私有 IP，防止内网探测 |
| 输出脱敏 | `redact_output()` 清理敏感信息 |
| 双写审计 | ToolOperationLog（业务）+ AuditLog（全局审计） |
| 唯一约束 (workspace_id, name) | 同一 workspace 下策略名唯一 |

## 依赖关系

- `app.core.auth_deps` — get_current_user, require_permission
- `app.core.db` — get_session
- `app.core.errors` — AppError, PermissionDenied, WorktreeLeaseNotFound
- `app.core.logging` — get_logger
- `app.modules.auth.model` — User
- `app.modules.auth.permissions` — Permission
- `app.modules.git_gateway.service` — redact_output
- `app.modules.task.model` — Task
- `app.modules.worktree.model` — WorktreeLease
- `app.modules.worktree.exec_env` — ExecEnvBuilder
- `app.modules.workflow.model` — AuditLog

## 注意事项

- Shell 执行会 redact 环境变量中的敏感 token
- `run_tests` handler 支持 pytest/pytest-x/jest 三种 runner 的输出解析
- Policy 缺失时使用 `default_policy()`（所有工具允许、无命令限制、无域名限制、30s timeout）
- http_get 强制校验 URL scheme（仅 http/https）

## 变更索引（表格，初始为空）

| 变更ID | 日期 | 改动摘要 |
|--------|------|----------|
