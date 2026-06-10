---
author: WhaleFall
created_at: 2026-06-10
---

# Plan: 用户管理模块升级（第一阶段）

## 依赖关系总览

```
Wave 1 (安全修复)
  └─→ Wave 2 (Service 层提取 + 安全保护)
        └─→ Wave 3 (审计日志 + 新端点)
              └─→ Wave 4 (前端列表增强)
                    └─→ Wave 5 (前端详情抽屉)
```

## Wave 1: 安全修复 — require_platform_admin

**目标**: 修复空壳权限检查，锁定所有用户管理端点为 admin-only。

**依据文档**: `design.md` 决策 1

### Task 1.1: 修复 require_platform_admin
- **文件**: `backend/app/core/auth_deps.py`
- **操作**: 修改 `require_platform_admin()` 添加 `Depends(get_current_user)` 注入 + `is_platform_admin` 检查
- **实现**:
  ```python
  async def require_platform_admin(
      user: Annotated[User, Depends(get_current_user)],
  ) -> User:
      if not user.is_platform_admin:
          raise HTTPException(status_code=403, detail="Platform admin required")
      return user
  ```
- **完成标准**: 非 admin 用户调用返回 403

### Task 1.2: 用户端点改用 require_platform_admin
- **文件**: `backend/app/modules/settings/router.py`
- **操作**: 所有 `/api/users` 端点把 `_user: CurrentUser` 改为 `_user: Annotated[User, Depends(require_platform_admin)]`
- **涉及端点**: `list_users`, `create_user`, `update_user`, `delete_user`
- **完成标准**: 非 admin 调用所有用户端点均返回 403；settings 端点不变

---

## Wave 2: Service 层提取 + 安全保护

**目标**: 从 router 提取业务逻辑到 UserService，加入自操作保护和最后管理员保护。

**依赖**: Wave 1 完成（需要正确的 require_platform_admin）

**依据文档**: `design.md` 决策 2、决策 3

### Task 2.1: 新建 UserService
- **文件**: `backend/app/modules/settings/service.py` (新建)
- **操作**: 创建 `UserService(session, actor_id)` 类
- **方法**:
  - `list_users(q, status, role, sort, order, limit, offset)` → 增强查询
  - `create_user(email, password, display_name, is_platform_admin)` → 创建用户
  - `update_user(target_id, display_name, is_platform_admin, status)` → 含安全保护
  - `delete_user(target_id)` → 含安全保护 + 会话撤销
- **完成标准**: UserService 类可被 router 调用

### Task 2.2: 实现安全保护逻辑
- **文件**: `backend/app/modules/settings/service.py`
- **操作**: 在 `update_user` 和 `delete_user` 中实现:
  - 自禁用保护: `if status=="disabled" and actor_id == target_id → raise 403`
  - 自删除保护: `if actor_id == target_id → raise 403`
  - 最后管理员保护: 移除 admin 前 `COUNT(is_platform_admin=True AND status='active')` → 若 ≤1 则拒绝
  - 禁用/删除时撤销会话: `UPDATE sessions SET revoked_at=now WHERE user_id=X AND revoked_at IS NULL`
- **完成标准**: 所有安全保护规则生效，覆盖 FR-02a~FR-02e

### Task 2.3: Router 改用 UserService
- **文件**: `backend/app/modules/settings/router.py`
- **操作**: 所有用户端点调用 `UserService` 方法，移除内联 CRUD 逻辑
- **完成标准**: router 只做 HTTP 层处理（参数解析、响应序列化），业务逻辑全在 service

### Task 2.4: 增强 list_users 查询参数
- **文件**: `backend/app/modules/settings/service.py`, `backend/app/modules/settings/schema.py`
- **操作**:
  - `q`: 模糊匹配 email 或 display_name (`ILIKE '%term%'`)
  - `status`: 精确匹配
  - `role`: `admin` → `is_platform_admin=true`, `user` → `is_platform_admin=false`
  - `sort`: `created_at` | `last_login_at` | `email`
  - `order`: `asc` | `desc`
  - 默认: `sort=created_at, order=desc, limit=20, offset=0`
- **完成标准**: 所有查询参数工作正常，原有无参调用不受影响（FR-03a~FR-03e）

