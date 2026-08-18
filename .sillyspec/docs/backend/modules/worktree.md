---
schema_version: 1
doc_type: module-card
module_id: worktree
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 执行隔离租约（worktree）

## 定位

git worktree **执行隔离租约**：为 change/task 的 agent 执行申请隔离工作树（bare clone +
worktree + 专属分支 + git 凭据注入），acquire/release/extend 全生命周期。磁盘布局与
子进程隔离 env 的构造器（ExecEnvBuilder）被 git_gateway / tool_gateway 复用。

## 契约摘要

- `POST /api/workspaces/{wid}/worktrees`（acquire，body：git_identity_id / change_id /
  task_id / component_id / ttl_seconds）→ WorktreeLease
- `GET /api/workspaces/{wid}/worktrees`（列表）/ `GET .../worktrees/{lease_id}`（详情，
  本人或 admin）
- `DELETE .../worktrees/{lease_id}`（release）
- `POST .../worktrees/{lease_id}/extend`（续期 expires_at）
- `WorktreeService`：acquire / release / get_lease / list_ / extend
- `GitRunner`：asyncio.create_subprocess_exec 封装（无 shell=True，显式 env，clone 前
  `assert_safe_repo_url` SSRF 校验；CLONE_TIMEOUT 120s / WORKTREE_TIMEOUT 30s，非零
  退出抛 GitCommandError）
- `ExecEnvBuilder`：lease_root / repo_dir / bare_repo_path 目录布局、build_env_vars
  最小隔离 env、write_gitconfig / write_askpass / shred_askpass、cleanup（rmtree）
- 表 `worktree_leases`：workspace/component/change/task/user 五 FK CASCADE、run_id、
  git_identity_id、path（unique）、branch_name、status（locked/released）、
  locked_at / released_at / expires_at；索引 ix_worktree_active / ix_worktree_expires

## 关键逻辑

```
acquire: 校验 identity 可用 → workspace.repo_url 必填
  branch = users/{git_username}/changes/{cid}/tasks/{tid}
  先 INSERT lease(status=locked) → clone_bare + worktree_add + 建目录
  + write_gitconfig + write_askpass(CredentialCipher 解密 token)
  任一步失败: rollback + to_thread cleanup 整目录
release: 本人或 admin → worktree_remove(失败仅告警) → shred_askpass
  → to_thread cleanup → status=released
```

## 注意事项

- **无过期回收器**：expires_at 与 ix_worktree_expires 索引存在，但**没有后台任务扫过
  期 WorktreeLease 翻转状态/清磁盘**（daemon 的 lease 过期批处理是 DaemonTaskLease
  域，与本表无关）——过期 lease 只能靠显式 release 或人工处理
- DB 先行：先落 lease 行再动文件系统，git 失败必须回滚 DB + 清目录（代码已按此实
  现）；cleanup/rmtree 均 to_thread 避免阻塞事件循环
- 凭据经 askpass 脚本注入，release 时 shred + unlink；identity 吊销不影响已发 lease
  的 askpass 文件（快照式），但新 acquire 会被 `_assert_identity_usable` 拦
- build_env_vars 的 `_OS_ENV_ALLOWLIST`（ql-20260808-001）：透传 Win SYSTEMROOT/
  TEMP/TMP/PATHEXT/COMSPEC 与 POSIX TMPDIR/LANG/LC_* 等**非密** OS 项保证子进程跨
  平台可启动（Win 缺 SYSTEMROOT 致 python 启动失败）；宿主 os.environ 其余项（密
  钥类）绝不进隔离 env
- branch 命名含 user/change/task 便于追溯；lease.path 全局 unique
- clone 目标 URL 经 core/ssrf `assert_safe_repo_url`（防 file:// / 内网地址）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
