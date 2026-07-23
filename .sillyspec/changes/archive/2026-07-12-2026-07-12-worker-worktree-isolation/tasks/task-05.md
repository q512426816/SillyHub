---
id: task-05
title: finalizer.finalize_execute_mission 实现分支合并（逐个 git_merge 各 worker worktree_branch 到 workspace root，冲突收集）+ 单测
title_zh: finalize_execute_mission 实际 git merge 分支合并 + 单测
author: qinyi
created_at: 2026-07-13 00:32:41
priority: P0
depends_on: [task-01, task-03]
blocks: [task-06, task-07, task-08]
requirement_ids: [FR-03]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/agent/finalizer.py
  - backend/app/modules/agent/tests/test_finalize_execute_mission_merge.py
provides:
  - contract: FinalizerMergeResult
    fields: [merged_branches, pending_conflicts]
expects_from:
  task-01:
    - contract: HostFsDelegateWorktreeMethods
      needs: [git_merge]
  task-03:
    - contract: AgentRunWorktreeBranch
      needs: [worktree_branch]
goal: >
  finalize_execute_mission 从"采 patch 列表"升级为实际逐个 git_merge 各 worker worktree_branch 到 workspace root，冲突收集上报（供 task-06 converge_mission 决策）。
implementation:
  - 读 finalizer.py finalize_execute_mission(:167) + converge_mission_for_completed_run(:189)
  - 取 mission 各 worker run 的 worktree_branch（task-03 填值）
  - 逐个调 delegate.git_merge(ws, worker_branch)：ok 收 merged_branches；conflict 收 pending_conflicts（不中断，继续合能合的）
  - 返回 {merged_branches, pending_conflicts} 供 task-06 决策
  - 单测 mock git_merge 返回 ok/conflict 混合
acceptance:
  - 逐个 worker_branch 合并到 workspace root
  - 冲突收集不中断（继续合下一个）
  - 既有 patch 采集（task-04 diff_summary → kind=patch artifact）逻辑保留
  - bootstrap mission（finalize_bootstrap_mission）零回归
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_finalize_execute_mission_merge.py -q
  - cd backend && uv run mypy app/modules/agent/finalizer.py
constraints:
  - bootstrap mission / execute 无 patch（worker 未写代码）回退 finalize_bootstrap_mission 路由零回归
  - 冲突只收集不解决（解决在 task-06 主 agent SDK）
  - 不直接跑 git（走 HostFsDelegate.git_merge RPC）
---
