---
id: task-03
title: execution.dispatch_worker 接 worktree（算 sibling 路径 + git_worktree_add + 副本作 root_path + 填 worktree_branch）+ 单测
title_zh: dispatch_worker 接 per-worker worktree + 单测
author: qinyi
created_at: 2026-07-13 00:32:41
priority: P0
depends_on: [task-01]
blocks: [task-05, task-08]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/agent/execution.py
  - backend/app/modules/agent/tests/test_dispatch_worker_worktree.py
provides:
  - contract: AgentRunWorktreeBranch
    fields: [worktree_branch]
expects_from:
  task-01:
    - contract: HostFsDelegateWorktreeMethods
      needs: [git_worktree_add]
goal: >
  dispatch_worker 接 worktree——创建 per-worker sibling 副本 + 把副本路径作 root_path 传 dispatch_to_daemon（worker cwd=副本）+ 填 AgentRun.worktree_branch，让 worker 在独立副本工作。
implementation:
  - 读 execution.py dispatch_worker(:88) + resolve_root_path_for_daemon + placement.dispatch_to_daemon(:149)
  - 算 sibling_path = dirname(ws_root) + "/<basename(ws_root)>-workers/" + str(run.id)[:8]，branch = "workers/" + str(run.id)[:8]，base_ref = ws.default_branch or "HEAD"（X-001 兜底）
  - 调 delegate.git_worktree_add(ws, sibling_path, branch, base_ref)；ok=False → worker run status=failed，return（不抛，主 agent 决策补派）
  - ok=True → sibling_path 作 root_path 传 dispatch_to_daemon（替代 ws.root_path）+ 填 run.worktree_branch=branch + commit
  - 单测覆盖：正常创建 + base_ref 空 + git_worktree_add 失败 run 标 failed
acceptance:
  - worker dispatch 后 root_path=sibling（cwd=副本），worktree_branch 填值
  - ws.default_branch 空 → base_ref 兜底 "HEAD"
  - git_worktree_add 失败 → worker run failed 不崩 mission
  - mypy + ruff 绿
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_dispatch_worker_worktree.py -q
  - cd backend && uv run mypy app/modules/agent/execution.py
constraints:
  - single mode mission 零回归（dispatch_worker 仅 team 调用）
  - sibling 路径用宿主机原生（resolve_root_path_for_daemon 模式，跨平台）
  - 不改 placement.dispatch_to_daemon 签名（仅改传入的 root_path 值）
---
