---
author: flow-machine-draft
created_at: 2026-10-08T02:13:50.083Z
---
# 任务注册表（Tasks）— 2026-10-08-menu-permissions-page-audit

- [x] task-01: 上述 7 个菜单卡 permissions 各自补齐缺口权限（既有 key 不删、门控主 key 保持首位）——menu-permissions.ts：components+workspace:read、changes+task:read、knowledge+knowledge:write、mcp+settings:admin、approvals+task:read+task:run_agent、audit+change:read、incidents+deploy:staging——验证：menu-permissions.test.ts 注册表用例绿
- [x] task-02: 每个新增 key 有后端端点消费依据（router 文件级引用）——各菜单卡注释已落：workspace/router.py list_components、task/router.py TASK_READ、knowledge/router.py 8 处 WRITE、mcp_registry/router.py settings_admin_check、agent/router agent-sessions+dialogs、workflow/router.py list_audit_logs CHANGE_READ、incident/router.py DEPLOY_STAGING——验证：本行即记录（静态注释）
- [x] task-03: menu-permissions 相关测试同步更新并全绿——changes/audit 用例加新 key、mcp 用例加 settings:admin、6 子菜单用例 components 豁免 workspace:read 断言——验证：5 测试文件 96 用例全绿
- [x] task-04: tsc 与改动文件 eslint 零新增报错——pnpm typecheck 零输出、eslint 两改动文件 0 error 0 warning——验证：本行即记录
