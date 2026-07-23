---
author: qinyi
created_at: 2026-07-12 22:30:00
---

# task-04b — per-worker 独立 worktree 隔离（拆自 task-04）

> 变更：`2026-07-12-team-main-agent-orchestration`
> 依据：task-04 缩小范围决策（用户选拆新 task 含 daemon 改动）+ design §5 per-worker worktree + D-005@v2
> task-04 已完成 patch 采集 + converge 路由；本任务补 worktree 隔离 + git merge 合并 patch

## 目标

per-worker 独立 git worktree 隔离并发写（D-005@v2 完整实现）。daemon-client 架构下 backend 不可达 repo 路径，`git worktree add` 必须经 HostFsDelegate WS RPC 到 daemon handler 执行。

## allowed_paths

- `backend/app/modules/daemon/host_fs/delegate.py`
- `backend/app/modules/agent/execution.py`
- `backend/app/modules/agent/finalizer.py`
- `sillyhub-daemon/src/host-fs-handler.ts`

## implementation

1. **HostFsDelegate 新增 `git_worktree_add`**（仿 `git_apply` delegate.py:267 走 `_via_rpc` 转发 `host_fs.git_worktree_add` 到 daemon）：参数 (workspace, base_ref, branch_name) → 返回 {worktree_path, branch}
2. **daemon `host-fs-handler.ts` 加 `git_worktree_add` method**：在 workspace root_path 本地跑 `git worktree add <path> <branch>`，跨平台靠 daemon git 二进制（Dockerfile 已装 git）
3. **execution.py `dispatch_worker` 接线**：调 HostFsDelegate.git_worktree_add 生成 per-worker 临时分支 + 路径 → 写 `run.worktree_branch`（task-02 已加列）→ 透传 worktree 路径给 `dispatch_to_daemon(root_path=...)` 让 daemon 在隔离 cwd 执行
4. **finalizer.py `finalize_execute_mission` 实现 git merge**：各 worker patch 合并到主 worktree（冲突人审 apply-back，不自动 resolve，D-006 缓解）
5. **worktree 清理**：worker complete 后清理临时分支（防泄漏），via HostFsDelegate

## acceptance

- 每个 worker 独立 worktree（`git worktree list` 可见）
- worker complete → patch 进 AgentArtifact(kind='patch')（task-04 已做采集，本任务补 worktree 隔离）
- converge 合并多 patch 产出统一 diff
- worktree 清理无残留

## verify

- `cd backend && uv run pytest app/modules/agent/tests/test_execution app/modules/agent/tests/test_finalizer -q --no-cov`
- `cd sillyhub-daemon && pnpm test`

## constraints

- 合并冲突人审 apply-back（不自动 resolve，D-006 缓解）
- worktree 操作跨平台（Windows/Linux/macOS）经 daemon git 二进制
- HostFsDelegate 走 WS RPC（daemon-client 模式 backend 不可达 repo 路径）
- worker 按文件分工减少冲突（用户预设列表引导）
- `run_command` 白名单锁死 sillyspec gate（delegate.py:484），不能复用，必须新增 `git_worktree_add` 方法

## depends_on

- task-04（patch 采集 + converge 路由已完成）

## blocks

- task-11（三重收敛完整逻辑依赖 worktree 隔离 + patch 合并）
