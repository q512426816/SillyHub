---
id: task-03
title: 'session team-mission trigger and list endpoints'
title_zh: '会话团队触发/列表端点——POST/GET /daemon/sessions/{id}/team-mission(s) + DTO + 409 + scope 冻结 + objective 占位'
author: 'qinyi'
created_at: 2026-08-22 03:35:53
priority: P0
depends_on: [task-01]
blocks: [task-05, task-11, task-12]
requirement_ids: [FR-03]
decision_ids: [D-004@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/agent/orchestrator.py
  - backend/app/modules/daemon/tests/test_session_team_mission.py
provides:
  - contract: TeamMissionTriggerRequest
    fields: [objective, scope_workspace_ids, project_id, budget_usd, worker_preset, main_agent_config]
    note: daemon/schema.py 请求 DTO（design §7）——objective/scope 可空；scope None=会话绑定工作区，会话无工作区且未传→422；worker_preset/main_agent_config 沿用 mission_schema.py:30-37 既有形态与上限；前端 task-11 触发弹层消费
  - contract: TeamMissionSummary
    fields: [mission_id, status, objective, scope_workspace_ids, budget_usd, workers]
    note: 响应 DTO——status 为扩展后 derive_status 派生值（含 awaiting_input）；workers 仅 role!=orchestrator 分身 run 概要（run_id/role/status/objective 小 DTO 同文件定义）；前端 task-12 TeamTaskBlock 与收敛链消费
  - contract: SESSION_OBJECTIVE_PLACEHOLDER
    fields: [SESSION_OBJECTIVE_PLACEHOLDER]
    note: agent/orchestrator.py 模块级常量=「（由会话首条团队指令定义）」（design §8 占位文案）；task-04 inject 首条回填检测 import 此常量，勿重复定义；POST/GET /api/daemon/sessions/{session_id}/team-mission(s) 两端点（活跃冲突 409）同为本卡产出，task-05 懒建复用同活跃判定语义
expects_from:
  task-02:
    - contract: get_active_mission_for_session
      needs: [session_id]
goal: >
  新增会话团队触发/列表端点（design §5 Phase 1 / §7）——预建 mission（scope 冻结快照+
  objective 空落占位）、活跃冲突 409（R-07）、项目维度校验复用，作为前端触发弹层与
  TeamTaskBlock 的数据源。
implementation:
  - 'daemon/schema.py 新增 TeamMissionTriggerRequest / TeamMissionSummary（design §7 字段全集）+ workers 分身概要小 DTO'
  - 'agent/orchestrator.py team_mission_entry 加预建路径——新参 session_id + 预建模式；不建主控 AgentRun、不派 daemon lease、不调 render_orchestrator_prompt；objective 空落 SESSION_OBJECTIVE_PLACEHOLDER；scope_workspace_ids/project_id/budget_usd/worker_preset/main_agent_config 冻结落库；既有 team/external 两模式行为不动（旧端点 task-13 才删）'
  - 'daemon/router.py POST /sessions/{session_id}/team-mission——会话归属校验（跨用户 404，同 get_session_detail 口径）；调 get_active_mission_for_session 判活跃→409（R-07）；scope 解析——未传取 session.workspace_id，会话无工作区且未传→422'
  - 'project_id 维度校验复用——同口径调 ppm.common.data_scope（is_super_admin / manager_project_ids，非项目经理 403）+ workspace link_service.list_by_project（scope 越界 422）+ anchor 缺省规则（scope 内 backend-code 优先否则第一个，对齐 agent/router.py:1295-1309）'
  - 'GET /sessions/{session_id}/team-missions——按 mission.session_id 查会话全部 mission 倒序 + MissionControlService.worker_runs（过滤 role!=orchestrator）→ list[TeamMissionSummary]，status 用扩展后 derive_status（会话维度入参）'
  - '新建 tests/test_session_team_mission.py——预建落库断言（scope 冻结 / objective 占位 / session_id 列 / 无主控 run 与 lease）；活跃冲突 409 + 终态后可再建；无 scope 无工作区 422；非项目经理 403 + scope 越界 422；列表 workers 不含 orchestrator run'
acceptance:
  - 预建端点落库——scope_workspace_ids/project_id 冻结快照、objective 空落占位、不建主控 run/lease
  - 会话已有活跃 mission（未终态）再次预建返回 409；已终态后可再建
  - 项目维度校验复用——仅项目经理（或超管）可建项目维度 mission、scope⊆项目关联工作区越界 422
  - 列表端点返回会话 mission+分身概要——workers 不含 orchestrator run
  - 会话无工作区且未传 scope_workspace_ids 返回 422
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_team_mission.py -v
  - cd backend && uv run pytest app/modules/agent app/modules/daemon -q --no-cov --deselect app/modules/agent/tests/test_dispatch_metadata.py::test_build_claim_payload_propagates_bundle_fields --deselect app/modules/agent/tests/test_execution_context.py::test_get_execution_context_task_run
  - cd backend && uv run ruff check app/modules/daemon/router.py app/modules/daemon/schema.py app/modules/agent/orchestrator.py
constraints:
  - 三卡路径不重叠——本卡只动 daemon/router.py + daemon/schema.py + agent/orchestrator.py + 新测试；不动 mission.py（task-02）与 session/service.py（task-04）
  - 旧 POST /workspaces|projects/{id}/missions 端点与 team/external 模式零改动（删除归 task-13）；render_orchestrator_prompt 本卡不删（存量链路仍用）
  - 不做懒建 / inject 双标记 / converge 改造（task-04/05/06 范围）；DTO 不加 anchor_workspace_id（anchor 服务端按 scope 派生）；前端 gen:types 归 task-14
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
