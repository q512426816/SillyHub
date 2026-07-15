---
id: task-02
title: "service.py member_summary() 聚合查询 + ProjectMemberService.page() LEFT JOIN users 取 username + 排序白名单"
title_zh: 项目聚合查询（负责人推算/成员数/多维筛选）+ 成员接口带账号
author: WhaleFall
created_at: 2026-07-15 11:05:37
priority: P0
depends_on: [task-01]
blocks: [task-03]
requirement_ids: [FR-02, FR-04, FR-08]
decision_ids: [D-001@v1, D-002@v1, D-004@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/ppm/project/service.py
goal: 实现项目聚合查询（负责人推算 + 成员数 + 6 维 EXISTS 筛选 + 分页排序），并让成员接口 LEFT JOIN users 带出登录账号。
implementation:
  - member_summary(req) 用 owner_name 标量子查询（role_name ilike '%项目经理%' order by created_at asc limit 1）+ member_count 标量子查询
  - owner_name/member_keyword/role_name 用 EXISTS 子查询筛选；member_keyword 匹配成员 user_name 或 users.username
  - count_total + apply_sort（白名单 _MEMBER_SUMMARY_SORT_FIELDS={updated_at,created_at,project_name,project_code}）+ apply_pagination；行映射 owner_name=None 兜底、member_count=int
  - ProjectMemberService.page() 改 select(PpmProjectMember, User.username).outerjoin(User, User.id==PpmProjectMember.user_id)，映射带 username
acceptance:
  - 聚合返回 Page[ProjectMemberSummaryItem]，多 PM 取 created_at 最早，无 PM owner_name=None
  - member_count 正确；6 维筛选各自生效
  - 成员接口带 username（无对应用户则 None）
  - 排序仅白名单字段
verify:
  - cd backend && pytest app/modules/ppm/project -q
constraints:
  - 复用 count_total/apply_sort/apply_pagination 不重造轮子
  - 零 migration；派生列不进排序白名单（D-005）
  - user_id FK CASCADE 保证 join 安全
expects_from:
  task-01:
    - contract: ProjectMemberSummaryItem
      needs: [id, project_name, project_code, project_status, project_type, company_name, owner_name, member_count, updated_at]
    - contract: ProjectMemberSummaryPageReq
      needs: [page, page_size, order_by, order, project_name, project_status, project_type, owner_name, member_keyword, role_name]
---

# task-02 — 项目聚合查询 + 成员接口带账号

依据 design.md §7.2（标量子查询 + EXISTS 筛选 + 分页排序）、§7.3（LEFT JOIN users）。复用 crud.py helper 与现有 role_name ilike 多角色匹配（service.py:452）。
