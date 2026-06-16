---
author: qinyi
created_at: 2026-06-16T09:35:00
---

# design.md — workspace-members

## 1. 背景

当前 SillyHub 的 workspace 成员管理是隐式的：

- 用户注册时（`auth/service.py:_seed_default_workspace_members`）被自动加为某些 workspace 的 `workspace_owner`
- RBAC 表结构完整：`User → UserWorkspaceRole → Role → RolePermission`，7 个 seed 角色（`workspace_owner` / `developer` / `reviewer` / `qa` / `component_lead` / `viewer` / `platform_admin`）
- 但**没有 UI 入口**让 admin/owner 把其他用户加进 workspace、指定角色、或移除成员

这导致 workspace 实际是单用户孤岛——多 admin 账号场景下（如 `admin@example.com` 与 `admin@sillyhub.local` 共存时），新 admin 不会被自动加入旧 admin 创建的 workspace，引发归属校验类 403（见 `2026-06-16-daemon-api-key` 收尾时发现的连带问题）。

## 2. 设计目标

- workspace_owner / platform_admin 能通过 UI 给 workspace 添加 / 移除 / 改角色成员
- 成员搜索支持 display_name + email 模糊匹配
- 提供"传递所有权"操作（owner 一键降级，目标成员升 owner），单事务保证至少一个 owner 不变量
- 复用现有 `UserWorkspaceRole` + `Permission.WORKSPACE_MEMBER_MANAGE`，无 schema 变更

## 3. 非目标

- **不做**邀请链接 / 邮件邀请（要邮件发送能力，超出本次范围；按用户搜索已注册用户即可）
- **不做**细粒度自定义角色（用现有 7 个 seed 角色）
- **不做** workspace 创建/删除（已有路径）
- **不做** platform_admin 角色的 UI 授予/撤销（系统级保留，只能在 `/settings` 用户管理页操作）
- **不做**批量操作（一次只能加/移除一个）
- **不做**前端 vitest 单测（依赖手动 e2e 验收；后端单测必须）

## 4. 拆分判断

不拆分。理由：

- 单一交付：4 个后端端点 + 1 个前端 tab + 1 个对话框
- 无 schema 变更（复用 `UserWorkspaceRole`）
- 无跨模块影响（不影响 daemon / agent 执行 / change 流程）
- 估时 < 1 人天

## 5. 总体方案

### 5.1 后端

新增 `backend/app/modules/workspace/members_router.py`，挂载到 `app.include_router(members_router, prefix="/api/workspaces/{workspace_id}/members", tags=["workspace-members"])`。

**6 个端点**：

| 方法 | 路径 | 用途 | 权限 |
|------|------|------|------|
| GET | `/` | 列出 ws 所有成员（含 user 信息 + role_key + granted_at） | `WORKSPACE_READ`（任何成员可见） |
| GET | `/search?q=foo&limit=10` | 模糊搜索 users（display_name / email），排除已是该 ws 成员的 | `WORKSPACE_MEMBER_MANAGE` |
| POST | `/` | 添加成员（body: `{user_id, role_key}`），已成员则改 role（幂等） | `WORKSPACE_MEMBER_MANAGE` |
| PATCH | `/{user_id}` | 修改成员角色（body: `{role_key}`） | `WORKSPACE_MEMBER_MANAGE` |
| DELETE | `/{user_id}` | 移除成员；拒绝移除最后一个 owner | `WORKSPACE_MEMBER_MANAGE` |
| POST | `/{user_id}/transfer-ownership` | 把目标升 owner，当前 user 降 developer（单事务） | `WORKSPACE_MEMBER_MANAGE` |

**关键服务层 helper**（`workspace/service.py` 新增）：

- `list_members(session, ws_id) -> list[MemberView]`
- `search_users_for_invite(session, ws_id, q, limit) -> list[UserSearchHit]`：`User.email ILIKE :q OR User.display_name ILIKE :q`，LEFT JOIN 排除已是该 ws 成员的 user
- `add_or_update_member(session, ws_id, user_id, role_key, granted_by) -> UserWorkspaceRole`
- `update_member_role(session, ws_id, user_id, role_key) -> UserWorkspaceRole`
- `remove_member(session, ws_id, user_id) -> None`：内部检查"最后 owner 保护"
- `transfer_ownership(session, ws_id, target_user_id, current_user_id) -> None`：单事务 update 两行

