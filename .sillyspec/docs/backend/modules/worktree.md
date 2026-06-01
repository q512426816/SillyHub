---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# worktree

> 最后更新：2026-05-31
> 最近变更：feat(worktree): worktree lease lifecycle management
> 模块路径：`app/modules/worktree/**`

## 职责

管理 Git worktree 租约的完整生命周期：获取（acquire）、释放（release）、续约（extend）、过期 GC，包括文件系统操作（裸仓库克隆、worktree 创建/删除、gitconfig/askpass 写入/清除）。

## 当前设计

### 架构

```
WorktreeService（编排层）
  ├── GitRunner（Git 操作）— clone_bare / worktree_add / worktree_remove
  ├── ExecEnvBuilder（执行环境）— 路径规划 / 目录创建 / gitconfig / askpass
  ├── CredentialCipher（凭证加解密）— 解密 Git Identity 的加密凭证
  └── gc_expired_leases() — 定期清理过期租约
```

### 关键逻辑

1. **Acquire**：验证 Git Identity → 获取 workspace.repo_url → 创建 DB 记录 → 文件系统操作（clone bare + worktree add + 写 gitconfig/askpass）
2. **Release**：校验所有权 → git worktree remove → shred askpass（安全清除凭证）→ cleanup 目录 → 标记 released
3. **Extend**：校验所有权 + locked 状态 → 延长 expires_at
4. **GC**：查询所有 `status=locked AND expires_at < now` → shred askpass + cleanup → 标记 expired
5. **安全清除**：askpass 文件包含明文 token，释放时必须 shred 而非 rm
6. **两套路由**：`router`（workspace-scoped）和 `lease_router`（lease-scoped，无 workspace_id）

## 对外接口

| 接口 | 方法 | 说明 | 调用方 |
|------|------|------|--------|
| `POST /workspaces/{ws}/worktrees/acquire` | `acquire_worktree()` | 获取 worktree 租约 | Agent / 前端 |
| `GET /workspaces/{ws}/worktrees` | `list_worktrees()` | 列出 workspace 租约（需 WORKSPACE_ADMIN） | 前端 |
| `GET /worktrees/{lease_id}` | `get_worktree()` | 获取单个租约详情 | Agent / 前端 |
| `POST /worktrees/{lease_id}/release` | `release_worktree()` | 释放租约 | Agent / 前端 |
| `POST /worktrees/{lease_id}/extend` | `extend_worktree()` | 续约租约 | Agent / 前端 |

## 关键数据流

```
POST /workspaces/{ws}/worktrees/acquire → WorktreeService.acquire()
  → _get_identity(git_identity_id, user_id)  # 校验所有权
  → _assert_identity_usable()                # 未吊销、未过期
  → _get_workspace(workspace_id)             # 获取 repo_url
  → 计算 branch_name、lease_root、expires_at
  → INSERT WorktreeLease（DB 先写）
  → git_runner.clone_bare()                  # 裸仓库克隆
  → git_runner.worktree_add()                # 创建 worktree
  → exec_env.create_directories()            # 创建目录结构
  → exec_env.write_gitconfig()               # 写入用户名/邮箱
  → cipher.decrypt() → exec_env.write_askpass()  # 写入凭证
  → COMMIT
```

```
POST /worktrees/{lease_id}/release → WorktreeService.release()
  → _get_lease(lease_id) → 校验所有权
  → 校验 status == "locked"
  → git_runner.worktree_remove()             # 删除 worktree
  → exec_env.shred_askpass()                 # 安全清除凭证文件
  → exec_env.cleanup()                        # 清理目录
  → UPDATE status = "released", released_at = now
  → COMMIT
```

## 设计决策

| 决策 | 理由 | 来源 |
|------|------|------|
| DB 先写再文件操作 | 失败时 rollback DB + cleanup 文件系统 | service.py `acquire` |
| askpass shred 而非 rm | 明文 token 防止文件系统残留泄露 | service.py `shred_askpass` |
| 两套路由（workspace + lease scoped） | 列表按 workspace，操作按 lease | router.py |
| expires_at 由客户端控制（ttl_seconds） | 不同任务执行时间差异大 | model.py |
| Git Identity 解耦 | 凭证管理独立，支持多 provider | git_identity 模块 |

## 依赖关系

### 依赖本模块
- `agent/service.py`：Agent 执行时 acquire/release worktree
- 前端任务执行面板

### 本模块依赖
- `git_identity/model`：GitIdentity 查询 + 凭证解密
- `core/crypto`：CredentialCipher 加解密
- `worktree/git_runner`：Git subprocess 操作
- `worktree/exec_env`：执行环境构建（路径、目录、gitconfig）
- `core/errors`：WorktreeAcquireFailed、WorktreeLeaseNotFound 等 4 种错误
- `workspace/model`：Workspace 查询 repo_url

## 注意事项

- acquire 文件操作失败时会 rollback DB 并 cleanup 已创建的目录
- release 中 worktree_remove 失败只 warning 不阻塞，仍标记 released
- `gc_expired_leases()` 需要定时任务调用（cron / APScheduler），当前无自动调度
- branch_name 格式 `users/{username}/changes/{change_id}/tasks/{task_id}`
- 续约不检查最大续约次数，理论可无限续约
- list_worktrees 需要 `WORKSPACE_ADMIN` 权限，但 get/release/extend 只需 `get_current_user`

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
| 2026-05-31 | 初始归档 | 从代码逆向生成模块文档 |
