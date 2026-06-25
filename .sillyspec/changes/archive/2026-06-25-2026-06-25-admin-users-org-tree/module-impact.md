---
author: WhaleFall
created_at: 2026-06-25T20:40:00
---

# 模块影响分析 — 2026-06-25-admin-users-org-tree

> 依据：`git diff 5c56b15e..33afc38e`（含主变更+style fix+加宽/截断/滚动+verify-result+quicklog）。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| admin | 接口变更 + 逻辑变更 + 新增 | `backend/app/modules/admin/{schema,organizations_service,users_service,router}.py`、`backend/tests/modules/admin/{test_users_router,test_schema_username_login}.py`、`frontend/src/lib/admin.ts`、`frontend/src/components/{admin-org-tree,admin-user-drawer,admin-organization-tree}.tsx`、`frontend/src/app/(dashboard)/admin/users/page.tsx`、`frontend/src/components/__tests__/{admin-org-tree,admin-user-drawer,admin-organization-tree}.test.tsx` | OrganizationRead +subtree_member_count；list_users +organization_id/include_children exists 过滤；router Query 透传；admin-org-tree 组件（新增）flat 组装树/只显 active/展开收起/滚动；drawer +defaultOrganizationIds；users page 左树右表+当前筛选+新建带入 | false |
| settings | 调用关系变更 | `backend/app/modules/settings/router.py` | list_users 加参数默认 None 向后兼容，settings router 无需改动 | false |

## 未匹配文件

| 文件 | 说明 |
|---|---|
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/**` | 变更工作区文档 |
| `.sillyspec/quicklog/QUICKLOG-WhaleFall.md` | quicklog ql-006/007 |

## 决策覆盖（D-001~D-005 全 PASS）

| 决策 | 覆盖 | 验收 |
|---|---|---|
| D-001 include_children 固定 true | admin frontend | ✅ |
| D-002 树只显 active | admin frontend | ✅ |
| D-003 subtree_member_count distinct | admin backend | ✅ |
| D-004 exists 子查询 | admin backend | ✅ |
| D-005 实时算不缓存 | admin backend | ✅ |
