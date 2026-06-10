---
author: WhaleFall
created_at: 2026-06-10T10:00:00
---

# Design: 用户管理模块升级（第一阶段）

## 决策 1: require_platform_admin 修复

**方案**: 修复 `auth_deps.py` 中的 `require_platform_admin()` stub，使其检查 `user.is_platform_admin`。

```python
async def require_platform_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_platform_admin:
        raise HTTPException(403, "Platform admin required")
    return user
```

**原因**: 现有 stub 直接返回 user 不做检查，是最紧急的安全修复。

## 决策 2: 提取 UserService

**方案**: 从 `settings/router.py` 内联 CRUD 逻辑提取到 `settings/service.py` 的 `UserService` 类。

**方法**: `UserService(session, actor_id)` — 所有方法接收 `actor_id` 用于安全检查和审计。

**不放在独立 `user/` 模块的原因**: 避免与现有 auth/model.py 的 User 模型产生循环导入，且 settings 模块已包含用户管理路由。

## 决策 3: 安全保护策略

| 保护规则 | 实现 |
|----------|------|
| 不能删除自己 | `delete_user(actor_id, target_id)` → `if actor_id == target_id: raise 403` |
| 不能禁用自己 | `update_user()` → `if status=="disabled" and actor_id == target_id: raise 403` |
| 不能移除最后管理员 | 移除 admin 前 `COUNT(is_platform_admin=True AND status='active')` → 若 ≤1 则拒绝 |
| 禁用/删除时撤销会话 | 在 `update_user(disabled)` 和 `delete_user()` 中批量 `UPDATE sessions SET revoked_at=now WHERE user_id=X AND revoked_at IS NULL` |

## 决策 4: 审计日志接入

**方案**: 在 UserService 方法中设置 `session.info["audit_context"] = {"actor_id": ..., "workspace_id": None}`，利用现有 `audit_hooks.py` 自动生成 AuditLog。

对于 platform 级操作（无 workspace_id），扩展 AuditLog 使 `workspace_id` 可为 NULL（已支持）。

额外：对关键操作（密码重置、admin 变更、禁用/删除）显式写一条 action 记录到 AuditLog，包含 `action="user.password_reset"`, `resource_type="user"`, `resource_id=target_user_id`。

## 决策 5: 用户列表查询增强

**后端**: 扩展 `GET /api/users` 查询参数：

```
GET /api/users?q=搜索词&status=active&role=admin&sort=created_at&order=desc&limit=20&offset=0
```

- `q`: 模糊匹配 email 或 display_name（ILIKE `%term%`）
- `status`: 精确匹配 status 字段
- `role`: `admin` 过滤 `is_platform_admin=true`，`user` 过滤 `is_platform_admin=false`
- `sort`: `created_at` | `last_login_at` | `email`
- `order`: `asc` | `desc`
- `limit`/`offset`: 分页

## 决策 6: 用户详情抽屉

**前端**: 在 settings 用户列表点击用户行展开右侧抽屉（Drawer），展示：

1. **基本信息**: email, display_name, status, admin, created_at, last_login_at
2. **所属 Workspace**: 只读列表，展示 workspace name + user_workspace_roles.role
3. **活跃会话**: 调用 `GET /api/users/{id}/sessions` 返回 `[{id, user_agent, ip, created_at}]`
4. **审计记录**: 调用 `GET /api/users/{id}/audit` 返回最近的操作记录

**后端新增端点**:
- `GET /api/users/{user_id}/sessions` — 返回该用户的活跃会话列表
- `GET /api/users/{user_id}/audit` — 返回该用户的审计记录（resource_type="user" OR actor_id=user_id）
- `POST /api/users/{user_id}/reset-password` — 管理员重置密码

## 决策 7: 管理员重置密码

**端点**: `POST /api/users/{user_id}/reset-password`
**请求体**: `{ "new_password": "..." }`
**校验**: 仅 platform admin 可调用；new_password 最小 8 字符
**实现**: `user.password_hash = hash_password(new_password)` + 撤销所有会话（强制重新登录）+ 审计日志

## 决策 8: API 兼容性

所有现有端点路径和响应格式不变：
- `GET /api/users` — 增加可选查询参数，原有调用方式不受影响
- `POST /api/users` — 不变
- `PATCH /api/users/{id}` — 不变
- `DELETE /api/users/{id}` — 不变

新增端点使用新路径，不破坏现有 API。

## 文件变更清单

| 文件 | 操作 |
|------|------|
| `backend/app/core/auth_deps.py` | 修复 `require_platform_admin` |
| `backend/app/modules/settings/service.py` | **新建** UserService |
| `backend/app/modules/settings/router.py` | 权限校验 + 新端点 |
| `backend/app/modules/settings/schema.py` | 查询参数 + 新 DTO |
| `frontend/src/lib/settings.ts` | 增强查询参数 + 新 API 函数 |
| `frontend/src/app/(dashboard)/settings/page.tsx` | 搜索/筛选/分页 + 详情抽屉 |
