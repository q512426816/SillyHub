---
id: task-01
title: backend HostFsDelegate 新增 git_worktree_add/git_merge/git_worktree_remove（走 _via_rpc_or_degrade WS RPC）+ 单测
title_zh: backend HostFsDelegate 新增 worktree 三方法 + 单测
author: qinyi
created_at: 2026-07-13 00:32:41
priority: P0
depends_on: []
blocks: [task-03, task-05, task-07]
requirement_ids: [FR-01, FR-03, FR-05]
decision_ids: [D-006@v1]
allowed_paths:
  - backend/app/modules/daemon/host_fs/delegate.py
  - backend/app/modules/daemon/host_fs/tests/test_delegate_worktree.py
provides:
  - contract: HostFsDelegateWorktreeMethods
    fields: [git_worktree_add, git_merge, git_worktree_remove]
goal: >
  backend HostFsDelegate 加 3 个 worktree/merge/remove async 方法（仿 git_apply 走 _via_rpc_or_degrade WS RPC 到 daemon），为 dispatch_worker/finalizer 提供 worktree 操作能力。
implementation:
  - 读 delegate.py git_apply(:267) + _via_rpc_or_degrade(:616) 作为模板
  - 新增 git_worktree_add(workspace, *, sibling_path, branch, base_ref) → {ok, worktree_path, error}，method="git_worktree_add"，degraded={ok:False, error:"rpc unavailable"}
  - 新增 git_merge(workspace, *, worker_branch) → {ok, conflicts, merged_files, error}，method="git_merge"
  - 新增 git_worktree_remove(workspace, *, sibling_path) → {ok, error}，method="git_worktree_remove"
  - 单测 test_delegate_worktree.py mock WS RPC 覆盖 ok/conflict/error/degraded 四路径
acceptance:
  - 3 方法签名与 design §7 一致（含 degraded fallback）
  - 单测覆盖 ok/conflict/error/degraded 四返回路径
  - mypy + ruff 绿
verify:
  - cd backend && uv run pytest app/modules/daemon/host_fs/tests/test_delegate_worktree.py -q
  - cd backend && uv run mypy app/modules/daemon/host_fs/delegate.py
  - cd backend && uv run ruff check app/modules/daemon/host_fs
constraints:
  - 走 _via_rpc_or_degrade（独立 method），不动 run_command 命令白名单
  - 不碰 backend/app/modules/worktree/（bare-clone 死代码）
  - degraded fallback 必须有（daemon 离线不崩调用方）
---
