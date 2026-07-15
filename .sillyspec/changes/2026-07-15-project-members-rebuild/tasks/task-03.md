---
id: task-03
title: "router.py 新增 GET /project-maintenance/member-summary 端点"
title_zh: 暴露项目成员聚合接口
author: WhaleFall
created_at: 2026-07-15 11:05:37
priority: P0
depends_on: [task-02]
blocks: [task-04, task-06]
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/ppm/project/router.py
goal: 暴露聚合端点，复用现有鉴权与 Page 信封。
implementation:
  - 在 router.py 新增 GET /project-maintenance/member-summary，声明在 /{entity_id} GET 之前（路径优先级约定见 router.py:134）
  - Query 参数 page/page_size/order_by/order + 6 筛选；复用 _PROJECT_READ 鉴权
  - 构造 ProjectMemberSummaryPageReq，调 svc.ProjectMaintenanceService(session).member_summary(req)，返回 Page.build
acceptance:
  - GET /api/ppm/project-maintenance/member-summary 可用，参数齐全
  - 返回 Page[ProjectMemberSummaryItem]
  - 声明顺序正确（在 /{entity_id} 之前，避免被当 entity_id 解析 422）
verify:
  - cd backend && ruff check app/modules/ppm/project/router.py
constraints:
  - 遵循 router.py 路径声明顺序约定（具体路径在 {entity_id} 前）
  - 复用 _PROJECT_READ 鉴权与 Page 信封；本任务不写测试
expects_from:
  task-01:
    - contract: ProjectMemberSummaryItem
      needs: [id, project_name, project_code, project_status, project_type, company_name, owner_name, member_count, updated_at]
    - contract: ProjectMemberSummaryPageReq
      needs: [page, page_size, order_by, order, project_name, project_status, project_type, owner_name, member_keyword, role_name]
---

# task-03 — 暴露项目成员聚合接口

依据 design.md §7.1（端点签名）、router.py:134 路径优先级注释。依赖 task-02 的 member_summary() 方法。