**业务规则**：

| 规则 | 实现 |
|------|------|
| `role_key` 必须在 `{workspace_owner, developer, viewer}` 白名单 | service 层校验，非法 → 400 `invalid_role_key` |
| 禁止通过该 API 把成员角色改为 `platform_admin` | 同上白名单（platform_admin 不在白名单） |
| 移除最后一个 workspace_owner → 400 `cannot_remove_last_owner` | service 层 SELECT COUNT(workspace_owner) 在事务内 |
| 添加不存在的 user_id → 404 `user_not_found` | service 层 get_user 校验 |
| 搜索 `q` 最少 2 字符 | 端点 Query(min_length=2) |
| 搜索结果排除已是成员的 | SQL LEFT JOIN ... WHERE member.user_id IS NULL |
| 幂等 add：已是成员则更新 role（不报错） | ON CONFLICT 语义，service 层先 SELECT 再 UPDATE/INSERT |

**Schema**（`workspace/schema.py` 新增）：

```python
class WorkspaceMemberView(BaseModel):
    user_id: uuid.UUID
    email: str
    display_name: str | None
    role_key: str
    role_name: str
    granted_at: datetime
    is_current_user: bool  # 给前端高亮"你"

class WorkspaceMemberListResponse(BaseModel):
    items: list[WorkspaceMemberView]

class WorkspaceMemberAddRequest(BaseModel):
    user_id: uuid.UUID
    role_key: Literal["workspace_owner", "developer", "viewer"]

class WorkspaceMemberUpdateRequest(BaseModel):
    role_key: Literal["workspace_owner", "developer", "viewer"]

class UserSearchHit(BaseModel):
    user_id: uuid.UUID
    email: str
    display_name: str | None
    is_member: bool  # 通常为 False（搜索时已排除），保留字段供前端展示

class UserSearchResponse(BaseModel):
    items: list[UserSearchHit]
```

### 5.2 前端

**API client**（`frontend/src/lib/workspace-members.ts` 新增）：

- `listMembers(wsId): Promise<WorkspaceMemberView[]>`
- `searchUsersForInvite(wsId, q): Promise<UserSearchHit[]>`
- `addMember(wsId, {user_id, role_key}): Promise<void>`
- `updateMemberRole(wsId, userId, role_key): Promise<void>`
- `removeMember(wsId, userId): Promise<void>`
- `transferOwnership(wsId, userId): Promise<void>`

**对话框组件**（`frontend/src/components/workspace-member-add-dialog.tsx` 新增）：

- 搜索 input（debounce 300ms 调 `searchUsersForInvite`）
- 候选下拉（点击选中）
- 角色下拉（viewer / developer / workspace_owner）
- 提交按钮（无选中时 disabled）
- 错误提示行（API 失败时）

**workspace 详情页 tab 化**（`frontend/src/app/(dashboard)/workspaces/[id]/layout.tsx` 或 page.tsx 改造）：

- 顶部加 tab 系统：Overview / Components / Changes / **Members**（新增）/ 其他现有 tab
- 当前 `page.tsx` 是 Overview 内容，提取后保持原样
- 新增 `members/page.tsx`：成员表格

**Members 页面**（`frontend/src/app/(dashboard)/workspaces/[id]/members/page.tsx` 新增）：

| 列 | 来源 | 备注 |
|----|------|------|
| User | display_name (email) | is_current_user 时追加 "(you)" |
| Role | role 下拉 | 修改即 PATCH；当前用户改自己 role 时禁用 |
| Granted At | granted_at 格式化 | 只读 |
| Actions | Set Owner / Remove | owner 不可移除自己；最后 owner 不可移除/降级 |

操作流程：

