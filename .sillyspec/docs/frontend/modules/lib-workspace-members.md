---
schema_version: 1
doc_type: module-card
module_id: lib-workspace-members
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:04
---
# lib-workspace-members

## 定位
工作区成员（workspace members）域的浏览器侧 API 客户端。封装工作区下「成员列表 / 邀请搜索 / 增删改 / 角色变更 / 所有权转让」六个操作，供 `app-workspace-pages` 的成员管理页与 `components-admin` 调用。所有请求经 `lib-api` 的 `apiFetch` 发起，错误统一抛 `ApiError`（401 自动刷新，403/404/400 透传）。

## 契约摘要
全部 `export async function`，路径基址由内部 `membersBase(workspaceId)` 拼 `/api/workspaces/<id>/members`：

- `listMembers(workspaceId): Promise<WorkspaceMemberView[]>` — 成员列表（含用户信息 + 角色）。
- `searchUsersForInvite(workspaceId, keyword): Promise<UserSearchHit[]>` — 邀请时按关键词搜可加入用户。
- `addMember(workspaceId, req: WorkspaceMemberAddRequest): Promise<WorkspaceMemberView>` — 加成员。
- `updateMemberRole(workspaceId, memberId, req): Promise<WorkspaceMemberView>` — 改成员角色。
- `removeMember(workspaceId, memberId): Promise<void>` — 移除成员。
- `transferOwnership(workspaceId, toUserId): Promise<void>` — 转让工作区所有权。

类型：`WorkspaceMemberView`（成员视图）、`WorkspaceMemberListResponse`、`UserSearchHit` / `UserSearchResponse`、`WorkspaceMemberAddRequest` / `WorkspaceMemberUpdateRequest`。

## 关键逻辑
```
membersBase(wid) = `/api/workspaces/${wid}/members`
addMember(wid, req):    apiFetch(membersBase(wid), { method:"POST", body: req })
updateMemberRole(...):  apiFetch(`${membersBase(wid)}/${memberId}`, { method:"PATCH", body: req })
removeMember(...):      apiFetch(`${membersBase(wid)}/${memberId}`, { method:"DELETE" })
transferOwnership(...): apiFetch(`${membersBase(wid)}/transfer-ownership`, { method:"POST", body:{toUserId} })
```

## 注意事项
- 错误处理依赖 `apiFetch`：401 自动 refresh+retry 一次；权限不足/成员不存在等业务错误（403/404/400）直接透传 `ApiError`，UI 层按 `error.status` 展示。
- `transferOwnership` 是高危不可逆操作，UI 必须二次确认；转让后当前 owner 降级为普通成员。
- 路径中 workspaceId / memberId 均为 UUID，无需额外编码但仍建议经 `apiFetch` 统一拼接。
- 成员角色枚举由后端定义（owner/admin/member 等），前端类型仅做宽松 `string` 约束。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
