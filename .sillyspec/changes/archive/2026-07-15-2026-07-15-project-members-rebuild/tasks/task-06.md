---
id: task-06
title: "project.ts 新增 pageProjectMemberSummary(params) 客户端函数"
title_zh: 聚合接口前端 client
author: WhaleFall
created_at: 2026-07-15 11:05:37
priority: P0
depends_on: [task-05]
blocks: [task-07, task-08]
requirement_ids: [FR-01, FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/lib/ppm/project.ts
goal: 新增 client 函数命中聚合端点，返回 PageResp<ProjectMemberSummaryItem>。
implementation:
  - project.ts 新增 pageProjectMemberSummary(params?) → apiFetch<PageResp<ProjectMemberSummaryItem>>("/api/ppm/project-maintenance/member-summary", { query: params })
  - import ProjectMemberSummaryItem / ProjectMemberSummaryPageReq from ./types
  - 沿用现有 pageProjects 写法（query 透传）
acceptance:
  - pageProjectMemberSummary 导出
  - 命中 /api/ppm/project-maintenance/member-summary
  - query 透传；tsc 通过
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 沿用 apiFetch（自动 token + 401 刷新），禁止直接 fetch
  - 前缀 /api 由 next rewrite 转发，不拼 backend host
provides:
  - contract: pageProjectMemberSummary
    fields: [params, returns]
expects_from:
  task-05:
    - contract: ProjectMemberSummaryItem
      needs: [id, project_name, project_code, project_status, project_type, company_name, owner_name, member_count, updated_at]
    - contract: ProjectMemberSummaryPageReq
      needs: [project_name, project_status, project_type, owner_name, member_keyword, role_name]
---

# task-06 — 聚合接口前端 client

依据 design.md §7.4、project.ts 现有 pageProjects 写法。
