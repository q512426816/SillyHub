---
schema_version: 1
doc_type: module-card
module_id: git_gateway
author: qinyi
created_at: 2026-08-18 01:45:00
---

# Git 操作代理（git_gateway）

## 定位
受限 Git 操作的统一代理入口：agent / tool_gateway 写仓库时经身份解析 + lease 校验 + 命令白名单 + 子进程环境隔离 + 输出脱敏后执行，并异步落 `git_operation_logs` 审计。与 git_identity（提供提交身份）、worktree（提供 lease 仓库目录）强耦合。

## 契约摘要
- `POST /api/worktrees/{lease_id}/git` — 执行 Git 操作（body：operation + args），依赖活跃 worktree lease。
- `GET /api/git/operations` — 分页查询 Git 操作历史（workspace 维度）。
- `GitGatewayService.execute(...)` → `GitOperationResult`（exit_code/stdout/stderr 已脱敏）；`list_operations(...)` 分页查询。
- `validate_operation(operation, args)`：白名单 `ALLOWED_OPERATIONS`（status/diff/add/commit/push/pull/fetch/log/branch/checkout/merge/rebase 共 12 个子命令），拦危险子命令与 flag。
- `redact_output(raw)`：stdout/stderr 敏感信息（token/密钥）脱敏，落库与返回均为脱敏后文本。
- 错误：`GitOperationForbidden`（身份/lease/白名单不匹配）、`GitOperationFailed`（进程非零退出）。
- 模型：git_operation_logs。

## 关键逻辑
```
execute(workspace, user, operation, args, lease_id?):
  name, email = _resolve_git_identity(user)   # 用户绑定 git_identity, 无则禁
  lease = _get_active_lease(lease_id, workspace)
  validate_operation(operation, args)          # 白名单硬校验
  env = ExecEnvBuilder.build_env_vars(lease.path)   # 最小隔离, 不带宿主 os.environ
        + GIT_AUTHOR_*/GIT_COMMITTER_* 作者身份
  proc = run([git, -c, user.name/email, operation, *args], cwd=repo_dir, timeout)
  落 GitOperationLog(脱敏输出); returncode≠0 → GitOperationFailed
```

## 注意事项
- 用户可见错误文案中文（error-message-l10n），技术 ID 在 details。
- 子进程环境隔离（安全加固后）：env 不再 `{**os.environ,...}`（防宿主 SECRET_KEY/DB 密码/API key 灌进 git 子进程），改 `ExecEnvBuilder.build_env_vars`（HOME/GIT_CONFIG_*/GIT_ASKPASS/PATH + 非密 OS 白名单）叠加作者身份；凭证走 lease 的 askpass/gitconfig。
- 白名单硬编码在 `ALLOWED_OPERATIONS`，新增 git 子命令须显式放行，否则 GitOperationForbidden。
- `_resolve_git_identity` 失败（用户未绑 identity）直接禁执行——身份缺失是最常见 403 来源。
- 仓库目录优先 lease.path，无 lease 回退 workspace 根（容器内挂载路径）。
- 审计只落脱敏后输出，排查真实输出需进程级日志；原始输出不出库。
- git_identity / worktree 任一不可用则 gateway 不可用（三方强耦合）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
