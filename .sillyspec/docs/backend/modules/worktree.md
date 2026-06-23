---
schema_version: 1
doc_type: module-card
module_id: worktree
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:08:51
---
# worktree
## 定位
Git worktree 租约（lease）管理。为 change/task 的 agent 执行申请隔离的 git worktree（bare clone + 工作目录 + 分支），提供 acquire/release/extend 与过期回收，供 agent 在独立分支工作。
## 契约摘要
- `POST /api/workspaces/{wid}/worktrees`（acquire）→ WorktreeLease：申请租约，clone 仓库建分支。
- `GET /api/workspaces/{wid}/worktrees`：租约列表；`GET /{lease_id}`：详情。
- `DELETE /api/workspaces/{wid}/worktrees/{lease_id}`（release）：释放。
- `POST /api/workspaces/{wid}/worktrees/{lease_id}/extend`：延期。
- `WorktreeService`：acquire/release/get_lease/list_/extend/gc_expired_leases。
- `GitRunner`（git_runner.py）：clone_bare 等 git 命令封装，失败抛 `GitCommandError`。
- `ExecEnvBuilder`（exec_env.py）：lease_root/repo_dir/bare_repo_path/build_env_vars 路径与环境变量构造。
- 模型：WorktreeLease（workspace/change/task/user/run/git_identity/path/branch_name/status/locked_at/expires_at）。
## 关键逻辑
```
acquire:
  1. 校验 git_identity 可用
  2. 取 workspace.repo_url（无则失败）
  3. 计算 branch=users/<user>/changes/<c>/tasks/<t> + lease_root
  4. 先 INSERT WorktreeLease(status=locked)
  5. GitRunner.clone_bare + 建工作目录 + checkout 分支
  6. 失败回滚删除 lease
```
## 注意事项
- 文件系统操作与 DB 写分离：先落 DB 占位，git 操作失败需回滚 lease。
- 租约有 TTL（ttl_seconds），`gc_expired_leases` 定时回收，释放磁盘。
- 分支命名含 user/change/task，便于追溯；同 change/task 重复 acquire 需去重。
- 依赖 git_identity 解密凭证注入 git 命令环境，identity 吊销会使在用 lease 失效。
## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
