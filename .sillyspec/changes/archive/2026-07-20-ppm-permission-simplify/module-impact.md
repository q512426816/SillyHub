---
author: qinyi
created_at: 2026-07-20 13:58:00
---

# 模块影响（Module Impact）— 精简 PPM 权限

变更：`2026-07-20-ppm-permission-simplify`
类型：权限模型精简（删 17 个摆设操作权限 + 6 router 去权限校验）

## 受影响模块

| 模块 | 路径 | 变更类型 | 说明 |
|---|---|---|---|
| auth 权限枚举 | `backend/app/modules/auth/permissions.py` | 修改 | 删 17 个 PPM_* 操作权限枚举成员（write/delete/export/assign），留 8 个菜单/读权限。`group` property 不变。 |
| ppm 6 router | `backend/app/modules/ppm/{project,plan,task,problem,kanban,workbench}/router.py` | 修改 | 端点 `Depends(require_permission_any(Permission.PPM_*))` → `Depends(get_current_principal)`（仅认证不授权，保留 JWT+API key 双路径）。集中别名收敛为 `AuthUser`。 |
| 数据库迁移 | `backend/migrations/versions/202607041000_seed_ppm_permissions.py` | 修改 | `PPM_PERMISSIONS` 种子清单 25→8（新环境从头 seed 仅菜单权限）。 |
| 数据库迁移 | `backend/migrations/versions/20260720_drop_ppm_operation_permissions.py` | 新增 | 清理迁移：已部署 DB `DELETE FROM role_permissions WHERE permission IN (17 个)`；downgrade 对称回植到 platform_admin。 |
| OpenAPI schema | `backend/openapi.json` | 重生成 | ppm 权限枚举从 25 值减至 8 值（生成产物，每提交重生成约定）。 |
| auth 权限测试 | `backend/tests/modules/auth/test_ppm_permissions.py` | 修改 | EXPECTED 25→8、count 断言、platform_admin 持有权限断言。 |
| auth 权限测试 | `backend/tests/modules/auth/test_permissions.py` | 修改 | 总枚举数 70→53（连带，集成测试发现）。 |
| admin 角色测试 | `backend/tests/modules/admin/test_roles_router.py` | 修改 | 删 `test_update_role_accepts_ppm_problem_export`（引用已删 PPM_PROBLEM_EXPORT，连带）。 |
| ppm 接口测试 | `backend/tests/modules/ppm/test_router_smoke.py` | 新增 | 最小冒烟：登录 200 / 未登录 401（弥补 ppm 模块无 router 测试，R-04）。 |
| 前端菜单映射 | `frontend/src/lib/menu-permissions.ts` | 修改 | project-members 菜单删悬空 `{ key: "ppm:project:write" }`，只留 read。 |
| 前端菜单测试 | `frontend/src/lib/__tests__/menu-permissions.test.ts` | 修改 | BACKEND_PERMISSION_KEYS mirror 删 16 动作权限（70→54）、长度断言、project-members 断言改 read-only（连带）。 |

## 不受影响（显式边界）

- **前端 ppm 页面按钮逻辑**：新增/删除按钮靠 `is_platform_admin` + 所有权判断，不依赖 `ppm:*` 权限，本变更不动。
- **ppm 业务逻辑**：数据范围查询、CRUD 行为、状态机不变（与进行中的 ppm-data-scope 变更正交）。
- **菜单粒度**：8 个菜单权限仍各自独立控制菜单显隐，不合并、不增减菜单条目。
- **`seed_platform_admin_role` 启动兜底**：遍历 `Permission` 枚举补种，枚举删了自动少，无需改。
- **daemon 生命周期 / 状态机 / 事件契约**：不涉及（design §7.5）。

## 跨模块依赖

- **无**。变更集中在 auth 权限枚举 + ppm router 鉴权层，不涉及 change/daemon/workspace 等其他模块的业务逻辑。仅复用 auth 的 `get_current_principal` 仅认证依赖（已存在，`auth_deps.py:154`）。

## 数据层影响

- **无表结构变更**。权限是 Python 枚举不入库；授权记录在 `role_permissions` 表（`role_id` + `permission` 字符串）。
- **数据清理**：新清理迁移 DELETE 已部署环境 `role_permissions` 中 17 个被删权限的授权记录（主要影响 platform_admin 角色）。
- 项目未上线，允许重置数据（规则 11），不要求历史兼容。

## 部署同步要求

- backend 镜像需重建（枚举 + router + 迁移代码变更）。
- 部署后 `alembic upgrade head` 执行新清理迁移（AC-3 部署期验证）。
- frontend 需重建（menu-permissions.ts 变更）。
- **无 WS/接口契约 breaking** 需同步部署（接口签名不变，仅鉴权依赖替换）。
