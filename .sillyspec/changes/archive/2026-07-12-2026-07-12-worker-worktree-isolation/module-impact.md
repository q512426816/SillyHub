---
author: qinyi
created_at: 2026-07-13 02:50:00
change: 2026-07-12-worker-worktree-isolation
---

# 模块影响分析（Module Impact）— per-worker worktree 隔离

## 影响模块

### backend/app/modules/daemon/host_fs（新增能力，D-006 走 HostFsDelegate 轻量路径）
- `HostFsDelegate` 新增 3 async 方法：`git_worktree_add` / `git_merge` / `git_worktree_remove`（走 `_via_rpc_or_degrade` WS RPC，仿 `git_apply:267`）
- 新增测试 `tests/test_delegate_worktree.py`（10 用例，覆盖 ok/conflict/error/degraded）
- 模块对外能力扩展：现有 9 方法 → 12 方法

### sillyhub-daemon/src（新增 handler）
- `host-fs-handler.ts` 新增 3 方法：`gitWorktreeAdd`（含 D-008 默认 identity `-c user.name=worker -c user.email=worker@sillyhub`）/ `gitMerge`（解析冲突 marker via `git diff --diff-filter=U`）/ `gitWorktreeRemove`（`--force`）
- `daemon.ts` `_registerHostFsRpcHandler`（:2205 附近）注册 3 RPC handler（`host_fs.git_worktree_add/git_merge/git_worktree_remove`）
- 新增测试 `tests/host-fs-handler-worktree.test.ts`（13 用例，含 D-008 identity 断言 + 越界拒绝）

### backend/app/modules/agent（行为扩展）
- `execution.py`：`dispatch_worker:88` 接 worktree（D-001@v2 路径 `.worktrees/<run.id[:8]>` workspace 内 + HostFsDelegate `__init__` 注入 None 零回归）+ `render_worker_prompt:65` 三约束（只写代码/必 commit/按文件分工）
- `finalizer.py`：`finalize_execute_mission:167` 从"采 patch 占位"升级为分支合并（`FinalizerMergeResult{merged_branches, pending_conflicts}` + `has_execute_patches`）+ 新增 `cleanup_mission` 方法
- `mcp_tools.py`：`converge_mission:293` 改可重入状态机（R-07 计数用 `AgentMission.constraints` JSON + env `CONVERGE_MAX_CONFLICT_ATTEMPTS` 默认 3 + 简化 R-07 超限标 needs_manual 不实际 abort）
- 新增测试 6 文件（test_dispatch_worker_worktree 4 / test_render_worker_prompt 5 / test_finalize_execute_mission_merge 7 / test_converge_mission_reentrant 14 / test_finalizer_cleanup 8 / test_worktree_integration 6 集成 4 场景）

## 文件变更清单

| 操作 | 文件 | 说明 |
|---|---|---|
| 新增方法 | `backend/app/modules/daemon/host_fs/delegate.py` | +3 async 方法（+101 行）|
| 修改 | `sillyhub-daemon/src/host-fs-handler.ts` | +3 方法实现（+264 行）|
| 修改 | `sillyhub-daemon/src/daemon.ts` | +3 RPC handler 注册（+30 行）|
| 修改 | `backend/app/modules/agent/execution.py` | dispatch_worker + render_worker_prompt（+83 行）|
| 修改 | `backend/app/modules/agent/finalizer.py` | finalize_execute_mission + cleanup_mission（+336 行）|
| 修改 | `backend/app/modules/agent/mcp_tools.py` | converge_mission 可重入（+270 行）|
| 新增测试 | `backend/app/modules/daemon/host_fs/tests/test_delegate_worktree.py` | 10 用例 |
| 新增测试 | `backend/app/modules/agent/tests/`（6 文件）| dispatch/prompt/merge/converge/cleanup/integration |
| 新增测试 | `sillyhub-daemon/tests/host-fs-handler-worktree.test.ts` | 13 用例 |

总 14 文件，3715 insertions（主仓库 commit `eff04e72`）。

## 新增接口契约

### HostFsDelegate（backend → daemon WS RPC）
- `host_fs.git_worktree_add({workdir, sibling_path, branch, base_ref})` → `{ok, worktree_path, error}`
- `host_fs.git_merge({workdir, worker_branch})` → `{ok, conflicts:[{file, marker_lines}], merged_files, error}`
- `host_fs.git_worktree_remove({workdir, sibling_path})` → `{ok, error}`

### AgentRun 字段（task-02 已加，本变更填值）
- `worktree_branch: str | None`（worker dispatch 填 `workers/<run.id[:8]>`，converge 读取）

### AgentMission.constraints JSON 新增键
- `conflict_attempts`（R-07 解冲突轮次计数，int）
- `needs_manual`（R-07 超限标记，`{reason}`）

## 数据模型
- **无新表/无新 migration**（`worktree_branch` / `kind=patch` 字段 task-02/04 已加；R-07 计数复用 `constraints` JSON 列，规避迁移链断裂）

## 模块依赖变化
- backend `agent` 模块 → `daemon/host_fs` 模块（新增依赖：`dispatch_worker` / `finalize_execute_mission` / `cleanup_mission` 调 `HostFsDelegate`）
- **生产接线 gap（留 deployment）**：`router:779` / `mcp_tools:214` / `finalizer:215` / `bootstrap:267` 构造 `MissionExecutionService` / `FinalizerService` 传 `host_fs_delegate`（进程级 ws_hub/ws_rpc），当前 None 走原行为零回归

## 风险
- **integration-critical**（daemon RPC + lease + lifecycle + git worktree 操作）
- 真服务 e2e（backend↔daemon host_fs RPC 端到端）+ delegate 接线留 deployment（verify gate deployment-critical 锁死，`complete-stage --force` 绕过；单测 375+62 + 真实 git worktree 集成证据已验证命令级正确性）

## 关联模块文档
- `docs/multi-agent-platform/modules/backend.md`（agent + daemon/host_fs 子模块）
- `docs/multi-agent-platform/modules/sillyhub-daemon.md`（host-fs-handler + daemon.ts）
