---
author: WhaleFall
created_at: 2026-09-20 18:00:00
---

# 任务清单（Tasks）

- [x] task-01: rbac.has_permission 判定链收紧——带 workspace_id 时平台级段仅 platform:admin 放行（is_platform_admin 短路与 workspace_id=None 入口路径行为不变）
- [x] task-02: 列表端点 list_workspaces 平台分支收窄为仅 platform:admin（docstring 同步改写 ql-20260917-007 段落）(depends_on: task-01)
- [x] task-03: list_user_ids_with_permission 段 2 匹配权限收窄为仅 admin_perm（通知收件人对齐）(depends_on: task-01)
- [x] task-04: 反转 test_platform_grant_list.py 断言为新技术义 + 三口径一致性断言 (depends_on: task-01, task-02, task-03)
- [x] task-05: 新增 auth 判定链收紧专项测试 test_rbac_workspace_scope.py (depends_on: task-01)
- [x] task-06: 存量测试回归——扫描依赖平台级穿透的既有断言并同步修正（仅跑相关测试）(depends_on: task-01, task-02, task-03, task-04, task-05)
