---
id: task-09
title: "AgentRun.read_only 落记录 + dispatch_worker 流转 read_only 标志"
title_zh: "AgentRun.read_only 落记录 + dispatch_worker 流转 read_only 标志"
author: qinyi
created_at: 2026-08-06 13:58:18
priority: P1
depends_on:
  - task-01
blocks:
  - task-10
requirement_ids: [FR-06]
decision_ids: [D-005@v2]
allowed_paths:
  - backend/app/modules/agent/mcp_tools.py
  - backend/app/modules/agent/execution.py
provides: []
expects_from: {}
related_tests:
  - path: backend/app/modules/agent/tests/
    reason: dispatch_worker 加 read_only 落记录，既有 dispatch / mcp_tools 测试（test_mcp_tools.py / test_dispatch_worker_worktree.py）断言需同步
goal: >
  dispatch_worker endpoint 创建 AgentRun 时把 payload.read_only 写入 run.read_only，落 run 记
  录供前端/审计查询（design §5.2 P3 / §8.3）。read_only 向 daemon 流转 execution.py 已具备，本 task 补 run 记录持久化并确认链路，不改其他逻辑（绑 profile 归 task-10）。
implementation:
  - mcp_tools.py:317-326 AgentRun(...) 构造补 read_only=payload.read_only（task-01 已加 read_only 列，nullable bool，默认 False 对齐 DispatchWorkerRequest.read_only）
  - 确认 execution.py:145-152 dispatch_worker service 已收 read_only 形参并透传 dispatch_to_daemon(:241) + worker_tool_config(:242) + log(:266)，链路已通无需改；run.read_only 落记录在 endpoint 创建处，不在 service 回写
  - 不动治理门 / worktree / except 兜底 / mark_worker_run_failed / HostFsDelegate wiring 等其余逻辑
acceptance:
  - dispatch_worker 创建的 AgentRun 行 read_only == payload.read_only（默认 False）
  - 老运行行 read_only 为 NULL，derive_status / mission 收敛不受影响（nullable 兼容，design §9）
  - read_only=True 经 endpoint → execution → placement.dispatch_to_daemon → worker_tool_config 链路完整（端到端实测归 task-07/08）
verify:
  - cd backend && uv run pytest app/modules/agent -q --no-cov
constraints:
  - dispatch_worker 创建 AgentRun 时写 run.read_only=payload.read_only，仅此一处落记录
  - 不改 dispatch_worker 其他逻辑（治理门 / worktree / except 兜底 / delegate wiring 不动）
  - 绑 AgentProfile（agent_profile_id + agent_profile_snapshot）归 task-10，本 task 禁碰
  - G-3 串行：本 task 与 task-10 都改 mcp_tools.py 的 dispatch_worker，须先于 task-10 做完（read_only 落记录），task-10 depends_on 本 task，避免合并冲突
---
