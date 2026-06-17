---
author: WhaleFall
created_at: 2026-06-16T15:25:00
plan_level: full
---

# 实现计划：组织与权限中心（用户/组织/角色三模块）

## 来源

brainstorm 阶段产出的 design.md / proposal.md / requirements.md / tasks.md（已自审通过）。本计划基于现有 settings 模块用户管理（第一阶段成果）+ auth 模块 RBAC 基础设施扩展，新增独立 admin 模块承载三组 service + 三页面。

## 范围

- 后端：新增 admin 模块（organizations/roles/users 三 service）+ Alembic 迁移 + Permission 枚举扩展 + auth/model/rbac 扩展 + settings/router forward
- 前端：新增 /admin/{users,organizations,roles} 三页面 + 鉴权 layout + admin API 客户端 + 三组件；settings/UsersTab 删除 + 左侧导航新增「系统管理」分组
- 35 文件改动（22 新增 + 13 修改），跨 7 模块

## 重排说明（Step 8 产物）

原 plan.md 按「业务阶段」分 5 个粗粒度 Wave，但 Wave 1 把 task-01/02/03 放一起违反「同 Wave 内任务必须无依赖」规则（task-02 depends_on task-01，task-03 depends_on task-01/02）。本次重排按 tasks/task-NN.md frontmatter 的 depends_on 字段严格拓扑排序为 9 个 Wave，每个 Wave 内任务保证无依赖可并行。

## Wave 1（基础设施 - 数据迁移）

- [ ] task-01: Alembic 迁移——新增 organizations/user_organizations/user_roles 三表 + roles 加 is_active/updated_at + users 加 login_enabled

## Wave 2（基础设施 - 权限与模型扩展）

- [ ] task-02: Permission StrEnum 扩展（新增 7 项 + PermissionGroup + group 属性）+ auth/model.py 字段扩展 + rbac.py 平台级 user_roles 查询链路

## Wave 3（基础设施 - admin 模块骨架）

- [ ] task-03: admin 模块骨架（__init__/model 占位/schema 占位/router 占位）+ main.py 注册 admin_router + core/errors 新增 10 个错误类 + bootstrap seed platform_admin 角色

## Wave 4（角色管理 + 组织管理后端，并行）

- [ ] task-04: 角色管理后端完整实现（roles_service.py CRUD + 系统角色保护 + 删除前置检查；router.py 注册 /api/admin/roles 7 端点；schema.py RoleCreate/Update/Read/ListResponse；test_roles_router.py 覆盖 CRUD/系统保护/权限非法值/占用拒绝）
- [ ] task-05: 组织管理后端完整实现（model.py Organization/UserOrganization/UserRole ORM；organizations_service.py CRUD + 树形查询 + 删除前置检查；router.py 注册 /api/admin/organizations 7 端点；schema.py OrganizationCreate/Update/Read/Detail；test_organizations_router.py 覆盖 CRUD/树形/code 唯一/子组织占用/成员占用）

## Wave 5（用户管理迁移 + settings 兼容）

