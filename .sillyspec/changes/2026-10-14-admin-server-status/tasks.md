---
author: qinyi
created_at: 2026-10-14 23:58:00
change: 2026-10-14-admin-server-status
---
# 任务清单（Tasks）— 2026-10-14-admin-server-status

<!-- 依据 design.md 文件变更清单与 Wave 编排拆分；实现+单测同卡，无仪式卡 -->

- [ ] task-01: 后端权限与鉴权——Permission 枚举新增 SYSTEM_STATUS_READ + health/router.py /system-status 挂 require_permission_any + test_health.py 三态用例（401/403/200） (depends_on: -)
- [ ] task-02: 前端页面与数据层——lib/health.ts 恢复 getSystemStatus() + /admin/server-status 页面（三卡 + 5s 轮询 + 失败降级）+ 页面组件测试 (depends_on: -)
- [ ] task-03: 契约同步——导出 backend/openapi.json + pnpm gen:types 再生成 frontend api-types（Permission 联合类型收录 system_status:read） (depends_on: task-01)
- [ ] task-04: 菜单注册与锚重算——menu-permissions.ts system 组新增 server-status + app-shell MENU_ICON_MAP（Server 图标）+ admin/menus 测试断言（5 行→6 行）与声明序锚注释重算 (depends_on: task-03)
- [ ] task-05: 聚焦验收——后端 test_health.py + 前端页面/admin-menus 测试全绿，tsc/eslint 零错 (depends_on: task-02, task-04)
