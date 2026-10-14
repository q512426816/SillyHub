---
author: qinyi
created_at: 2026-10-14 23:58:00
change: 2026-10-14-admin-server-status
---
# 任务清单（Tasks）— 2026-10-14-admin-server-status

<!-- 依据 design.md 文件变更清单与 plan.md Wave 编排拆分；实现+单测同卡，无仪式卡（聚焦回归并入 task-04 acceptance，全量验收归 verify 阶段） -->

- [x] task-01: 后端权限与鉴权——Permission 枚举新增 SYSTEM_STATUS_READ + 枚举计数锚 59→60 + health/router.py /system-status 挂 require_permission_any + test_health.py 三态用例（401/403/200） (depends_on: -)
  - target_files: backend/app/modules/auth/permissions.py, backend/app/modules/health/router.py, backend/tests/test_health.py, backend/tests/modules/auth/test_permissions.py
- [x] task-02: 前端页面与数据层——lib/health.ts 恢复 getSystemStatus() + /admin/server-status 页面（三卡 + 5s 轮询 + 失败降级）+ 页面组件测试 (depends_on: -)
  - target_files: frontend/src/lib/health.ts, NEW:frontend/src/app/(dashboard)/admin/server-status/page.tsx, NEW:frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx
- [x] task-03: 契约同步——导出 backend/openapi.json + pnpm gen:types 再生成 frontend api-types（Permission 联合类型收录 system_status:read） (depends_on: task-01)
  - target_files: backend/openapi.json, frontend/src/lib/api-types.ts
- [x] task-04: 菜单注册与锚重算——menu-permissions.ts system 组新增 server-status + app-shell MENU_ICON_MAP（Server 图标）+ admin/menus 测试断言（5 行→6 行）与声明序锚注释重算 + 聚焦回归（后端 test_health + 前端新页面/admin-menus 测试 + tsc/eslint） (depends_on: task-02, task-03)
  - target_files: frontend/src/lib/menu-permissions.ts, frontend/src/components/app-shell.tsx, frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx
