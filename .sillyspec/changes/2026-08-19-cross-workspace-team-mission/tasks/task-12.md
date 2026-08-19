---
id: task-12
title: group-cleanup-by-target-workspace
title_zh: 按目标工作区分组清理worktree副本
author: qinyi
created_at: 2026-08-19 10:50:00
priority: P0
depends_on: [task-01, task-11]
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-003@v1, D-011@v1]
allowed_paths:
  - backend/app/modules/agent/finalizer.py
  - backend/app/modules/agent/tests/test_finalizer.py
provides:
  - contract: cleanup-grouping
    fields: [group_by_target_workspace]
expects_from:
  task-01:
    - contract: AgentRun
      needs: [target_workspace_id]
  task-11:
    - contract: finalizer_merge_grouping
      needs: [workspace_grouping]
goal: >
  cleanup_mission 方法按 target_workspace_id 分组删除 worktree 副本，确保 RPC 发到各目标机器而非锚定机器，防止跨工作区派发时副本残留（design §4.3 / B-02 修复）。
implementation:
  - 读取 finalizer.py cleanup_mission 现有实现（:348-467），理解当前单 workspace 路径
  - 修改 worker 查询：join AgentRun 时增加 run.target_workspace_id 分组键，或从 run 对象直接取
  - 按 target_workspace_id 分组 worker_runs：每个唯一 target_workspace_id 一组
  - 迭代各组，resolve target_ws = Workspace.get(target_workspace_id)
  - 调 delegate.git_worktree_remove(ws=target_ws, sibling_path=...)，通过 HostFsDelegate._via_rpc 自动路由到目标 daemon
  - 单元测试覆盖：两 worker 分属不同 target_ws，mock delegate 断言 git_worktree_remove 各被调用一次且 workspace 参数正确；单 ws mission 仍正确清理
acceptance:
  - 单元测试通过：跨 ws cleanup 按 target 分组调用 git_worktree_remove，workspace 参数与 target_workspace_id 一致
  - 单 ws mission（target 均为 anchor）行为不变，清理成功
  - 异常处理：target_ws resolve 失败跳过该组，不中断其他组清理（best-effort）
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_finalizer.py -k cleanup -v
constraints:
  - 与 task-11 同改 finalizer.py 须分 Wave 串行，避免 postcheck 文件冲突
  - sibling_path 计算公式须与 task-03 dispatch_worker 一致（base_root/.worktrees/{run_id[:8]}）
  - workspace.root_path 为 None 时跳过该组，不抛异常
---
