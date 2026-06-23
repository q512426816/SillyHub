---
schema_version: 1
doc_type: module-card
module_id: worktree
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:36
---
# worktree

## 定位
为 agent 执行提供隔离 Git 工作树（worktree）的租赁管理。每个 lease 对应一个独立目录，agent 在其中安全执行代码操作，完成后释放。负责 bare repo 管理、git worktree add/remove、执行环境构建（.gitconfig + askpass 凭据注入）、lease 过期回收。是 agent 执行隔离性的物理基础。

产品视角：这是「多 agent 并发改同一仓库不互相踩」的底座。每次 agent 执行前 acquire 一个独立 worktree（从 bare repo 检出分支），拿到独立目录 + 注入好的 git 凭据环境，执行完 release 回收。tool_gateway 的所有操作都被限制在 lease 目录内。lease 过期 GC 防止崩溃泄漏。它让 SillyHub 的并发执行安全且资源可控。

## 契约摘要
- 路由：
  - `APIRouter prefix=/workspaces/{workspace_id} tag=worktree`：`POST /worktrees` acquire（`WorktreeAcquireRequest`→`WorktreeLeaseRead`）、`GET /worktrees` 列表（`WorktreeLeaseList`）
  - `lease_router tag=worktree`：`GET /worktrees/{lease_id}` 详情、`POST /worktrees/{lease_id}/release`、`POST /worktrees/{lease_id}/extend`（`WorktreeExtendRequest`）
- 数据：`WorktreeLease`（workspace_id/component_id/change_id/task_id/user_id/run_id/git_identity_id/path 唯一/branch_name/status/locked_at/released_at/expires_at）
- 子组件：`GitRunner`（clone_bare/worktree_add/worktree_remove）、`ExecEnvBuilder`（目录/gitconfig/askpass/env vars）
- 错误：`GitCommandError`（cmd/returncode/stderr）
- 依赖：`core`（crypto CredentialCipher 解密 token）、`models`、`workspace`、`git_gateway`、`git_identity`；被 `agent`/`daemon`/`tool_gateway` 通过 lease_id 使用
- 跨组件协作：agent 执行前 acquire lease → tool_gateway 操作绑定 lease 根目录 → 完成后 release

## 关键逻辑
acquire 主链路（`WorktreeService.acquire`）：
```
identity = _get_identity(identity_id); _assert_identity_usable(identity)
GitRunner.clone_bare(remote, bare_path)           # 建 bare repo
GitRunner.worktree_add(bare_path, branch, path)   # 检出分支
ExecEnvBuilder.create_directories(lease_root)
ExecEnvBuilder.write_gitconfig(lease_root, identity)
ExecEnvBuilder.write_askpass(lease_root, token)   # token 解密后写临时脚本
INSERT WorktreeLease(status=locked) → 返回 lease_id + path + branch
```
- release：`ExecEnvBuilder.cleanup`（shred_askpass 覆写删 token）→ `worktree_remove` → 标记 released
- `gc_expired_leases` 回收过期未释放 lease（需外部定时调度）
- `build_env_vars` 注入 HOME / GIT_ASKPASS 等环境变量供 agent 子进程
- `_assert_identity_usable` 校验 git identity 凭据有效未过期
- `bare_repo_path` / `repo_dir` / `home_dir` / `gitconfig_path` / `askpass_path` 由 ExecEnvBuilder 统一规划路径
- `write_askpass` 写临时脚本承载 token，`shred_askpass` 用后安全清理

### GitRunner 命令执行
`GitRunner` 用 asyncio 子进程跑 git：
- `_run` 通用 git 命令执行，失败抛 `GitCommandError`（cmd/returncode/stderr）
- `clone_bare(remote, path)`：克隆 bare repo 作为 worktree 源
- `worktree_add(bare, branch, path)`：从 bare repo 检出指定分支到独立目录
- `worktree_remove(path)`：释放时移除 worktree
- 所有命令在 ExecEnvBuilder 构建的环境（HOME/GIT_ASKPASS）下执行

## 注意事项
- `GitRunner` 用 `asyncio.create_subprocess_exec` 跑 git，依赖 git 在 PATH
- `shred_askpass` 覆写+删除清理 token，非加密级安全
- `gc_expired_leases` 不自带调度，需 cron/background task 定时调，否则过期 lease 占目录
- path 字段 unique，同目录不会有两个 lease
- status 仅 locked/released，默认 locked
- token 经 `core.crypto.CredentialCipher` 解密后注入，不明文落库
- extend 用于长任务续期，避免执行中被 gc 回收
- bare repo + git worktree 实现执行隔离，每 agent 独立目录互不干扰
- 两个 router 分离：workspace 嵌套（acquire/list）vs 全局 lease（release/extend），URL 语义清晰
- `_get_lease`/`_get_identity`/`_get_workspace` 取关联实体并校验
- `_path_or_none` 容错处理可选路径字段
- acquire 的 branch_name 由调用方指定或自动生成
- expires_at 默认设未来某时刻，extend 续期
- released_at 释放时戳，gc 据此+expires_at 判断可回收
- ExecEnvBuilder.create_directories 建 lease_root/repo/home 等目录
- build_env_vars 返回 dict 供 agent 子进程注入
- lease 与 change/task/run 关联，便于追溯哪次执行占用
- GitRunner._run 捕获 stdout/stderr/returncode，失败组装 GitCommandError
- clone_bare 只在 bare repo 不存在时执行，已存在则复用
- worktree_add 的 branch 不存在时从默认分支创建
- ExecEnvBuilder.lease_root 由 workspace_id+component_id+随机派生
- extend 的时长由 WorktreeExtendRequest 指定，累加到 expires_at
- gc_expired_leases 返回回收数，供调度日志记录
- acquire 是幂等的：同 run_id 重复 acquire 返回已有 lease

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
