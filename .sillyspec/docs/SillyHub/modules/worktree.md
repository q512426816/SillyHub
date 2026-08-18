---
schema_version: 1
doc_type: module-card
module_id: worktree
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 隔离工作树租赁管理（worktree）

## 定位
为 agent 执行提供隔离 Git 工作树（worktree）的租赁管理：
bare repo + `git worktree` 检出独立目录，构建执行环境（.gitconfig + askpass 凭据注入），
lease 生命周期（acquire/release/extend）。
是「多 agent 并发改同一仓库互不踩」的物理隔离底座，
tool_gateway 的所有文件操作都被限制在 lease 根目录内。

## 契约摘要
- 路由（两个 router，URL 语义分离）：
  - workspace 嵌套 `prefix=/workspaces/{workspace_id}`：
    `POST /worktrees` acquire（`WorktreeAcquireRequest`→`WorktreeLeaseRead`）、
    `GET /worktrees` 列表（`WorktreeLeaseList`）
  - 全局 `lease_router tag=worktree`：
    `GET /worktrees/{lease_id}` 详情、
    `POST /worktrees/{lease_id}/release`、
    `POST /worktrees/{lease_id}/extend`（`WorktreeExtendRequest`）
- 数据 `WorktreeLease`（worktree_leases 表）：
  workspace_id / component_id / change_id / task_id / user_id / run_id / git_identity_id、
  path（unique，同目录不会双 lease）、branch_name、
  status（仅 locked / released 两值，默认 locked）、
  locked_at / released_at / expires_at；
  索引 `ix_worktree_active(task_id,status)`、`ix_worktree_expires(status,expires_at)`
- 子组件：
  - `GitRunner`：clone_bare / worktree_add / worktree_remove，
    `asyncio.create_subprocess_exec` 跑 git（依赖 git 在 PATH），
    失败抛 `GitCommandError(cmd, returncode, stderr)`
  - `ExecEnvBuilder`：统一规划 lease_root / repo_dir / bare_repo_path /
    gitconfig / askpass 路径；build_env_vars 注入 HOME / GIT_ASKPASS 等子进程环境
- 前置条件：workspace 必须配置 repo_url 才能 acquire；
  凭据经 `core.crypto.CredentialCipher` 解密注入，明文 token 不落库

## 关键逻辑
acquire（`WorktreeService.acquire`）：
```
identity 可用性校验 → workspace.repo_url 必填（缺则 400）
branch = users/<git_username|user>/changes/<change>/tasks/<task>
先 INSERT lease(status=locked)                  # DB 记录先行，便于追溯
clone_bare → worktree_add → 建目录 → gitconfig → write_askpass(解密 token)
失败：rollback + cleanup（rmtree 移线程池）重抛；成功：commit
```
- `GitRunner.clone_bare` 在拉起 git 子进程**之前**调 `core.ssrf.assert_safe_repo_url`：
  放行 https / ssh / git 协议 + scp-like 语法（含内网 git，design B3/D-004），
  非法抛 `UnsafeRepoUrl(400)`，不触子进程
- release：owner 本人或 admin（否则 PermissionDenied）→
  worktree_remove（best-effort，失败仅告警不阻断）→
  `shred_askpass`（覆写+删除 token 脚本）→ cleanup（线程池）→ status=released
- extend：owner 且当前 locked，`expires_at += additional_seconds`；
  get_lease / list_ 同样做 owner/admin 可见性校验

## 注意事项
- **当前代码库没有 WorktreeLease 过期回收调用方**：
  旧 `gc_expired_leases` 已不在 service 中；expires_at 与 `ix_worktree_expires`
  索引仍在但无人清扫。daemon.lease 的过期批处理（handle_expired_leases_batch）
  是 daemon 任务租约域，不覆盖本表——泄漏只能靠显式 release 兜
- token 生命周期：acquire 时解密写临时 askpass 脚本，release 时 shred 覆写删除；
  acquire 失败分支的 cleanup 能兜住建环境半途的崩溃，release 未被调则目录与脚本滞留
- cleanup / rmtree 一律走 `asyncio.to_thread`（同步 FS 阻塞事件循环的性能修复，勿改回）
- acquire 非幂等：同参数重复 acquire 每次生成新 run_id / 新 lease 行
- lease 与 change/task/run 关联字段便于追溯哪次执行占用；component_id 当前与 workspace 同值占位
- Windows 兼容：git 子进程与路径处理需保持跨平台（PATH、路径分隔符）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
