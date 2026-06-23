---
schema_version: 1
doc_type: module-card
module_id: tool_gateway
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:36
---
# tool_gateway

## 定位
agent 执行工具操作的「安全网关 + 策略引擎」。所有 agent 对文件系统、Shell、HTTP 的操作都经此模块，受 `ToolPolicy`（工具白名单 / 命令黑名单 / 域名白名单 / SSRF 防护）约束，操作范围绑定 `WorktreeLease`，全程写双份审计（`ToolOperationLog` + `AuditLog`）并脱敏输出。是任务/工具网关域的「执行闸门」。

产品视角：这是 agent 自主性的「安全带」。agent 在隔离 worktree 内执行，但每个文件读写、shell 命令、HTTP 请求都经此网关，按工作区策略放行/拦截/转人工审批。前端审批面板（permission-approval-dialog）展示 pending 请求，管理员 approve/reject 后才放行。它让「agent 自动改代码」可控、可审计、可回溯。

## 契约摘要
- 路由：
  - `API tag=tool_gateway`：`POST /execute`（`ToolExecuteRequest`→`ToolExecuteResponse`）、`GET /pending-approvals`、`GET /approval-history`、`POST /approve`、`POST /reject`
  - `API tag=tool_policy`（policy_router）：`POST/GET/GET/{id}/PATCH/DELETE /tool-policies`（`ToolPolicyCreate|Update|Read`）
- 7 种工具：`file_read` / `file_write` / `file_list` / `file_search` / `shell_exec` / `run_tests` / `http_get`，各有 `_handle_*` handler
- 数据：`ToolOperationLog`（业务审计）、`ToolPolicy`（策略，workspace_id+name 唯一）、`PolicyLimits`（effective_timeout 等）
- 错误类：`ToolOperationForbidden` / `ToolOperationFailed` / `ToolPathForbidden`
- 依赖：`core`、`models`、`workspace`、`worktree`（WorktreeLease）、`task`、`git_gateway`（redact_output）、`workflow`（AuditLog）；被 `agent` / `daemon` 调用执行工具
- 跨组件协作：agent 执行层通过 lease_id 调 execute；前端 `lib/tool-gateway.ts` + 权限审批弹窗（permission-approval-dialog）展示 pending approvals

## 关键逻辑
execute 主链路（`ToolGatewayService.execute`）：
```
lease, task = _get_lease_and_task(lease_id)      # 校验 lease 有效
policy = load_policy(workspace_id) or default_policy()
ToolPolicyService.check(policy, tool_type, params)   # 白名单/黑名单/域名/SSRF
limits = ToolPolicyService.apply_limits(policy, params)  # timeout cap，不改 params
result = _dispatch(tool_type, params, lease_root)    # 分发到 _handle_*
写 ToolOperationLog + AuditLog; redact_output(result)
```
- `validate_path`：路径必须在 allowed_paths 内，防遍历
- `validate_shell_command`：黑名单 sudo/rm -rf/mkfs/dd/nc/crontab/shutdown 等
- `_check_not_private_ip`：http_get 强制查私有 IP 防 SSRF
- `_resolve_lease_root`：从 lease 解析操作根目录，所有路径限制在其内
- `_get_lease_and_task`：校验 lease 有效并取关联 task/workspace
- 双写审计：ToolOperationLog（业务）+ AuditLog（全局）保证可追溯

### 工具 Handler 分发
`_dispatch` 按 tool_type 路由到专属 handler：
- `_handle_file_read/write/list/search`：文件操作，路径经 validate_path 校验在 allowed_paths 内
- `_handle_shell_exec`：执行 shell 命令，先 validate_shell_command 黑名单检查，redact 环境变量
- `_handle_run_tests`：调 pytest/jest，`_parse_test_output` 解析结果摘要
- `_handle_http_get`：HTTP 请求，校验 scheme + 域名白名单 + 私有 IP 防护
- 每个 handler 在 lease_root 限定的 worktree 目录内执行

## 注意事项
- shell_exec 会 redact 环境变量中的敏感 token
- `run_tests` 支持 pytest/pytest-x/jest 三种 runner 输出解析（`_parse_test_output`）
- policy 缺失用 `default_policy()`（全允许、无限制、30s timeout）
- http_get 强制校验 URL scheme 仅 http/https
- 操作范围严格限制在 lease 对应 worktree 目录内，跨 lease 不可达
- `apply_limits` 不修改原 params，返回 PolicyLimits 供 handler 应用（如 timeout cap）
- 命令黑名单与域名白名单是双重防护：工具类型白名单 + 命令黑名单 + 域名白名单
- 审批流：高风险操作进 pending-approvals，需人工 approve/reject 后才执行
- exec_env 由 worktree 提供，token 等敏感信息不进日志
- PolicyLimits 含 effective_timeout，handler 据此设子进程超时
- `_check_tool_allowed` 校验工具在 allowed_tools 白名单
- `_check_command_not_blocked` 校验命令不在 blocked_commands 黑名单
- `_check_domain_allowed` 校验 http_get 目标域名在 allowed_domains
- `_extract_domain` 从 URL 提取域名供 SSRF 校验
- approve/reject 操作 pending 队列中的高风险请求，流转有状态
- policy_router 的 CRUD 支持 workspace 级策略隔离
- ToolOperationLog 记录 tool_type/params/output/status/耗时，供审计回溯
- default_policy 的 timeout 30s 是兜底，workspace 可自定义更严格策略
- shell_exec 的环境变量 redact 在日志落库前执行
- run_tests 的 runner 自动探测（pytest/jest），_parse_test_output 按格式解析
- file_search 支持模糊匹配，结果限 lease 根目录内
- approve/reject 需对应 pending 请求 id，已决策不可重复
- ToolPolicy 的 allowed_tools 为空表示全允许（与 default 一致）
- policy_router 的 PATCH 支持部分更新策略字段
- validate_path 解析符号链接防绕过
- http_get 的超时由 PolicyLimits.effective_timeout 控制
- 审批超时未处理保持 pending，不自动放行

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
