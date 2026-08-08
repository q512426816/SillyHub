---
id: task-07
title: 新增 test_mission_external_mode.py（external 闭环：create 无 orchestrator + converge 跳过 finalize/cleanup）
title_zh: mission external 模式闭环单测
author: qinyi
created_at: 2026-08-08 17:39:23
priority: P0
depends_on: [task-01, task-03, task-04]
blocks: []
requirement_ids: [FR-08, FR-09]
decision_ids: [D-003@v2, D-007@v1]
allowed_paths:
  - C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\agent\tests\test_mission_external_mode.py
provides:
  - contract: external mission 闭环契约（create 无 orchestrator + constraints 标记；converge 不 merge 不清）
expects_from:
  - task: task-01
    contract: team_mission_entry 支持 orchestration_mode="external"（跳过 orchestrator run/lease + constraints 存 mode + 返回 tuple[AgentMission, AgentRun|None]）
  - task: task-03
    contract: converge_mission_for_completed_run 检测 external → 跳过 finalize/cleanup
  - task: task-04
    contract: mcp_gateway/tools.py create_mission 加 orchestration_mode 透传 team_mission_entry
goal: >
  固化路径A external 两段闭环：create_mission(external) 不 spawn 僵尸 orchestrator 且 constraints 落 mode（AC-04/R-02）；
  worker 终态后 converge 跳过 finalize/cleanup 不污染 caller 主仓（AC-05/R-01 根解）。
implementation:
  - "AC-04 service 层（复刻 test_dispatch_worker_worktree.py 的 _make_workspace/_make_worker + db_session fixture，文件放 backend/app/modules/agent/tests/）：OrchestratorService(db_session).team_mission_entry(orchestration_mode=\"external\", workspace_id=ws.id, objective=\"o\", created_by=None, change_id=None, constraints=None, budget_usd=None, worker_preset=None, main_agent_config=None) → 返回 (mission, None)；mission.constraints=={\"orchestration_mode\":\"external\"}；select(AgentRun).where(mission_id=mission.id) 无 role=\"orchestrator\"。对照默认 team 调用返回 run.role==\"orchestrator\"（确认是分叉非回归）。"
  - "AC-04 mcp_gateway 入口（对齐 test_tools_new.py _make_ctx/_make_token，scope=[MCP_SCOPE_DISPATCH]）：tools.create_mission(objective=\"o\", orchestration_mode=\"external\", ctx=ctx) → result[\"main_run_id\"] is None 且 result[\"workers\")==[]；落库 mission.constraints 含 external。"
  - "AC-05 converge 跳过：seed external mission（constraints={\"orchestration_mode\":\"external\"}）+ 一条 completed worker run；monkeypatch FinalizerService 的 finalize_execute_mission/finalize_bootstrap_mission/cleanup_mission 为 AsyncMock spy；await converge_mission_for_completed_run(db_session, worker_run.id)；三 spy 均 assert_not_awaited()。对照 team mission → finalize_execute_mission assert_awaited_once（确认短路是分叉）。DI mock 走协作者 monkeypatch，不必造真 host_fs_delegate。"
acceptance:
  - create_mission(external) 返回 main_run 为 None + DB 无 orchestrator run + mission.constraints 含 external（AC-04）。
  - converge external mission 不触达 finalize_*/cleanup_mission（AC-05，R-01 防御①）。
  - team 模式对照：create 仍 spawn orchestrator、converge 仍 finalize（零回归）。
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_mission_external_mode.py -q --no-cov
  - cd backend && uv run pytest app/modules/agent -q --no-cov --deselect app/modules/agent/tests/test_dispatch_metadata.py::test_build_claim_payload_propagates_bundle_fields --deselect app/modules/agent/tests/test_execution_context.py::test_get_execution_context_task_run
constraints:
  - 只新增测试不改 src（task-01/03/04 已落实现）；红 = 实现缺陷回 src 不修测试（规则 11）。converge 用 FinalizerService 方法 monkeypatch spy 断言 not_awaited，勿真起 host_fs_delegate/git merge。
---
