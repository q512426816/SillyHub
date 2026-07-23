---
id: task-04
title: 3 处测试同步
title_zh: test_ppm_permissions EXPECTED + test_permissions count + menu-permissions.test.ts mirror 同步
author: qinyi
created_at: 2026-07-20 14:58:00
priority: P0
depends_on: [task-01, task-03]
blocks: []
requirement_ids: [FR-06]
decision_ids: []
allowed_paths:
  - backend/tests/modules/auth/test_ppm_permissions.py
  - backend/tests/modules/auth/test_permissions.py
  - frontend/src/lib/__tests__/menu-permissions.test.ts
goal: >
  同步 3 处测试到枚举扩容后状态：test_ppm_permissions EXPECTED 8→17、
  test_permissions count 53→62、menu-permissions.test.ts mirror 54→63 及各菜单专属 key 断言。
provides: []
expects_from: []
implementation:
  - test_ppm_permissions.py：EXPECTED_PPM_PERMISSIONS 加 9 个新成员（共 17 项，14 菜单 key + 3 悬空旧 key）；count 断言 8→17（test_ppm_permission_member_count_is_8→_is_17，docstring+断言）。
  - test_permissions.py：test_permission_count_is_53→_is_62（docstring 更新：45 历史 + 17 PPM = 62；断言 ==62）。
  - menu-permissions.test.ts：BACKEND_PERMISSION_KEYS mirror 加 9 个新 key（总 54→63，PPM 8→17）；长度断言 54→63；各菜单专属 key 断言改——project-members=[project-member:read]、project-stakeholders=[project-stakeholder:read]、project-plans=[project-plan:read]、plan-nodes=[plan-node:read]、milestone-details=[milestone-detail:read]、problem-list=[problem-list:read]、problem-changes=[problem-change:read]、workbench=[workbench:view]、task-plans=[task-plan:read]；projects/customers/work-hours/work-hour-statistics/kanban 断言不变（保留 key）。
acceptance:
  - test_ppm_permissions 全绿（17 成员存在、count=17、platform_admin 拥有全部）。
  - test_permissions count=62 通过。
  - menu-permissions.test.ts 全绿（mirror=63、各菜单专属 key 断言）。
verify:
  - cd backend && uv run pytest tests/modules/auth/test_ppm_permissions.py tests/modules/auth/test_permissions.py -q
  - cd frontend && pnpm exec vitest run src/lib/__tests__/menu-permissions.test.ts
constraints:
  - 各菜单断言严格按 design §5 映射表。
  - mirror 是 backend 枚举镜像，须含全部 17 PPM 成员（含 3 悬空）。
---

## 验收标准

- 3 测试文件全绿（EXPECTED=17/count=62/mirror=63）
