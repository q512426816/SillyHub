---
id: task-11
title: finalizer-merge-group-by-workspace
title_zh: 收敛 merge 按工作区分组
author: qinyi
created_at: 2026-08-19 10:50:00
priority: P0
depends_on: [task-01, task-04]
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-003@v1, D-011@v1]
allowed_paths:
  - backend/app/modules/agent/finalizer.py
  - backend/app/modules/agent/tests/test_finalizer.py
  - backend/app/modules/agent/tests/test_finalize_execute_mission_merge.py
provides:
  - contract: finalizer_merge_grouping
    fields: [target_workspace_id, workspace_grouping]
expects_from:
  task-01:
    - contract: AgentRun
      needs: [target_workspace_id]
  task-04:
    - contract: dispatch_worker
      needs: [target_workspace_id]
goal: >
  finalize_execute_mission 按 target_workspace_id 分组 merge，
  冲突按组独立（A 工作区冲突不挡 B 工作区合并）。
implementation:
  - finalize_execute_mission 的 branch 查询改为取
    (run.target_workspace_id, run.worktree_branch) 二元组
    （target_workspace_id 为 NULL 时用 mission.workspace_id 回退）
  - 新增按 target_workspace_id 分组逻辑：defaultdict(list) 收集同 ws 的 branches
  - 对每个 target_workspace_id 分支：resolve Workspace → 逐个 git_merge(ws, branch)
  - HostFsDelegate._via_rpc 自动按 workspace→daemon 路由（现有机制零改动）
  - 冲突收集按组独立：pending_conflicts 扩展携带 target_workspace_id 字段
  - 新增 pytest 测试用例覆盖多工作区 merge + 冲突分组独立场景
acceptance:
  - 单 workspace mission（target 全为 anchor）行为零回归
  - 多 workspace mission 按各自 target_workspace_id 分组 merge
  - A 工作区冲突不挡 B 工作区合并（分支独立处理）
  - pending_conflicts 携带 target_workspace_id 信息供前端展示
  - HostFsDelegate RPC 正确路由到各工作区对应的 daemon
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_finalizer.py app/modules/agent/tests/test_finalize_execute_mission_merge.py -q --no-cov
constraints:
  - target_workspace_id 为 NULL 的 run 必须回退到 mission.workspace_id
  - 单 workspace 场景必须零回归（分组逻辑等价于原单路径）
  - 冲突不得跨工作区传播（每组独立 git_merge）
  - Workspace resolve 失败时必须 log 跳过该组，不崩其它组

---
