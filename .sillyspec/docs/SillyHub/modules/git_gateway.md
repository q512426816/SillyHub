---
schema_version: 1
doc_type: module-card
module_id: git_gateway
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:33
---
# git_gateway

## 定位
后端「Git 操作网关」功能域：在 worktree lease 上下文内代用户执行受控的 git 操作（status/log/diff/commit 等白名单），记录操作日志，并自动用用户配置的 git 身份（来自 git_identity 模块）署名。把分散的 git 命令收敛到统一受审计入口，避免直接 shell 裸跑。

## 契约摘要
- API（tag=git_gateway）：`POST /api/.../git/execute`（执行操作）、`GET /api/.../git/operations`（操作日志列表）。
- `GitGatewayService`：`execute(operation, args)`（校验+执行+记日志）、`list_operations`（查历史）、`_resolve_git_identity(user_id)`（取用户身份 name/email）、`_get_active_lease`、`_resolve_repo_dir(lease)`（从 lease 定位仓库目录）。
- `GitOperationLog(BaseModel, table=True)`：持久化每次操作（操作者、operation、args、输出、结果、lease 关联）。
- 校验：`validate_operation(operation, args)` 白名单；`redact_output` 脱敏敏感输出；错误 `GitOperationForbidden` / `GitOperationFailed`。
- 依赖 git_identity（署名）、workspace、worktree lease（执行上下文）。

## 关键逻辑
```
# 执行一次 git 操作
_get_active_lease → _resolve_repo_dir(lease) → validate_operation(白名单校验)
→ _resolve_git_identity(user_id) 设置 GIT_AUTHOR/COMMITTER
→ 执行 git → redact_output → 写 GitOperationLog → 返回
```

## 注意事项
- 必须在有效 worktree lease 内执行，`_resolve_repo_dir` 依赖 lease；无 lease 拒绝执行。
- `validate_operation` 白名单决定可执行命令，新增命令需评估安全影响并同步白名单。
- 输出经 `redact_output` 脱敏，避免在日志或响应中泄露 token/密钥。
- 操作日志全程审计（GitOperationLog），与 audit_hooks 配合，便于追溯。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
