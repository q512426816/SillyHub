---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# worktree
> 最后更新：2026-06-01
> 最近变更：scan（初始生成）
> 模块路径：backend/app/modules/worktree/**

## 职责

Worktree 模块为 Agent 执行提供隔离的 Git 工作树（worktree）租赁管理。每个 lease 对应一个独立目录，Agent 在其中安全地执行代码操作，完成后释放。模块负责 bare repo 管理、git worktree add/remove、环境构建（.gitconfig、askpass）、lease 过期回收。

## 当前设计

| 文件 | 角色 |
|------|------|
| `model.py` | ORM 模型 — `WorktreeLease`（跟踪 lease 状态、路径、过期时间） |
| `schema.py` | Pydantic DTO — `WorktreeAcquireRequest`, `WorktreeLeaseRead`, `WorktreeLeaseList`, `WorktreeExtendRequest` |
| `service.py` | 核心业务逻辑 — `WorktreeService`（acquire / release / extend / gc） |
| `router.py` | FastAPI 路由 — 两个 router：`router`（workspace 下嵌套）和 `lease_router`（全局 lease 操作） |
| `exec_env.py` | 执行环境构建器 — `ExecEnvBuilder`（目录、gitconfig、askpass、环境变量） |
| `git_runner.py` | Git 命令执行器 — `GitRunner`（clone-bare / worktree-add / worktree-remove） |

### 核心流程

1. **Acquire**：Agent 请求 worktree → 校验 workspace/component/change/task → `GitRunner.clone_bare()` → `GitRunner.worktree_add()` → `ExecEnvBuilder` 创建环境 → 写入 DB lease 记录
2. **Release**：释放 lease → `ExecEnvBuilder.cleanup()` → `GitRunner.worktree_remove()` → 标记 lease released
3. **Extend**：延长 lease 过期时间
4. **GC**：`gc_expired_leases()` 定期清理过期未释放的 lease

## 对外接口

### Workspace 嵌套路由（prefix: `/workspaces/{workspace_id}`）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/workspaces/{workspace_id}/worktrees` | 申请 worktree lease |
| GET | `/workspaces/{workspace_id}/worktrees` | 列出 workspace 下所有 lease |

### Lease 全局路由（`lease_router`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/worktrees/{lease_id}` | 获取 lease 详情 |
| POST | `/worktrees/{lease_id}/release` | 释放 lease |
| POST | `/worktrees/{lease_id}/extend` | 延长 lease 过期时间 |

## 关键数据流

```
Agent 请求 acquire (workspace_id, component_id, change_id, task_id)
  → 校验 identity 可用（_assert_identity_usable）
  → GitRunner.clone_bare() → 创建 bare repo
  → GitRunner.worktree_add() → 检出分支
  → ExecEnvBuilder.create_directories()
  → ExecEnvBuilder.write_gitconfig() + write_askpass()
  → DB INSERT WorktreeLease (status=locked)
  → 返回 lease_id + path + branch_name
```

## 设计决策

| 决策 | 原因 |
|------|------|
| Bare repo + git worktree 隔离 | 每个 agent 执行在独立目录，互不干扰 |
| Lease 过期机制 | 防止 agent 崩溃后 worktree 泄漏 |
| askpass 脚本 + shred | 敏感 token 写入临时文件，使用后 shred 安全删除 |
| 两个 router 分离 | workspace 嵌套操作 vs 全局 lease 操作，URL 语义清晰 |
| `ExecEnvBuilder` 独立类 | 环境构建逻辑与业务逻辑解耦，方便测试 |

## 依赖关系

- **内部依赖**：`app.core.crypto`（CredentialCipher 解密 token）, `app.core.errors`, `app.core.logging`, `app.models.base`, `app.modules.git_identity.model`（GitIdentity）, `app.modules.workspace.model`（Workspace）
- **外部依赖**：SQLModel, SQLAlchemy AsyncSession, asyncio（subprocess 执行 git）
- **被依赖模块**：agent 执行层通过 lease_id 使用 worktree 路径

## 注意事项

- `GitRunner` 使用 `asyncio.create_subprocess_exec` 执行 git 命令，需要确保 git 在 PATH 中
- `ExecEnvBuilder.shred_askpass()` 使用覆写 + 删除方式安全清理 token，但不是加密级别安全
- `WorktreeService.gc_expired_leases()` 需要定时调用（cron / background task），当前模块不自带调度
- `path` 字段有 unique 约束，同一目录不会有两个 lease
- `status` 字段：locked / released，默认 locked

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
