---
id: task-14
title: add-project-mission-api-client
title_zh: 新增项目维度会话前端API客户端
author: qinyi
created_at: 2026-08-19 10:50:00
priority: P1
depends_on: [task-07, task-13]
blocks: [task-15]
requirement_ids: [FR-07]
decision_ids: [D-005@v1]
allowed_paths:
  - frontend/src/lib/agent.ts
provides:
  - contract: project-mission-client
    fields: [createProjectMission, listProjectMissions]
expects_from:
  task-07:
    - contract: project-mission-endpoints
      needs: [POST_projects_pid_missions, GET_projects_pid_missions]
  task-13:
    - contract: openapi-types
      needs: [MissionCreateRequest_project_scope, MissionResponse_project_scope]
goal: >
  在 frontend/src/lib/agent.ts 新增 createProjectMission 与 listProjectMissions 两个 API 客户端函数，供项目维度会话页面调用（design §7.3）。
implementation:
  - 读取 lib/agent.ts 现有 createMission / listMissions 实现（:291-324）了解模式
  - 新增接口 CreateProjectMissionInput（复用 CreateMissionInput 加 anchor_workspace_id / scope_workspace_ids）
  - 新增函数 createProjectMission（projectId 路径参数 + input 请求体），调用 POST /api/projects/{projectId}/missions
  - 新增函数 listProjectMissions（projectId 路径参数 + 可选分页参数），调用 GET /api/projects/{projectId}/missions
  - 类型从 api-types.ts 导入（task-13 生成），不手写
  - 函数格式与现有 createMission 保持一致（apiFetch 泛型 + method "POST" / json）
acceptance:
  - createProjectMission 函数签名正确，projectId 作为路径参数，input 包含 objective / scope_workspace_ids / anchor_workspace_id
  - listProjectMissions 支持可选分页参数（limit / offset），返回 ProjectMissionResponse[]
  - pnpm exec tsc --noEmit 检查无类型错误
verify:
  - cd frontend && pnpm test --run agent（如果有单测）或 pnpm exec tsc --noEmit
constraints:
  - 必须在 task-13 之后执行，依赖类型定义
  - 不修改既有 createMission / listMissions，零回归
  - 参数命名与后端 schema 对齐（scope_workspace_ids 非 scopeWsIds）
---
