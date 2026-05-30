---
author: qinyi
created_at: 2026-05-30 16:48:00
---

# git_gateway

> 最后更新：2026-05-30
> 最近变更：2026-05-30-change-writer
> 模块路径：`backend/app/modules/git_gateway/**`

## 职责

在 worktree lease 隔离环境内执行受控的 Git 操作，提供白名单审计、输出脱敏和操作日志记录。

## 当前设计

`GitGatewayService` 是所有 Git 操作的唯一入口，执行流程：

1. **白名单校验**：`validate_operation()` 检查 operation 是否在 `ALLOWED_OPERATIONS` 中，并扫描 `BLOCKED_PATTERNS`（--force、--hard、clean、reflog、--exec）
2. **受保护分支检测**：push 操作拒绝 main/master 分支和 `-f` 短标志
3. **Shell 注入防护**：扫描参数中的命令替换、管道、链式执行等注入模式
4. **Git 身份解析**：`_resolve_git_identity()` 查询用户的 GitIdentity（未撤销），回退到默认 Agent 身份
5. **子进程执行**：`asyncio.create_subprocess_exec` 执行 git 命令，30s 超时控制
6. **重试策略**：可选的指数退避重试（RetryPolicy：max_retries + base_delay）
7. **输出脱敏**：`redact_output()` 移除 PAT（ghp_/gho_/ghu_/ghs_/github_pat_）、Bearer token、URL token
8. **审计日志**：写入 `GitOperationLog` 表（workspace_id、lease_id、user_id、operation、result_code、redacted_output）

### 白名单操作

`status`、`diff`、`add`、`commit`、`push`、`pull`、`fetch`、`log`、`branch`、`checkout`、`merge`、`rebase`

## 对外接口

| 接口 | 方法 | 说明 | 调用方 |
|------|------|------|--------|
| POST `/worktrees/{lease_id}/git` | `execute()` | 执行单个 git 操作 | 前端/Agent/change_writer |
| GET `/git/operations` | `list_operations()` | 分页查询操作审计日志 | 前端 |

## 关键数据流

```text
调用方 → GitGatewayService.execute(lease_id, user_id, operation, args)
  → validate_operation() [白名单 + 注入防护]
  → _get_active_lease() [lease 验证]
  → _resolve_git_identity() [author name/email]
  → asyncio.create_subprocess_exec() [git 命令执行]
  → redact_output() [PAT/token 脱敏]
  → GitOperationLog [审计日志写入]
  → 返回 GitOperationLog
```

## 设计决策

| 决策 | 理由 | 来源 |
|------|------|------|
| 白名单而非黑名单 | 安全默认，只允许已知安全操作 | 初始设计 |
| 子进程而非 GitPython | 避免重依赖，控制更精确 | 初始设计 |
| 30s 超时 | Git 操作通常在秒级完成，30s 足够且防挂起 | 初始设计 |
| 输出截断 64KB | 防止巨量输出消耗内存 | 初始设计 |
| 受保护分支拒绝 push | 防止误操作 main/master | 初始设计 |

## 依赖关系

### 依赖本模块
- `change_writer`（计划中的 Phase B：git_commit_and_push 通过 GitGatewayService 执行 add/commit/push）

### 本模块依赖
- `worktree` 模块：WorktreeLease 模型、ExecEnvBuilder
- `git_identity` 模块：GitIdentity 模型
- `app.core.errors`：AppError、PermissionDenied、WorktreeLeaseNotFound
- `app.core.logging`：get_logger

## 注意事项

- `redact_output()` 覆盖 GitHub PAT 格式（ghp_/gho_/ghu_/ghs_/github_pat_），其他平台的 token 格式需按需扩展
- 默认分支保护硬编码为 `{main, master}`，如果项目使用其他默认分支名需调整
- `_resolve_git_identity()` 只查第一个未撤销的身份，多身份场景下行为未定义
- 重试策略 `RetryPolicy` 通过参数传入，默认不重试

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
| 2026-05-30 | 2026-05-30-change-writer | router/schema/service 微调以支持 change_writer Phase B 调用 |
