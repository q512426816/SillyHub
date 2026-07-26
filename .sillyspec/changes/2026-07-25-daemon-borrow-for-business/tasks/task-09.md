---
id: task-09
title: borrow lease 独立 sandbox 目录 + PolicyEngine 按 lease 隔离只读 policy
title_zh: daemon 侧借用任务沙箱隔离不污染开发代码
author: qinyi
created_at: 2026-07-25 21:50:26
priority: P0
depends_on: [task-06, task-08]
blocks: [task-10]
requirement_ids: [FR-05]
decision_ids: [D-007@v2]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/workspace.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
  - backend/app/modules/agent/placement.py
provides:
  - contract: BorrowSandbox
    fields: [sandbox_root_path, readonly_policy, borrowed_lease]
expects_from:
  task-06:
    - contract: BorrowedLeaseFlag
      needs: [borrowed, lender_user_id]
goal: >
  借用任务在 lender daemon 上用独立 sandbox 目录跑，写策略按 lease 隔离只读 root_path，不污染开发代码。
implementation:
  - backend placement 建借用 lease 时 rootPath = 独立 sandbox（复用 prepareWorkspace mirror by slug=borrow-<actor>-<run_id>，workspace.ts:118-160），塞进 lease metadata
  - daemon.ts:2723 用该 rootPath 作 cwd
  - session-manager.ts:1037-1102 PolicyEngine 按 lease（非 runtime）隔离写策略：borrow lease 的 allowed_roots 只读 root_path，不命中 lender 的 allowed_roots 缓存
  - 借用产出只走 submit_lease_messages 回传，不落 sandbox
acceptance:
  - 借用 agent cwd = 独立 sandbox 目录（borrow-<actor>-<run>）
  - 借用 agent 写 lender 代码区被 PolicyEngine 拒绝（写边界测试通过）
  - 开发人员自有任务不受影响（runtime 级 policy 不变）
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm test
  - 写边界单测（borrow lease 尝试写 lender allowed_roots 应被拒）
constraints:
  - 候选 B 主路径（D-007@v2：按 lease 隔离只读 policy），候选 A 独立 runtime_id 可选不阻塞（R-09）
  - 不复用 WorktreeLease（worktree/model.py:26-67 强依赖 change_id/task_id/repo_url，borrow 无这些）
  - 并发 max_concurrent_tasks=5 全 daemon 共享，借用占 lender 额度先不限制（R-03，审计可见）
---
