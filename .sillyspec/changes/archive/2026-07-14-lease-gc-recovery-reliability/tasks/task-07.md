---
id: task-07
title: "failed retry endpoint + frontend retry button"
title_zh: "失败 run 重试端点 + 前端重试按钮"
author: qinyi
created_at: 2026-07-14 11:01:53
priority: P2
depends_on: [task-02]
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/agent/router.py
  - backend/app/modules/agent/service.py
  - backend/app/modules/agent/tests/
  - frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx
  - frontend/src/lib/agent.ts
goal: |
  为 failed/killed 的 AgentRun 提供用户主动重试入口：后端建全新 AgentRun 从头跑
  （attempt=1，同 change/stage/workspace 上下文，不继承产物/日志），前端在 failed/killed
  run 卡片显示"重试"按钮调该端点。落地 design §7.2 + §7.5 retry 行 + D-005@v1 契约。
implementation: |
  1. router.py 加 `POST /workspaces/{workspace_id}/agent/runs/{run_id}/retry`，
     response_model=AgentRunResponse，status_code=201，依赖 require_permission(TASK_RUN_AGENT)
     （与 kill 端点 router.py:347 同风格、同权限）。
  2. service.py 加 `retry_run(workspace_id, run_id, user_id) -> AgentRun` 方法：
     - get_run(run_id)，None → AgentRunNotFound；run.status 不在 {failed,killed} →
       AgentRunNotRunning 复用（details 带 status，前端可区分）。
     - 建新 AgentRun：id=uuid4，继承旧 run 的 change_id / task_id / agent_type /
       provider / model，status="pending"，**attempt=1**（旧 run.attempt 不递增、不读取，
       新 run 固定从 1 起，与 design §7.5 "attempt=1" 一致）。
     - 不继承：lease_id（新 run 暂无 lease，dispatch 阶段重新 acquire / interactive
       无 lease）、session_id（新会话从空起）、output/error_code/finished_at、
       AgentRunLog（旧 run 日志保留在旧行，新 run 零日志起步）。
     - AgentRunWorkspace M:N 关联：复用旧 run 的 workspace 集合（查旧 AgentRunWorkspace
       行同款 INSERT 到新 run.id），保证 retry 不丢 workspace 归属。
     - stage 类 run（task_id IS NULL、有 stage lease_meta）：retry 走 start_stage_dispatch
       等价路径——但为避免重写 dispatch，retry_run 内统一只建 run + 复制 workspace 关联，
       dispatch 复用 RunPlacementService.dispatch_to_daemon（与 start_run/start_stage_dispatch
       第 6 步同一入口），prompt/stage 从旧 run 的活跃 lease.metadata 读（参考 _fetch_active_lease_meta）。
  3. 旧 lease 残留无影响：旧 run 的 lease（cancelled/expired）不绑新 run（worktree GC 按
     agent_run_id 关联，task-04 落地后新 lease.agent_run_id 指向新 run；旧 lease 指向旧 run
     终态，各自独立，design §7.5 retry 行 + Grill P2-2）。
  4. 前端 agent.ts 加 retryAgentRun(workspaceId, runId)（仿 killAgentRun agent.ts:156，
     POST .../retry）；agent/page.tsx 在 run.status∈{failed,killed} 时显示"重试"按钮
     （仿 terminate 按钮 page.tsx:675 区块，variant=outline/default，点击调 retryAgentRun
     后 invalidate agent runs query 刷新列表，新 run 出现在 active 区）。
  5. 守护测试（backend/app/modules/agent/tests/）：failed run retry 建 new run（新 id、
     attempt=1、同 change_id、新 run 无日志行）；running/completed run retry 抛
     AgentRunNotRunning；旧 lease 残留行不影响新 run dispatch；前端测试 status=failed
     渲染重试按钮、点击调 retryAgentRun。
acceptance:
  - 仅 run.status∈{failed,killed} 可 retry；其他状态（pending/running/completed）返回 409/400 AgentRunNotRunning。
  - retry 建**新** AgentRun（新 id，不修改旧 run），attempt=1，继承 change_id/task_id/workspace 归属/agent_type/provider/model。
  - 新 run 不继承旧 run 的 session_id/lease_id/日志行/产物（AgentRunLog 旧行仍在旧 run_id 下，新 run 零日志起步）。
  - 旧 run 的 lease 残留（cancelled/expired）对新 run dispatch 零影响（不读旧 lease、不冲突）。
  - 前端 failed/killed run 卡片显示"重试"按钮；点击后新 run 出现、旧 run 保持终态。
  - 重复调 retry 建多个新 run（不做幂等去重，design §9 + D-005 用户主动行为）。
verify:
  - backend pytest：test_retry_creates_new_run / test_retry_rejects_non_terminal / test_retry_does_not_inherit_logs / test_retry_old_lease_no_interference 全绿。
  - frontend vitest：failed run 渲染重试按钮、点击调 retryAgentRun、刷新 query。
  - 手动/集成：failed run → 点重试 → 新 run pending→running→completed，旧 run 仍 failed（task-09 全量回归覆盖）。
constraints:
  - 不保进度（D-005@v1）：backend 不改 complete_lease 产物落盘，retry = 从头跑靠 sillyspec 工具幂等（design §3 非目标）。
  - 不做幂等去重：重复 retry 建多个 run（用户主动行为，design §9）。
  - 不碰 cancel 链路（D-001@v1 已由 ql-20260712-001 具备）。
  - attempt 固定从 1 起（新 run 不读旧 run.attempt 递增），与 design §7.5 契约一致。
  - 仅 P2 可用性增量，不改 lease GC / worktree GC / 心跳窗口（属 task-02~06）。
---