---

## Wave 3: 审计日志 + 新端点

**目标**: 接入审计日志，新增 sessions/audit/reset-password 端点。

**依赖**: Wave 2 完成（需要 UserService 已存在）

**依据文档**: `design.md` 决策 4、决策 6、决策 7

### Task 3.1: UserService 审计上下文接入
- **文件**: `backend/app/modules/settings/service.py`
- **操作**: 在每个修改方法中设置 `session.info["audit_context"] = {"actor_id": actor_id, "workspace_id": None}`
- **完成标准**: 用户 CRUD 操作自动通过 `audit_hooks.py` 生成 AuditLog

### Task 3.2: 关键操作显式审计
- **文件**: `backend/app/modules/settings/service.py`
- **操作**: 对密码重置、admin 变更、禁用/删除操作额外写一条显式 AuditLog:
  - `action="user.password_reset"` / `user.admin_change` / `user.disable` / `user.delete`
  - `resource_type="user"`, `resource_id=target_id`
- **完成标准**: 关键操作有独立审计记录（FR-06a~FR-06d）

### Task 3.3: 用户详情端点
- **文件**: `backend/app/modules/settings/router.py`, `backend/app/modules/settings/schema.py`
- **操作**:
  - `GET /api/users/{user_id}/sessions` — 返回活跃会话列表
  - `GET /api/users/{user_id}/audit` — 返回审计记录 (`resource_type="user" OR actor_id=user_id`)
  - `POST /api/users/{user_id}/reset-password` — 管理员重置密码 (最少 8 字符，重置后撤销全部会话)
- **DTO**: 新增 `UserSessionRead`, `AuditLogRead`, `ResetPasswordRequest`
- **完成标准**: 三个端点均可正常调用，权限要求 platform admin

---

## Wave 4: 前端用户列表增强

**目标**: 搜索、筛选、分页、排序。

**依赖**: Wave 3 完成（需要后端增强查询参数已就绪）

**依据文档**: `design.md` 决策 5

### Task 4.1: API 客户端增强
- **文件**: `frontend/src/lib/settings.ts`
- **操作**:
  - `listUsers` 增加 `q`, `role`, `sort`, `order` 参数
  - 新增 `listUserSessions(userId)`, `listUserAudit(userId)`, `resetUserPassword(userId, password)` 函数
  - 新增对应 interface: `UserSessionRead`, `AuditLogRead`, `ResetPasswordRequest`
- **完成标准**: TypeScript 类型正确，API 函数可调用

### Task 4.2: 用户列表 UI 增强
- **文件**: `frontend/src/app/(dashboard)/settings/page.tsx`
- **操作**:
  - 搜索框（email/display_name 模糊搜索）
  - Status 筛选下拉（全部/active/disabled）
  - Role 筛选下拉（全部/admin/user）
  - 分页控件（上一页/下一页 + 页码显示）
  - 排序列头点击（created_at/last_login_at/email）
- **完成标准**: 所有筛选条件工作正常，分页正确

---

## Wave 5: 前端用户详情抽屉

**目标**: 点击用户行展开右侧 Drawer，展示详情。

**依赖**: Wave 4 完成

**依据文档**: `design.md` 决策 6

### Task 5.1: 用户详情 Drawer 组件
- **文件**: `frontend/src/app/(dashboard)/settings/page.tsx`
- **操作**:
  - 点击用户行展开右侧 Drawer
  - Tab 1: 基本信息 (email, display_name, status, admin, created_at, last_login_at)
  - Tab 2: 所属 Workspace 角色列表 (workspace name + role)
  - Tab 3: 活跃会话列表 + 撤销按钮
  - Tab 4: 审计记录列表
- **完成标准**: Drawer 正常展开/关闭，所有 Tab 数据正确加载

### Task 5.2: 管理员重置密码
- **文件**: `frontend/src/app/(dashboard)/settings/page.tsx`
- **操作**: 在 Drawer 中添加重置密码按钮，点击弹出确认弹窗，输入新密码（最少 8 字符）
- **完成标准**: 重置密码流程完整（确认 → 输入新密码 → 调用 API → 成功提示）
