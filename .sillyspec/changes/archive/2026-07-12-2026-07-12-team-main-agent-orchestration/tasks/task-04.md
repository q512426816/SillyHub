---
id: task-04
title: execution.py per-worker 独立 worktree + finalizer.py 合并 patch + 修 v1 patch→Artifact 断点
title_zh: 并发写隔离与 patch 合并收敛
author: qinyi
created_at: 2026-07-12 13:04:06
priority: P0
depends_on: [task-02]
blocks: [task-11]
requirement_ids: [FR-3, FR-6]
decision_ids: [D-003@v2, D-005@v2]
allowed_paths:
  - backend/app/modules/agent/execution.py
  - backend/app/modules/agent/finalizer.py
provides:
  - contract: ConvergeMission
    fields: [merge_worker_patches, force_converge, patch_artifact]
  - contract: PerWorkerWorktree
    fields: [worktree_add, worktree_cleanup]
expects_from:
  task-02:
    - contract: AgentRun
      needs: [worktree_branch]
    - contract: AgentMission
      needs: [worker_preset]
goal: >
  每个 worker 独立 git worktree 隔离并发写，converge 时合并 patch，修复 v1 patch 采集断点。
implementation:
  - execution.py dispatch_worker：git worktree add 临时分支（基于 workspace root）+ per-worker provider/model 从 worker_preset 读
  - finalizer.py converge_mission：git merge 各 worker patch 到主 worktree（冲突人审 apply-back）
  - 修 v1 断点：finalize_execute_mission patch → AgentArtifact(kind='patch') 采集（v1 全代码无调用点）
  - worktree 清理（worker complete 后清理临时分支，防泄漏）
acceptance:
  - 每个 worker 独立 worktree（git worktree list 可见）
  - worker complete → patch 进 AgentArtifact(kind='patch')
  - converge 合并多 patch 产出统一 diff
  - worktree 清理无残留
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_execution app/modules/agent/tests/test_finalizer -q --no-cov
constraints:
  - 合并冲突人审 apply-back（不自动 resolve）
  - worker 按文件分工减少冲突（用户预设列表引导）
  - worktree 清理 via HostFsDelegate（跨平台 Windows/Linux/macOS）
  - per-worker provider/model 透传到 lease metadata（task-06）
---