- [ ] task-06: 用户管理后端迁移与扩展（admin/users_service.py 含组织/角色绑定 + disable-login/enable-login + 复用现有自保护/最后管理员保护；settings/service.py+schema.py 改 re-export admin；settings/router.py /api/users/* handler forward 到 admin；auth/service.py login() 加 login_enabled 检查；admin/router.py 注册 /api/admin/users 11+2 端点；test_users_router.py 覆盖迁移兼容 + 扩展功能 + 自保护 + 登录权限）

## Wave 6（前端骨架，并行）

- [ ] task-07: 前端鉴权与导航骨架（(dashboard)/admin/layout.tsx 客户端鉴权 + 重定向；app-shell.tsx 新增「系统管理」分组；settings/page.tsx 删除 UsersTab + lib/settings.ts 移除用户函数）
- [ ] task-08: 前端 admin API 客户端（lib/admin.ts 含 users/organizations/roles 三组函数 + 类型定义；lib/__tests__/admin.test.ts 单元测试）

## Wave 7（前端三页面，并行）

- [ ] task-09: 前端 /admin/roles 页面 + 权限选择器组件（roles/page.tsx 列表 + Drawer；admin-role-permission-picker.tsx 按 Permission.group 折叠分组）
- [ ] task-10: 前端 /admin/organizations 页面 + 组织树组件（organizations/page.tsx 左树 + 右详情面板 + 编辑 Drawer；admin-organization-tree.tsx 递归渲染）
- [x] task-11: 前端 /admin/users 页面 + 用户编辑 Drawer 组件（users/page.tsx 列表 + 搜索 + 筛选；admin-user-drawer.tsx 组织/角色多选 + 登录权限 + is_platform_admin 开关）

## Wave 8（端到端验证）

- [x] task-12: 端到端验证（8 项关键路径：自保护/最后管理员/角色占用/组织占用/登录控制/会话撤销/审计覆盖/旧端点兼容；数据库空库+含数据双重迁移；alembic upgrade/downgrade 双向测试）

## Wave 9（部署）

- [ ] task-13: Docker 镜像重建 + 部署 + 健康检查（deploy/docker-compose.yml backend+frontend 重建 + force-recreate + 127.0.0.1:8000|3000 health 验证 + 容器内 grep 新代码确认）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | depends_on | blocks | 模块 |
|---|---|---|---|---|---|---|
| task-01 | Alembic 迁移：3 张新表 + 2 表扩展 | W1 | P0 | — | task-02, task-03 | backend/migrations |
| task-02 | Permission 扩展 + auth model/rbac 扩展 | W2 | P0 | task-01 | task-03, task-04, task-05 | backend/auth |
| task-03 | admin 骨架 + errors + seed + main 注册 | W3 | P0 | task-01, task-02 | task-04, task-05, task-06 | backend/admin + backend/core + backend/auth |
| task-04 | 角色管理后端 + 测试 | W4 | P0 | task-02, task-03 | task-06 | backend/admin |
| task-05 | 组织管理后端 + 测试 | W4 | P0 | task-02, task-03 | task-06 | backend/admin |
| task-06 | 用户管理迁移/扩展/兼容 + 测试 | W5 | P0 | task-04, task-05 | task-07, task-08 | backend/admin + backend/settings + backend/auth |
| task-07 | 前端鉴权 layout + 导航 + settings 剥离 | W6 | P0 | task-06 | task-09, task-10, task-11 | frontend_app + frontend_components |
| task-08 | 前端 admin API 客户端 + 测试 | W6 | P0 | task-06 | task-09, task-10, task-11 | frontend_lib |
| task-09 | 前端 /admin/roles + 权限选择器 | W7 | P1 | task-07, task-08 | task-12 | frontend_app + frontend_components |
| task-10 | 前端 /admin/organizations + 组织树 | W7 | P1 | task-07, task-08 | task-12 | frontend_app + frontend_components |
| task-11 | 前端 /admin/users + 编辑 Drawer | W7 | P1 | task-07, task-08 | task-12 | frontend_app + frontend_components |
| task-12 | 端到端验证 + 双向迁移测试 | W8 | P0 | task-09, task-10, task-11 | task-13 | 全栈 |
| task-13 | Docker 重建 + 部署 + 健康检查 | W9 | P0 | task-12 | — | deploy |

## 关键路径

```
W1: task-01
     ↓
W2: task-02
     ↓
W3: task-03
     ↓
W4: task-04 + task-05  (并行)
     ↓
W5: task-06
     ↓
W6: task-07 + task-08  (并行)
     ↓
W7: task-09 + task-10 + task-11  (三并行)
     ↓
W8: task-12
     ↓
W9: task-13
```

最长路径 9 层（W1→W2→W3→W4→W5→W6→W7→W8→W9），决定最短交付周期。并行节点：W4（2 个）+ W6（2 个）+ W7（3 个），共 7 个任务可分批并行，缩短总工期。

## 模块依赖关系

- backend/migrations ← 所有后端任务（task-01 先行）
- backend/auth ← backend/admin（admin 引用 auth 的 Permission / User / Role / require_permission）
- backend/settings → backend/admin（单向 forward，admin 不反向依赖 settings，规避循环 import）
- backend/admin ← backend/core（auth_deps / errors / audit_hooks / db）
- frontend_lib.admin ← frontend_app.admin/* + frontend_components.admin-*

## 全局验收标准

- [ ] `cd backend && pytest app/modules/admin/` 全绿（覆盖 task-04/05/06 三个测试文件）
- [ ] `cd backend && pytest app/modules/settings/ app/modules/auth/` 全绿（验证 task-06 forward 兼容不破坏现有测试）
- [ ] `cd backend && ruff check . && mypy app` 0 错误
- [ ] `cd frontend && pnpm test` 全绿（覆盖 admin API client + 组件 + 页面集成）
- [ ] `cd frontend && pnpm build` 0 错误（Next.js 编译 + ESLint 通过）
- [ ] Alembic `upgrade head` + `downgrade -1` 双向均成功
- [ ] 端到端 8 项关键路径全部通过（自保护 / 最后管理员 / 角色占用 / 组织占用 / 登录控制 / 会话撤销 / 审计覆盖 / 旧端点兼容）
- [ ] Docker 镜像重建后容器内 `app/modules/admin/` 目录存在且 grep 到关键标识
- [ ] `curl http://127.0.0.1:8000/api/health` + `curl http://127.0.0.1:3000/api/health` 返回 ok
- [ ] `curl -H "Authorization: Bearer <token>" http://127.0.0.1:8000/api/admin/roles` 返回角色列表
- [ ] 普通用户访问 `/admin/users` 自动重定向到 `/` + toast 提示
- [ ] 现有 settings 页面 UsersTab 已删除，左侧导航出现「系统管理」分组
- [ ] 旧链接 `/api/users` 经 forward 后响应字段与迁移前一致
