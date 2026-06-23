---
schema_version: 1
doc_type: module-card
module_id: tool_gateway
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:09:00
---
# tool_gateway

## 定位
工具操作网关，为 agent 在 worktree lease 内执行工具调用提供统一校验/执行/审计入口。两层架构：`ToolGatewayService`（执行）+ `ToolPolicyService`（无状态策略）。支持 7 类工具（file_read/write/list/search、shell_exec、run_tests、http_get），每次操作双写审计（ToolOperationLog + workflow.AuditLog）。

## 契约摘要
- `POST /api/workspaces/{workspace_id}/tools`（或 `/worktrees/{lease_id}/tools`）— 执行工具操作
- `GET .../approvals/pending` / `GET .../approvals/history` — 审批列表（V1 stub，返回空）
- `POST .../approvals/{req_id}/approve` / `reject` — 审批（V1 stub）
- 策略 CRUD（policy_router）：`POST/GET/PATCH/DELETE /api/workspaces/{ws_id}/tool-policies[/{pid}]`
- `ToolGatewayService.execute/_dispatch/_handle_file_*/_handle_shell_exec/_handle_run_tests/_handle_http_get`
- `ToolPolicyService.check/apply_limits`；`validate_path/validate_shell_command` 沙箱校验

## 关键逻辑
```
execute(workspace, user, lease_id, task_id, tool_type, params):
  lease, task = _get_lease_and_task(lease_id, task_id)
  policy = load_policy(workspace)
  ToolPolicyService.check(policy, tool_type, params)     # 白名单/黑名单/SSRF
  limits = ToolPolicyService.apply_limits(policy, tool_type)
  result = _dispatch(tool_type, params, lease, limits)   # 路由到 handler
  insert ToolOperationLog(...)                            # 操作日志
  insert AuditLog(...)                                    # 审计（双写）
  commit; return result
```

## 注意事项
- 策略引擎为无状态静态方法，策略对象由调用方传入，便于测试
- 路径沙箱 `validate_path` 强制 target 在 lease_root 内；shell 黑名单正则拦 sudo/rm -rf/mkfs/dd
- SSRF 防护始终启用：即使 `allowed_domains` 为空也检查私有 IP（防 DNS rebinding）
- `MAX_OUTPUT_SIZE = 64_000`，超长输出截断；shell 超时硬上限 120s（`asyncio.wait_for`）
- `run_tests` 支持 pytest / go_test，pytest 输出解析为结构化 JSON；`http_get` 用 httpx，最大重定向 3 次
- 无策略关联时用 `default_policy()`（非持久化，宽松默认）
- 策略名同 workspace 内唯一（`ux_tool_policy_workspace_name`）；V1 审批端点为 stub 返回空

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
