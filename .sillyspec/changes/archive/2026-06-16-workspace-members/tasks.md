---
author: qinyi
created_at: 2026-06-16T09:44:00
---

# Tasks — workspace-members

> 任务细节在 plan 阶段展开。本文件只列任务名 + 简短说明。

## 后端

- [x] T1: workspace/schema.py 新增 4 个 Pydantic schema（WorkspaceMemberView / WorkspaceMemberListResponse / WorkspaceMemberAddRequest / WorkspaceMemberUpdateRequest / UserSearchHit / UserSearchResponse）
- [x] T2: workspace/members_service.py 业务逻辑（list_members / search_users_for_invite / add_or_update_member / update_member_role / remove_member / transfer_ownership）；最后 owner 保护 + 白名单校验 + 单事务 transfer
- [x] T3: workspace/members_router.py 6 个端点；权限 require_permission_any(WORKSPACE_MEMBER_MANAGE)；422/403/404/400 错误路径
- [x] T4: app/main.py 或 workspace/router.py include members_router
- [x] T5: backend/tests/modules/workspace/test_members_router.py ≥15 用例（覆盖 FR-01..06 所有 GWT）

## 前端

- [x] T6: frontend/src/lib/workspace-members.ts API client（6 个函数）
- [x] T7: frontend/src/components/workspace-member-add-dialog.tsx 添加成员对话框（debounce 搜索 + 候选下拉 + 角色下拉 + 错误条）
- [x] T8: workspace 详情页 tab 化（Overview / Components / Changes / Members）
- [x] T9: frontend/src/app/(dashboard)/workspaces/[id]/members/page.tsx 成员表格（role dropdown + Set Owner + Remove + 当前用户标识 + 权限禁用）

## 集成

- [x] T10: 后端 pytest 全量通过；前端 pnpm lint + build 通过
- [x] T11: 部署 stack；e2e 验证：admin 加成员 → 该成员用 access_token 访问 ws 资源不再 403 → transfer ownership → 移除
- [x] T12: 提交 + 推送 + Docker 重建

## 任务依赖

- T3 → T2 → T1（schema 先于 service 先于 router）
- T4 → T3
- T5 → T4
- T7 → T6
- T9 → T6 + T8
- T10/T11/T12 → 所有
