---
id: task-01
title: "schema.py 新增 ProjectMemberSummaryItem / ProjectMemberSummaryPageReq（6 维筛选），ProjectMemberResp 加可选 username"
title_zh: 后端聚合接口 DTO + 成员响应补账号字段
author: WhaleFall
created_at: 2026-07-15 11:05:37
priority: P0
depends_on: []
blocks: [task-02, task-05]
requirement_ids: [FR-02, FR-04]
decision_ids: [D-001@v1, D-002@v1, D-004@v1]
allowed_paths:
  - backend/app/modules/ppm/project/schema.py
goal: 定义聚合接口请求/响应 DTO 并给成员响应补登录账号字段，为聚合查询与账号列提供数据契约。
implementation:
  - 新增 ProjectMemberSummaryItem（id/project_name/project_code/project_status/project_type/company_name/owner_name/member_count/updated_at，加 ConfigDict(from_attributes=True)）
  - 新增 ProjectMemberSummaryPageReq（分页四件 + 6 维筛选 project_name/project_status/project_type/owner_name/member_keyword/role_name，均 str|None=None）
  - ProjectMemberResp（schema.py:177）加 username: str | None = None
  - 新增类名加入 __all__（字母序）
acceptance:
  - ProjectMemberSummaryItem 含 9 字段，类型对齐 design §7.1
  - ProjectMemberSummaryPageReq 含分页 + 6 维筛选共 10 字段
  - ProjectMemberResp 多可选 username，其余字段不变（向后兼容）
  - ruff 通过且 import 成功
verify:
  - cd backend && ruff check app/modules/ppm/project/schema.py
  - cd backend && python -c "from app.modules.ppm.project.schema import ProjectMemberSummaryItem, ProjectMemberSummaryPageReq"
constraints:
  - 零 migration（仅 DTO，不动 model.py）
  - username 可选默认 None，现有消费方（projects 抽屉等）向后兼容
  - 本任务不写测试（task-04 负责），不改 service/router
provides:
  - contract: ProjectMemberSummaryItem
    fields: [id, project_name, project_code, project_status, project_type, company_name, owner_name, member_count, updated_at]
  - contract: ProjectMemberSummaryPageReq
    fields: [page, page_size, order_by, order, project_name, project_status, project_type, owner_name, member_keyword, role_name]
  - contract: ProjectMemberResp
    fields: [id, create_name, pm_project_id, user_id, user_name, depart_id, phone, role_id, role_name, depart_name, created_by, updated_by, created_at, updated_at, username]
---

# task-01 — 后端聚合接口 DTO + 成员响应补账号字段

依据 design.md §7.1（聚合 DTO）、§7.3（ProjectMemberResp 加 username）；现有 schema.py PydanticModel + Field 模式。消费方：task-02（service 聚合 + 成员 LEFT JOIN）、task-05（前端类型对齐）。
