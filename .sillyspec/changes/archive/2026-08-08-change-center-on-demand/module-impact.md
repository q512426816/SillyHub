---
author: qinyi
created_at: 2026-08-09T04:30:00
change: 2026-08-08-change-center-on-demand
---

# 模块影响分析（Module Impact）— 变更中心重状态机减负（形态A）

## 变更摘要

砍掉后端 `auto_dispatch_next_step` 自动连轴编排 + 脆弱的 sillyspec.db RPC 状态同步 + gate 硬阻塞，保留 SillySpec 阶段流程（brainstorm→plan→execute→verify→archive）+ 文档产出 + gate 核验价值，改为 MCP/HTTP 按需触发 change 阶层。

## 受影响模块

### backend / change（核心改造）
- **dispatch.py**：删 `auto_dispatch_next_step`（:240 ~330 行）整函数；剥离 `reconcile_stale_runs`（:589）的推进调用（保留 stale run 清理）；保留 `dispatch`/`dispatch_next_step`/`_dispatch_execute_team`/`_run_gate_via_delegate`（RPC 骨架，供 run_verify_gate 复用）。
- **service.py**：`complete_stage`/`transition_with_dispatch` 保留（按需触发用），complete_stage 成为 team 收敛桥（推进 current_stage 不 dispatch）。
- **router.py**：新增 `POST /changes/{id}/advance-stage` + `POST /changes/{id}/run-verify-gate`（前端走 HTTP）。
- **schema.py**：新增 `VerifyGateResponse` DTO（exit_code/errors/source 三态）。
- 行为变化：stage 完成**停待触发态**，由显式 advance（MCP tool / HTTP）推进，不再自动连轴。

### backend / daemon（6 调用点改造）
- **run_sync/service.py**：`_run_gate_decision_task`（:1262）只存 gate_result + gate_status pending→decided + 发 gate_status_changed SSE（删 sync_stage_status + auto_dispatch 块）；`_trigger_stage_completion_callback`（single）只 sync + 发 completed_pending_trigger SSE；`_advance_team_stage`（:1697）保留 merge_gate_results + complete_stage 桥，删 dispatch。
- **lease/service.py + service.py**：facade/lease callback 改轻（留痕 + SSE），`converge_mission_for_completed_run` 完全保留。
- **reconcile_stale_runs**：保留 stale run 清理（释放 has_active_run），不再恢复推进。

### backend / mcp_gateway（新增 change 阶层 tool）
- **tools.py**：8→12 tool。新增 4 change 阶层 tool：`advance_change_stage`（dispatch scope，包装 transition_with_dispatch，team 分流 _dispatch_execute_team）、`submit_stage_review`（dispatch，路由 proposal/plan/human_test/archive_confirm）、`run_verify_gate`（read，三态 gate_result/gate_cmd/unavailable 不硬阻塞）、`get_change_stage`（read，替代 sillyspec.db 自动同步）。

### frontend（按需触发 + 审核链路收敛）
- **lib/changes.ts**：新增 `advanceChangeStage`/`runVerifyGate`/`submitStageReview` 客户端方法。
- **changes/[cid]/page.tsx**：handleDispatch（保留调 triggerDispatch 重派当前阶段）+ 新增 handleAdvance/handleRunVerifyGate 接 HTTP + 「完成待触发」推进横幅；审核链路收敛到 submitStageReview（旧 approval_status/submitReview 退役只读保留）。
- **api-types.ts**：gen:types 重生成（含 VerifyGateResponse + 2 端点）。

## 不受影响（明确边界）

- AgentRun/AgentMission 模型、OrchestratorService.schedule_loop、converge_mission_for_completed_run、placement.py、dispatch-worker（2026-08-08-dispatch-worker-caller-worktree，已上线执行层 MCP 派活）。
- PPM 模块（已上线，零影响）。

## 跨模块数据流变化

- **旧**：stage 完成 → auto_dispatch_next_step → 经 daemon-client RPC 读宿主机 sillyspec.db 同步阶段 → 自动派发下一 stage（任一环断 synced=False / gate 未发版 exit 2 永久 gate_blocked）。
- **新**：stage 完成 → 停待触发态 + SSE 通知前端 → 人/MCP 显式调 advance_change_stage 或 POST /advance-stage → transition_with_dispatch → dispatch_next_step（single/team 分流）。gate 由 run_verify_gate 软调用（三态）交决策，不硬阻塞。sillyspec.db 同步废弃（改 get_change_stage 按需读 projection）。

## 决策落点

D-001（砍 auto_dispatch）/ D-002（sillyspec.db 同步废弃）/ D-003（gate 软调用不硬阻塞）/ D-004（MCP tool 包装现有方法）/ D-005（HTTP 端点前端入口）/ D-006（team complete_stage 桥）/ D-007（reconcile 剥离推进）/ D-008（删 verify-result.md fallback）。R-01~07 应对详见 design.md §9。

## 测试影响

- 改写：test_auto_dispatch_gate / test_gate_retry / test_run_sync_gate_decision_task / test_team_change_lifecycle（按需触发语义）。
- 新增：test_advance_team_stage / test_change_stage_tools。
- 删除：backend/tests/ legacy 4 文件（test_auto_dispatch / test_dispatch_chain / test_e2e_stage_dispatch / test_gate_e2e，被 app/modules/*/tests/ 新版本替代）。
- 零回归：daemon 687 / change 198 / mcp_gateway 91 passed；全 testpaths 3628 collected 0 错误。
