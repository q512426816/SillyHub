---
id: task-02
title: 'backend worker 自动重派（prepare_interactive_dispatch 复用原会话+双表上下文重建+prompt 重渲染+resume 注入+attempt>=3 节流+三互斥守卫）（depends_on: task-01）'
title_zh: 'backend worker 自动重派（prepare_interactive_dispatch 复用原会话+双表上下文重建+prompt 重渲染+resume 注入+attempt>=3 节流+三互斥守卫）（depends_on: task-01）'
author: 'qinyi'
created_at: 2026-08-29 21:15:48
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-001@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/agent/worker_redispatch.py
  - backend/app/modules/agent/placement.py
  - backend/app/modules/agent/patrol.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/sweep.py
  - backend/app/modules/daemon/tests/test_worker_redispatch.py
goal: worker 子会话被 daemon 掉线中断（task-01 标 failed+error_code=daemon_interrupted）后自动重派继承原会话——复用原 session 行经 prepare_interactive_dispatch 重建 interactive lease+新首 run 并注入 resume_session_id 续 SDK 上下文，含节流与三互斥守卫，消除 mission 卡等 24h GC。
implementation:
  - 新增独立文件 worker_redispatch.py（防 mcp_tools.py 2600 行膨胀）写重派函数——原 session 行翻回 active+清 ended_at+turn_count 归位；双表上下文重建取 session 行 provider/cwd/tree_depth/agent_profile_id 与首 run 行 model/objective/role/read_only/mission_id/worktree_branch/agent_profile_snapshot
  - prompt 按 first_run.objective+role 重渲染 build_worker_briefing（mission_context.py:166），tool_config 用 worker_tool_config(first_run.read_only)（execution.py:92），role+tool_config 经 _merge_lease_metadata 补 lease metadata（对齐 mcp_tools.py:1311-1393 派发先例）
  - resume_session_id 取 AgentSession.agent_session_id，NULL 回退该会话最新 AgentRun.session_id（model.py:262，照 _heal_agent_session_id_from_runs 逻辑 service.py:5212）
  - placement.py prepare_interactive_dispatch（:645）加 resume_session_id 可选形参写 lease metadata（写法对齐 dispatch_to_daemon:456-457）；重派经它建新 lease+新首 run，commit 后 notify_interactive_dispatch（placement.py:1084）唤醒 daemon
  - 三互斥守卫——前置检查 mission.converged_at/cancelled_at（对齐 patrol.py:750-751）；patrol.py 职责④候选（:726-736）排除 error_code=daemon_interrupted 防旧 run 翻回 pending 与新 run 双跑；重派限职责⑦ 30min worker_force_end 宽限窗内完成（_worker_force_end_grace_minutes:138 单向置位无清除）
  - 节流与触发——计数锚为该 session 名下 kind=interactive 历史 lease 行数（metadata.session_id 锚定 placement.py:821）>=3 不再重派留 failed 终态；suspend_sessions_for_daemon（service.py:4708）与 session_offline_sweep_once 事务提交后异步 fire 消费 task-01 返回 worker 列表，失败记日志下轮 sweep（60s 周期）重试
acceptance:
  - 掉线 worker 自动重派——原 session 行翻回 active，新 pending interactive lease+新首 run 挂原会话，lease metadata 含 resume_session_id 与重渲染 prompt（test_worker_redispatch.py 断言）
  - 三守卫与节流各有用例——converged/cancelled mission 不重派；patrol 职责④不捞 error_code=daemon_interrupted 的 run；超 30min 宽限窗不重派；同 session 第 4 次重派被 >=3 上限拒绝留 failed 终态
  - suspend/sweep 挂起主路径零阻塞零回归——异步 fire 失败仅记日志下轮 sweep 自愈，既有 agent/daemon 模块用例全绿
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_worker_redispatch.py app/modules/agent -q --no-cov -n auto && uv run ruff check app/modules/agent app/modules/daemon && uv run mypy app
provides:
  - contract: worker_redispatch
    fields: [redispatch_worker_session]
constraints:
  - 不改主会话（parent_session_id 为 NULL）挂起/恢复语义，不动 batch dispatch_to_daemon 路径与 lease 过期 GC；worktree 一致性走既有 dispatch 上下文重建，不做 GC 兜底与 poison 黑名单（非目标）
  - 重派函数不进 mcp_tools.py（防 2600 行膨胀）；test_worker_redispatch.py 与 task-01 共写但 W2 分波落地不冲突；仅跑本变更相关测试不全量（CLAUDE.md 规则 0）
expects_from:
  task-01:
    - contract: WorkerSuspendSplit
      needs: [worker_sessions_failed, daemon_interrupted_error_code]
---
