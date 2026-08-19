---
id: task-06
title: add-project-context-to-orchestrator
title_zh: 向 orchestrator 注入项目上下文
author: qinyi
created_at: 2026-08-19 10:50:00
priority: P0
depends_on: [task-05]
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-004@v2]
allowed_paths:
  - backend/app/modules/agent/orchestrator.py
  - backend/app/modules/agent/tests/test_orchestrator_project_context.py
  - backend/app/modules/agent/tests/test_orchestrator.py
provides:
  - contract: team_mission_entry
    fields: [scope_workspace_ids]
  - contract: render_orchestrator_prompt
    fields: [project_context]
expects_from:
  task-05:
    - contract: MissionCreateRequest
      needs: [scope_workspace_ids]
goal: >
  orchestrator.py team_mission_entry 接收 scope 形参，render_orchestrator_prompt 注入项目名与 scope 清单到主 agent prompt。
implementation:
  - team_mission_entry 新增 scope_workspace_ids 形参（list[uuid.UUID] | None，缺省 None）
  - scope 传入创建 AgentMission 时写入 scope_workspace_ids JSON 列
  - render_orchestrator_prompt 查询 project_id 关联的项目名
  - prompt 注入项目名(PpmProjectMaintenance.name)
  - prompt 注入 scope 清单(id / name / type / description / daemon 在线状态)
  - prompt 补充 dispatch_worker 的 target_workspace_id 参数用法说明
acceptance:
  - team_mission_entry 可接收 scope 列表
  - AgentMission.scope_workspace_ids 正确写入 JSON
  - prompt 含项目名字段
  - prompt 含 scope 清单(含 type 徽标语义)
  - prompt 含 target 用法说明(按任务性质选工作区)
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_orchestrator_project_context.py -q --no-cov
constraints:
  - scope_workspace_ids 缺省为 None 时等同单 workspace(零回归)
  - 不改主 agent 派发路由(维持 borrow 兜底，B-04 选项 a)
  - project_id 为 None 时不查项目名(跳过查询)
  - prompt 改动仅增量注入(不破坏既有 prompt 结构)

---
