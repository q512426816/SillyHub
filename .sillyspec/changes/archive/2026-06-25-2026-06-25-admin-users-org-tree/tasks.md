---
author: WhaleFall
created_at: 2026-06-25T15:50:00
---

# Tasks — admin/users 组织树筛选

> 只列任务名 + 文件 + 覆盖 FR/D。细节在 plan 阶段展开。

- [ ] task-01：后端 schema — OrganizationRead +subtree_member_count、UserQueryParams +organization_id/include_children（admin/schema.py）覆盖 FR-02
- [ ] task-02：后端 organizations_service — +_subtree_member_count（distinct user_id，复用 _descendant_ids）、_to_read 注入（organizations_service.py）覆盖 FR-02 / D-003@v1 / D-005@v1
- [ ] task-03：后端 UserService.list_users — +organization_id/include_children 参数 + exists 子查询过滤、import _descendant_ids（users_service.py）覆盖 FR-01 / D-004@v1
- [ ] task-04：后端 router — /api/admin/users +organization_id/include_children Query 透传（router.py）覆盖 FR-01
- [ ] task-05：后端测试 — list_users 组织过滤用例（全部/叶子/含下级/distinct 去重/叠加 q+status+分页）（test_users_router.py）覆盖 FR-01 / FR-06
- [ ] task-06：前端 lib/admin.ts — UserListParams +organization_id/include_children、OrganizationRead +subtree_member_count、listUsers 透传 覆盖 FR-01 / FR-02
- [ ] task-07：前端 admin-org-tree 组件 — flat 组装树、全部组织节点、subtree_member_count、只显 active、展开/折叠、onSelect（components/admin-org-tree.tsx 新增）覆盖 FR-03 / D-001@v1 / D-002@v1
- [ ] task-08：前端 admin-user-drawer — +defaultOrganizationIds prop，create 模式预填 organizationIds（admin-user-drawer.tsx）覆盖 FR-05 / Design Grill X-001
- [ ] task-09：前端 admin/users page — +selectedOrgId、左树右表布局、右侧顶部当前筛选、点节点刷新、新建传 defaultOrganizationIds（users/page.tsx）覆盖 FR-04 / FR-05
- [ ] task-10：前端测试 — admin-org-tree 组装/点击筛选、新建带入（vitest）覆盖 FR-03 / FR-05
- [ ] task-11：集成验证 + 部署 — ruff+mypy+pytest+tsc+lint+vitest 全绿、rebuild Docker 部署、浏览器验收 6 条 覆盖 FR-06
