---
schema_version: 1
doc_type: module-card
module_id: lib-workspace-members
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 工作区成员客户端（lib-workspace-members）

## 定位
工作区成员管理域的浏览器侧 API 客户端（`frontend/src/lib/workspace-members.ts`，186 行）。封装成员列表 / 邀请搜索 / 添加 / 改角色 / 移除 / 所有权转让六个操作，与后端 `/api/workspaces/{ws}/members/*` 端点 1:1。供 `app-workspace-pages` 的成员管理页（members/page.tsx）与 `components-admin` 的 workspace-member-row / workspace-member-add-dialog 消费。

## 契约摘要
- `listMembers(workspaceId): Promise<WorkspaceMemberView[]>` — 成员列表（剥掉响应 `items` 包装）。
- `searchUsersForInvite(workspaceId, q, limit?): Promise<UserSearchHit[]>` — 按 display_name/email ILIKE 模糊搜索可邀用户（已排除在册成员）。
- `addMember(workspaceId, req): Promise<WorkspaceMemberView>` — 加成员（已成员则改 role，幂等）。
- `updateMemberRole(workspaceId, userId, req): Promise<WorkspaceMemberView>` — 改角色。
- `removeMember(workspaceId, userId): Promise<void>` — 移除（后端拒绝移除最后一个 owner）。
- `transferOwnership(workspaceId, userId): Promise<void>` — 目标升 owner、当前用户降 developer（单事务）。
- 类型：`WorkspaceMemberRoleKey` = `"workspace_owner" | "developer" | "viewer" | "business_member"`（business_member 为 daemon-borrow 变更新增，可借共享 daemon）；`WorkspaceMemberView`（含 `is_current_user`，role_key 为宽松 string 允许回显 platform_admin）；`UserSearchHit`（含 `is_member`）。

## 关键逻辑
```
membersBase(wid) = `/api/workspaces/${encodeURIComponent(wid)}/members`
listMembers:           GET    base                 → resp.items
searchUsersForInvite:  GET    base/search?q=&limit= → resp.items
addMember:             POST   base, json {user_id, role_key}
updateMemberRole:      PATCH  base/${encodeURIComponent(userId)}, json {role_key}
transferOwnership:     POST   base/${userId}/transfer-ownership
```

## 注意事项
- 每个函数 try/catch 重抛（telemetry hook 预留位，带 eslint-disable），无业务语义。
- 请求/响应类型**手写**（与 backend schema 字段名 1:1），后端 schema 改动需人工同步；注意 `role_key` 响应用 string 而非 Literal 是刻意的（service 会回显 platform_admin 等用于展示）。
- `transferOwnership` 高危不可逆：UI 层（workspace-member-row）必须二次确认；转让后当前 owner 降为 developer。
- 权限矩阵：list 走 WORKSPACE_READ（任何成员可见），其余 5 个走 WORKSPACE_MEMBER_MANAGE；错误统一 ApiError 透传（401 自动 refresh，403/404/400 由调用方按 status 提示）。
- 添加成员选 business_member 角色的语义：仅触发 agent 出方案、不改代码（借共享 daemon 场景），别当成普通 viewer 变体。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
