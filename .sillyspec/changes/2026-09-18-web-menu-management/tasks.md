---
author: WhaleFall
created_at: 2026-09-18 14:35:00
---
# 任务清单（Tasks）

- [x] task-01: 后端 Permission 枚举新增 5 项 + group 前缀映射（skill/mcp/agent_profile/agent_session→AGENT）
- [x] task-02: MenuOverride 表模型（admin/model.py）+ schema（admin/schema.py）
- [x] task-03: 迁移：建 menu_overrides 表 + 种子（4 新权限 key 授全部现存角色）(depends_on: task-01, task-02)
- [x] task-04: menu_overrides_service（list/upsert/delete + 审计 + label/sort 校验）(depends_on: task-01, task-02)
- [x] task-05: menu_overrides_router 子路由三端点（GET 认证 / PUT/DELETE menu:admin）+ main.py 挂载 (depends_on: task-04)
- [x] task-06: 后端测试（CRUD/403/422/审计/孤儿容忍/种子迁移断言）(depends_on: task-03, task-04, task-05)
- [x] task-07: pnpm gen:types 重跑（backend/openapi.json + frontend/src/lib/api-types.ts）(depends_on: task-01, task-05)
- [x] task-08: menu-permissions.ts——4 菜单补 permissions 去 pickerHidden、新增 menus 菜单项、key 类型收紧为 Permission 联合类型 (depends_on: task-07)
- [x] task-09: lib/menu-overrides.ts——useMenuOverrides（失败空覆盖直通）+ mergeMenus 纯函数（含 menus 豁免）(depends_on: task-07)
- [x] task-10: app-shell 渲染经 mergeMenus + 图标映射补 /admin/menus (depends_on: task-08, task-09)
- [x] task-11: /admin/menus 管理页（对照原型：分组表格/行内改名/上移下移/隐藏开关/权限+持有角色展开/role:read 降级）(depends_on: task-07, task-08, task-09)
- [x] task-12: 前端测试（merge 纯函数单测 + 管理页交互测试 + permission.test 与 menu-permissions.test 断言同步）(depends_on: task-10, task-11)
- [x] task-13: 文档与部署说明（模块文档 auth/admin/frontend_lib 增量 + 权限缓存 TTL 部署注记）(depends_on: task-12)
- [x] ql-20260920-001-cfcc 09-18-web-menu-management
- [x] ql-20260920-002-9be6 09-18-web-menu-management
