---
id: task-05
title: "types.ts 新增 ProjectMemberSummaryItem / ProjectMemberSummaryPageReq，ProjectMember 加可选 username"
title_zh: 前端类型对齐后端聚合 DTO + 成员补账号
author: WhaleFall
created_at: 2026-07-15 11:05:37
priority: P0
depends_on: [task-01]
blocks: [task-06, task-07]
requirement_ids: [FR-04]
decision_ids: [D-004@v1]
allowed_paths:
  - frontend/src/lib/ppm/types.ts
goal: 前端类型对齐后端聚合 DTO 与成员账号字段，供 client 与组件消费。
implementation:
  - types.ts 新增 ProjectMemberSummaryItem（9 字段，对齐后端）+ ProjectMemberSummaryPageReq extends PageReq（6 筛选字段）
  - ProjectMember 加 username?: string | null
  - nullable 用 T | null 沿用本文件约定
acceptance:
  - 两个新 interface 导出
  - ProjectMember 多可选 username
  - tsc 通过
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 可选字段向后兼容
  - 沿用 types.ts 的 T | null 约定
provides:
  - contract: ProjectMemberSummaryItem
    fields: [id, project_name, project_code, project_status, project_type, company_name, owner_name, member_count, updated_at]
  - contract: ProjectMemberSummaryPageReq
    fields: [page, page_size, order_by, order, project_name, project_status, project_type, owner_name, member_keyword, role_name]
  - contract: ProjectMember
    fields: [id, pm_project_id, user_id, user_name, username, phone, depart_name, role_name, created_at]
expects_from:
  task-01:
    - contract: ProjectMemberSummaryItem
      needs: [id, project_name, project_code, project_status, project_type, company_name, owner_name, member_count, updated_at]
    - contract: ProjectMemberSummaryPageReq
      needs: [page, page_size, order_by, order, project_name, project_status, project_type, owner_name, member_keyword, role_name]
---

# task-05 — 前端类型对齐聚合 DTO + 成员补账号

依据 design.md §7.4。provides 的 ProjectMember 含 username，供 task-07（子表账号列）消费。
