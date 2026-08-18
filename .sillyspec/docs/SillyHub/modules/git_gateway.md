---
schema_version: 1
doc_type: module-card
module_id: git_gateway
author: qinyi
created_at: 2026-08-18 01:45:00
---

# Git 操作网关（git_gateway）

## 定位
后端「Git 操作网关」：在 worktree lease 上下文内代用户执行受控 git 操作。三道防线（白名单命令 + 危险模式黑名单 + shell 注入检测）→ 最小隔离环境执行 → 输出脱敏 → 全量审计落库。把 agent / tool_gateway / 前端发起的 git 命令收敛到唯一受审计入口，替代裸 shell。

## 契约摘要
- 端点（tag=git_gateway）：
  - `POST /api/worktrees/{lease_id}/git` — 执行一次操作（operation + args，可选 RetryPolicy），返回 GitOperationResponse。
  - `GET /api/git/operations` — 当前用户操作日志，支持 workspace_id / lease_id 过滤 + 分页（page_size≤100）。
- 白名单 `ALLOWED_OPERATIONS`（12 个）：status / diff / add / commit / push / pull / fetch / log / branch / checkout / merge / rebase。
- 黑名单 `BLOCKED_PATTERNS`：`--force` / `--hard` / `clean ` / `reflog` / `--exec`；push 额外保护：目标为 `main`/`master` 拒绝、`-f` 拒绝。
- `SHELL_INJECTION_PATTERNS`：`$(`、反引号、`;cmd`、`|cmd`、`&&cmd`、`> /path` 重定向。
- `GitOperationLog`（git_operation_logs 表）：workspace_id / lease_id / user_id / operation / args_json / result_code / redacted_output / timestamp；索引 (lease_id,timestamp) 与 (workspace_id,timestamp)。
- 错误：`GitOperationForbidden`（403，白名单/黑名单/注入拦截）、`GitOperationFailed`（502，执行失败）。
- 依赖 git_identity（作者署名）、worktree（lease 归属 + ExecEnvBuilder 隔离环境）。

## 关键逻辑
```
execute(lease_id,user_id,operation,args):
  validate_operation（白名单→黑名单→push 保护→注入检测）
  → _get_active_lease(lease_id,user_id) → _resolve_repo_dir(lease)
  → _resolve_git_identity(user_id) 取 name/email（无身份兜底
    "SillyHub Agent" / agent@sillyhub.local）
  → env = ExecEnvBuilder().build_env_vars(path) + GIT_AUTHOR/COMMITTER_*
    （最小隔离：HOME/GIT_CONFIG_*/GIT_ASKPASS/PATH + OS 白名单，不 **os.environ）
  → create_subprocess_exec(git ...) 30s 超时（RetryPolicy 可重试）
  → redact_output → 写 GitOperationLog → 返回
```

## 注意事项
- 执行环境是安全关键：绝不能把 `os.environ` 整体传给子进程（会带出主密钥等机密），必须经 ExecEnvBuilder 白名单构建——security 变更后加固点。
- `redact_output` 三类脱敏：GitHub PAT（ghp_/gho_/ghu_/ghs_/github_pat_ 前缀）、Bearer token、URL 内嵌凭证（`://user:token@`）；超 64000 字节截断。
- 新增可执行 git 子命令需评估安全影响并同步三处校验（白名单、黑名单、push 保护）。
- 必须持有有效 lease（校验 user 归属），无 lease / 他人 lease 拒绝执行。
- push 到受保护分支（main/master）在网关层硬拦，与平台侧分支策略无关。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
