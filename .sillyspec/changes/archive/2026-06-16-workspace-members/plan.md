---
author: qinyi
created_at: 2026-06-16T09:50:00
---

# Plan — workspace-members

```
plan_level: light
```

## 来源

- `proposal.md`：成员管理 UI/API 范围 + 7 项非目标 + 8 条成功标准
- `design.md` §5.1：6 个端点（list/search/add/update/delete/transfer-ownership）+ 业务规则 + Pydantic schema 定义
- `design.md` §5.2：前端 API client + 添加对话框 + workspace tab 化 + Members 表格
- `design.md` §6：11 个文件变更清单（9 新 + 2 改）
- `requirements.md` FR-01..08：每个端点 + UI 的 GWT 用例

## 范围

- **后端**：复用 `UserWorkspaceRole` 模型，无 schema 变更。新增 `members_router.py` + `members_service.py`，挂载到 `/api/workspaces/{workspace_id}/members`。权限用 `Permission.WORKSPACE_MEMBER_MANAGE`（已 seed 给 `workspace_owner`，platform_admin 自动 bypass）。
- **前端**：workspace 详情页 tab 化（Overview/Components/Changes/Members），新增 Members 子路由 + 添加成员对话框 + API client。
- **角色白名单**：`workspace_owner` / `developer` / `viewer`（禁 platform_admin）。
- **不变量**：每个 ws 至少 1 个 workspace_owner；transfer 单事务。

## 任务列表

### Wave 1：后端 schema + service

- [x] task-01: `backend/app/modules/workspace/schema.py` 新增 6 个 Pydantic schema（WorkspaceMemberView / WorkspaceMemberListResponse / WorkspaceMemberAddRequest / WorkspaceMemberUpdateRequest / UserSearchHit / UserSearchResponse），字段与 design §5.1 一致；Literal 类型限制 role_key 白名单
- [x] task-02: `backend/app/modules/workspace/members_service.py` 业务逻辑：list_members / search_users_for_invite / add_or_update_member / update_member_role / remove_member / transfer_ownership；包含白名单校验、最后 owner 保护、单事务 transfer

### Wave 2：后端 router + 装载 + 测试

- [x] task-03: `backend/app/modules/workspace/members_router.py` 6 个端点；权限 `require_permission_any(Permission.WORKSPACE_MEMBER_MANAGE)`；422/403/404/400 错误路径完备
- [x] task-04: `backend/app/main.py` 或 `workspace/router.py` include members_router（prefix `/api/workspaces/{workspace_id}/members`）；启动 backend 健康检查通过
- [x] task-05: `backend/tests/modules/workspace/test_members_router.py` ≥15 用例，覆盖 FR-01..06 所有 GWT；pytest 全过

### Wave 3：前端 API + 对话框

- [x] task-06: `frontend/src/lib/workspace-members.ts` API client 6 个函数，与 backend 端点 1:1
- [x] task-07: `frontend/src/components/workspace-member-add-dialog.tsx` 添加成员对话框（debounce 300ms 搜索 + 候选下拉 + 角色下拉 + 错误条 + Add 禁用逻辑）

### Wave 4：前端 Members tab + 表格

- [x] task-08: workspace 详情页 tab 化（Overview / Components / Changes / Members），保持现有 page.tsx 内容为 Overview
- [x] task-09: `frontend/src/app/(dashboard)/workspaces/[id]/members/page.tsx` 成员表格（role dropdown + Set Owner + Remove + (you) 标识 + 权限禁用）

### Wave 5：集成 + 部署 + 推送

- [x] task-10: backend `uv run pytest` 全过；frontend `pnpm lint && pnpm build` 全过
- [x] task-11: Docker compose 重建 backend + frontend；e2e 验证（admin 加成员 → 成员访问 ws 资源不再 403 → transfer ownership → 移除 → 最后 owner 保护）
- [x] task-12: git commit + push origin main

## 验收标准

- [x] backend pytest 全过（≥15 新增用例 + 现有 1081 用例不回归）
- [x] frontend `pnpm lint` 无新增错误，`pnpm build` 成功
- [x] 现有用户/workspace 行为不变（注册时 seed 的 owner 关系保留）
- [x] platform_admin 通过 UI 可管理任何 ws 的成员；workspace_owner 只能管理自己 ws；developer/viewer 不能
- [x] 把用户加为 developer 后，该用户调 `/api/workspaces/{id}` 不再 403
- [x] transfer-ownership 后角色互换（事务原子性）
- [x] 移除最后 owner 被拒（HTTP 400 cannot_remove_last_owner）
- [x] 搜索结果只含 status='active' 用户且排除已是成员的
- [x] role_key 白名单生效：POST platform_admin → 400 invalid_role_key
