---
id: task-15
title: build-project-mission-ui-page
title_zh: 构建项目维度会话前端页面
author: qinyi
created_at: 2026-08-19 10:50:00
priority: P1
depends_on: [task-07, task-13, task-14]
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-005@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/projects/[id]/missions/page.tsx
  - frontend/src/components/mission-console.tsx
  - frontend/src/lib/workspace-types.ts
provides:
  - contract: project-mission-ui
    fields: [scope_selector, anchor_selector, worker_target_badge]
expects_from:
  task-13:
    - contract: openapi-types
      needs: [MissionResponse_project_scope]
  task-14:
    - contract: project-mission-client
      needs: [createProjectMission, listProjectMissions]
goal: >
  新增前端项目维度会话页面 /projects/[id]/missions，包含发起表单（anchor 单选 + scope 多选）与 MissionConsole 扩展（worker 目标工作区徽标列），实现项目视角的团队会话入口（design §7.3）。
implementation:
  - 新建 page.tsx：读取 project_id 从 URL，调用 listProjectMissions 加载历史列表
  - 发起表单复用 MissionConsole 逻辑（objective / worker_preset / main_agent_config），新增：
    - anchor 单选框：scope 内工作区列表，默认 type=backend 优先否则第一个，显示 type 徽标
    - scope 多选框：从 ppm_project_workspace 关联的工作区集合加载，显示 type / description / 机器在线状态
    - 表单提交调用 createProjectMission（projectId / input）
  - 扩展 MissionConsole 组件：props 接收 projectMode 标记，worker 行新增目标工作区徽标列（复用 WorkspaceRoleTypeBadge 组件显示 type 词表徽标）
  - 列表展示：复用 MissionSummaryCard，显示 anchor / scope 概要
acceptance:
  - 页面可正常访问（/projects/{id}/missions），历史列表加载成功
  - 发起表单 anchor 单选与 scope 多选交互正常，scope 越界由后端 422 拦截
  - MissionConsole worker 行显示目标工作区徽标（type 徽标样式与 workspace-role-type 一致）
  - vitest 测试通过（如页面组件有单测）
verify:
  - cd frontend && pnpm test --run missions（如有相关测试）
  - pnpm exec tsc --noEmit（类型检查）
constraints:
  - scope 数据来源：需要前端调用 PPM 项目关联工作区列表端点（可能需新增 GET /api/projects/{id}/workspaces 或从现有项目详情展开）
  - 机器在线状态：可选优化，可通过 workspace_member_runtimes 聚合 daemon 最近心跳时间判定
  - 与 task-12 无文件交集，可并行
---
