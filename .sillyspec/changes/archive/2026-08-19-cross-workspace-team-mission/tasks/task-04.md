---
id: task-04
title: add-target-workspace-dispatch-routing
title_zh: 添加目标工作区派发路由
author: qinyi
created_at: 2026-08-19 10:50:00
priority: P0
depends_on: [task-01, task-03]
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-001@v2]
allowed_paths:
  - backend/app/modules/agent/execution.py
  - backend/app/modules/agent/tests/test_execution_target_routing.py
provides:
  - contract: dispatch_worker
    fields: [target_workspace_id]
expects_from:
  task-01:
    - contract: AgentRun
      needs: [target_workspace_id]
  task-03:
    - contract: _resolve_dispatch_runtime
      needs: [representative_fallback]
goal: >
  execution.py dispatch_worker 接收 target_workspace_id 参数，按目标工作区路由 worktree / provider / placement。
implementation:
  - dispatch_worker 新增 target_workspace_id 形参（uuid.UUID | None，缺省 None）
  - effective_target = target_workspace_id or anchor_workspace_id(回退逻辑)
  - worktree 路径按 effective_target 解析 workspace(而非 anchor)
  - provider / model 查询按 effective_target workspace 的 default_agent
  - placement.dispatch_to_daemon 调 _resolve_dispatch_runtime 时传 representative_fallback=(target!=anchor)
acceptance:
  - target_workspace_id 为 None 时等同于单 workspace(零回归)
  - target_workspace_id 非空时 worktree 落目标 workspace root
  - provider / model 取目标 workspace 的配置
  - target 异于 anchor 时 representative_fallback=True 传 placement
  - target 等于 anchor 时 representative_fallback=False(维持 borrow)
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_execution_target_routing.py -q --no-cov
constraints:
  - worktree 路径必须用 target workspace root(不是 anchor)
  - effective_target 贯穿 worktree / provider / placement 三段
  - 不改 dispatch_worker 签名以外部分(零回归单 ws)
  - target 越界校验由上层 mcp_tools/ router 完成(本 task 不管)

---
