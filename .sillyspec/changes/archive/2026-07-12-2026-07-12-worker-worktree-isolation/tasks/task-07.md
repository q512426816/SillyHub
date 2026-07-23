---
id: task-07
title: finalizer 合并后清理（全成功 git_worktree_remove 各副本 + 采合并 diff 作 patch artifact；失败保留副本）+ 单测
title_zh: 合并后 worktree 清理 + patch 采集 + 单测
author: qinyi
created_at: 2026-07-13 00:32:41
priority: P0
depends_on: [task-01, task-05]
blocks: [task-08]
requirement_ids: [FR-05]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/agent/finalizer.py
  - backend/app/modules/agent/tests/test_finalizer_cleanup.py
expects_from:
  task-01:
    - contract: HostFsDelegateWorktreeMethods
      needs: [git_worktree_remove]
  task-05:
    - contract: FinalizerMergeResult
      needs: [merged_branches]
goal: >
  converge 全成功后逐个 git_worktree_remove 清各 worker 副本 + 采 workspace root 合并 diff 作 kind=patch artifact；merge 失败回退路径副本保留供排查（X-003）。
implementation:
  - 读 finalizer.py（task-05 改后的 finalize_execute_mission 返回 merged_branches/pending_conflicts）
  - 全 merged 成功（pending_conflicts 空 + 无 mission needs_manual）→ 逐个 delegate.git_worktree_remove(ws, sibling_path) 清副本
  - 采 workspace root 合并后 diff → AgentArtifact(kind="patch", content_ref=diff)
  - 失败路径（task-06 回退 needs_manual）→ 不清副本（保留排查）
  - 单测覆盖：成功清理各副本 / 失败保留
acceptance:
  - 全成功 → 各 worker 副本删除 + patch artifact 写入
  - 失败 → 副本保留（git_worktree_remove 不调）
  - ruff + mypy 绿
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_finalizer_cleanup.py -q
  - cd backend && uv run mypy app/modules/agent/finalizer.py
constraints:
  - 仅成功路径清理（X-003，区别于失败的保留）
  - 无 GC 机制（D-005，合并后立即清）
  - 不直接跑 git（走 HostFsDelegate.git_worktree_remove RPC）
---
