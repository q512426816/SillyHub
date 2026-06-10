---
author: WhaleFall
created_at: 2026-06-10T12:30:00
---

# Design: 用户管理模块升级 v2（增量）

## 背景

第一阶段（2026-06-10-user-management）已完成：权限校验、安全保护、查询增强、详情抽屉、密码重置、审计日志。
本阶段补齐剩余功能：单会话撤销、批量撤销端点、密码重置增强、用户所属 Workspace 查询、前端操作列优化。

## 设计目标

- 补齐会话管理端点（单个撤销 + 批量撤销）
- 密码重置支持审计标记（force_change_on_next_login）
- 用户详情可查看所属 Workspace 及角色
- 前端操作列简化，管理操作收归 Drawer

## 非目标

- 邀请用户流程
- Git 身份绑定
- 自定义角色编辑
- MFA
- force_change_on_next_login 持久化（仅审计标记）

## 总体方案

在现有 UserService 上扩展方法，不新建独立 Service 类。

## 决策 1: 单个会话撤销

**端点**: `DELETE /api/users/{user_id}/sessions/{session_id}`
**实现**: `UserService.revoke_session(target_id, session_id)`
- 查询 session 确认属于 target_user 且未撤销
- 设置 `revoked_at = now`
- 审计日志：`action="user.session_revoke"`

```python
async def revoke_session(self, target_id: uuid.UUID, session_id: uuid.UUID) -> None:
    session = await self.session.get(AuthSession, session_id)
    if session is None or session.user_id != target_id or session.revoked_at is not None:
        raise HTTPException(404, "Session not found")
    session.revoked_at = datetime.now(UTC)
    self.session.add(session)
    # 审计日志
    await self.session.commit()
```

## 决策 2: 批量撤销端点

**端点**: `POST /api/users/{user_id}/sessions/revoke-all`
**实现**: 复用已有 `_revoke_sessions(target_id)` 方法
- 审计日志：`action="user.sessions_revoke_all"`
- 返回被撤销的会话数量

## 决策 3: 密码重置增强

扩展现有 `reset_password` 方法签名：
```python
async def reset_password(self, target_id, new_password, force_change_on_next_login=False)
```
- `force_change_on_next_login` 仅写入审计日志 `details_json`，不加 DB 列
- `ResetPasswordRequest` DTO 增加可选字段

## 决策 4: 用户 Workspace 角色查询

**端点**: `GET /api/users/{user_id}/workspaces`
**实现**: `UserService.list_workspaces(target_id)`
- 查询 UserWorkspaceRole JOIN Workspace JOIN Role
- 返回 `[{workspace_name, workspace_slug, role_name}]`
- 新增 `UserWorkspaceRead` DTO

## 决策 5: 前端操作列优化

- 用户列表操作列：只保留"详情"链接，点击打开 Drawer
- Drawer 新增 "所属 Workspace" Tab
- 会话 Tab 增加"撤销"按钮（单个 + 全部）
- 密码重置增加 `force_change_on_next_login` 复选框

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|------|----------|------|
| 修改 | `backend/app/modules/settings/service.py` | 新增 revoke_session/revoke_all_sessions/list_workspaces，扩展 reset_password |
| 修改 | `backend/app/modules/settings/router.py` | 新增 3 个端点 |
| 修改 | `backend/app/modules/settings/schema.py` | 新增 UserWorkspaceRead、RevokeAllResponse，扩展 ResetPasswordRequest |
| 修改 | `frontend/src/lib/settings.ts` | 新增 API 函数 |
| 修改 | `frontend/src/app/(dashboard)/settings/page.tsx` | 操作列简化 + Drawer 增强 |

## 接口定义

### 新增端点

```
DELETE /api/users/{user_id}/sessions/{session_id} → 204
POST  /api/users/{user_id}/sessions/revoke-all → { revoked_count: int }
GET   /api/users/{user_id}/workspaces → [{ workspace_name, workspace_slug, role_name }]
```

### 新增 DTO

```python
class UserWorkspaceRead(BaseModel):
    workspace_name: str
    workspace_slug: str
    role_name: str

class RevokeAllResponse(BaseModel):
    revoked_count: int
```

### 扩展 DTO

```python
class ResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=8)
    force_change_on_next_login: bool = False  # 新增
```

## 兼容策略

- 现有端点路径和响应格式不变
- `ResetPasswordRequest` 新增字段可选，原有调用不受影响
- 新增端点使用新路径

## 风险登记

| 编号 | 风险 | 等级 | 应对 |
|------|------|------|------|
| R-01 | revoke-all 在高并发下可能有短暂不一致 | P2 | 可接受，非关键路径 |

## 自审

- ✅ 需求覆盖：5 项增量全部覆盖
- ✅ 约束一致性：无新 DB 列，无新依赖
- ✅ YAGNI：不做 force_change 持久化
- ✅ 兼容策略：现有 API 不变
- ✅ 风险识别：仅 P2 风险
