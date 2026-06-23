---
schema_version: 1
doc_type: module-card
module_id: git_gateway
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:09:00
---
# git_gateway

## 定位
代理执行受限的 Git 操作（`git add/commit/push/pull` 等）并落审计日志。是 agent/tool_gateway 写入仓库时唯一的统一入口，所有执行经身份解析 + 仓库 lease 校验 + 命令白名单 + 输出脱敏，再异步写 `git_operation_logs` 表。

## 契约摘要
- `POST /api/workspaces/{workspace_id}/git` — 执行 Git 操作，body 含 operation + args，依赖活跃 worktree lease（可选）
- `GET /api/workspaces/{workspace_id}/git` — 分页查询该 workspace 的 Git 操作历史
- `GitGatewayService.execute(...)` 返回 `GitOperationResult`（exit_code/stdout/stderr 已脱敏）
- `GitGatewayService.list_operations(...)` 分页查询
- `redact_output(raw)` 对 stderr/stdout 做敏感信息脱敏（token/密钥），`validate_operation` 仅放行白名单子命令
- 错误：`GitOperationForbidden`（身份/lease 不匹配）、`GitOperationFailed`（进程非零退出）

## 关键逻辑
```
execute(workspace, user, operation, args, lease_id?):
  name, email = _resolve_git_identity(user)        # 取用户绑定的 git_identity，无则禁
  lease = _get_active_lease(lease_id, workspace)   # lease 必须属于该 workspace
  repo_dir = _resolve_repo_dir(lease)
  validate_operation(operation, args)              # 白名单校验，禁危险子命令/flag
  proc = run([git, -c, user.name/email, operation, *args], cwd=repo_dir, timeout)
  red_out, red_err = redact_output(proc.stdout), redact_output(proc.stderr)
  insert GitOperationLog(...)                       # 异步落审计
  if proc.returncode != 0: raise GitOperationFailed
  return result
```

## 注意事项
- 命令白名单在 `validate_operation` 硬编码，新增 git 子命令需同步放行，否则被 `GitOperationForbidden` 拦
- `_resolve_git_identity` 失败（用户未绑 identity）直接禁执行；身份缺失是常见 403 来源
- `_resolve_repo_dir` 优先用 lease.path，无 lease 时回退 workspace 根目录（容器内挂载路径）
- 审计日志的 stdout/stderr 均为脱敏后文本，原始输出不落库；排查真实输出需看进程级日志
- 与 git_identity（提供身份）、worktree（提供 lease）强耦合，二者任一不可用则 gateway 不可用

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