- **Set Owner**：调 `transferOwnership` → 刷新列表（自己会变成 developer）
- **Remove**：confirm 后调 `removeMember` → 刷新
- **改角色 dropdown**：onChange 调 `updateMemberRole` → 刷新
- **Add Member**：开对话框

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `backend/app/modules/workspace/members_router.py` | 6 个端点 |
| 新增 | `backend/app/modules/workspace/members_service.py` | 业务逻辑 helper（最后 owner 保护、transfer 事务） |
| 修改 | `backend/app/modules/workspace/schema.py` | 新增 `WorkspaceMemberView` 等 4 个 schema |
| 修改 | `backend/app/modules/workspace/router.py` 或 `app/main.py` | include members_router |
| 新增 | `backend/tests/modules/workspace/test_members_router.py` | 15 个用例 |
| 新增 | `frontend/src/lib/workspace-members.ts` | API client |
| 新增 | `frontend/src/components/workspace-member-add-dialog.tsx` | 添加成员对话框 |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` 或新增 layout | tab 化 |
| 新增 | `frontend/src/app/(dashboard)/workspaces/[id]/members/page.tsx` | 成员管理页 |

## 7. 接口定义

详见 §5.1 表格。每个端点响应符合 §5.1 末尾的 Pydantic schema 定义。

错误响应：

| HTTP | code | 场景 |
|------|------|------|
| 400 | `invalid_role_key` | role_key 不在白名单 |
| 400 | `cannot_remove_last_owner` | 移除/降级最后 owner |
| 403 | `HTTP_403_PERMISSION_DENIED` | 无 member:manage 权限 |
| 404 | `workspace_not_found` | ws_id 不存在 |
| 404 | `user_not_found` | 添加/修改的 user_id 不存在 |

## 8. 数据模型

**无 schema 变更**。复用：

```python
class UserWorkspaceRole(BaseModel, table=True):
    user_id: uuid.UUID      # FK users.id
    workspace_id: uuid.UUID # FK workspaces.id
    role_id: uuid.UUID      # FK roles.id
    granted_by: uuid.UUID | None
    granted_at: datetime
    # 复合主键 (user_id, workspace_id, role_id)
```

`Role` 表已有 7 个 seed 角色，本变更只读使用其中 3 个 key（`workspace_owner` / `developer` / `viewer`）。

## 9. 兼容策略

- 未配置成员管理 UI 时行为不变：所有现有 workspace 仍由注册时 seed 的 owner 管理
- 新增端点独立挂载，不影响现有 `/api/workspaces/{id}` 路由
- 现有的 `_user_owns_run`（已改为按 membership）自动受益：admin 通过 UI 加进 ws 后，daemon 用 API key 能访问该 ws 的 run
- 现有用户不受影响（注册时 seed 的 owner 关系保留）

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|------|------|------|----------|
| R-01 | transfer-ownership 并发导致两个 user 都降级 / 都升级 | P1 | 单事务内 SELECT FOR UPDATE；service 层用 `async with session.begin()` 保证原子性 |
| R-02 | 用户搜索泄漏其他 workspace 用户邮箱 | P2 | 限制只搜 `status='active'` 用户；返回字段最小化（user_id/email/display_name，无 phone 等）；权限要求 member:manage |
| R-03 | 大 workspace 成员 >100 时列表性能 | P3 | 现阶段不 pagination（YAGNI）；将来按需加 `?offset&limit` |
| R-04 | 自我降级后失去管理权（owner→developer 后无法再升回） | P2 | UI 上"修改自己 role" disabled；transfer-ownership 时强制 confirm |
| R-05 | 用户被加为成员后，没获得对应权限（role_permissions 没正确 seed） | P1 | 端到端测试覆盖：加 developer 后调 `/api/workspaces/{id}` 验证能 WORKSPACE_WRITE |

## 11. 自审

| 维度 | 检查 | 结果 |
|------|------|------|
| 需求覆盖 | 4 个核心操作（加/列/改/删）+ transfer + 搜索 | ✅ 全覆盖 |
| 约束一致性 | 复用 `require_permission_any` / `apiFetch` / shadcn UI | ✅ |
| 真实性 | `Permission.WORKSPACE_MEMBER_MANAGE` / `UserWorkspaceRole` / `Role.key` 全部来自真实代码（已 grep 确认） | ✅ |
| YAGNI | 没有邀请链接 / 邮件 / 自定义角色 / 批量操作 / pagination | ✅ |
| 验收标准 | requirements.md 阶段写具体可测的 AC | ⏳ 下一步 |
| 非目标清晰 | §3 明确列出 6 项不做的事 | ✅ |
| 兼容策略 | §9 列出现有用户不受影响 | ✅ |
| 风险识别 | §10 列出 5 个 P1-P3 风险 | ✅ |

**结论**：自审通过，进入 requirements 阶段。
