---
id: task-05
title: openapi 重生成 + platform_admin 补种验证 + picker 数据源确认
title_zh: openapi.json 重生成 ppm 枚举 17 + 验证 seed 兜底补 9 新 key + 确认 picker 数据源
author: qinyi
created_at: 2026-07-20 14:58:00
priority: P1
depends_on: [task-01, task-02]
blocks: []
requirement_ids: [FR-04, FR-07, FR-08]
decision_ids: [D-003]
allowed_paths:
  - backend/openapi.json
goal: >
  重生成 backend/openapi.json（ppm 权限枚举含 17 值）；验证 seed_platform_admin_role 启动兜底
  给 platform_admin 补 9 个新 key；确认 admin-role-permission-picker 数据源（menu-permissions.ts 按菜单卡渲染 vs 枚举），判定悬空 3 旧 key 是否显示。
provides: []
expects_from: []
implementation:
  - cd backend && uv run python scripts/dump_openapi.py 重生成 openapi.json，核对 ppm 权限枚举含 17 值。
  - 运行 seed_platform_admin_role 相关测试（test_platform_admin_seed_grants_all_ppm_permissions）确认 platform_admin 拥有 17 个 PPM key（含 9 新增）—— 已由 task-04 的 test_ppm_permissions 覆盖，此处确认。
  - 读 frontend/src/components/admin-role-permission-picker.tsx，确认数据源（读 menu-permissions.ts 的 MENU_PERMISSION_GROUPS 按菜单卡渲染，还是直接列 Permission 枚举）；据此判定悬空 3 旧 key（plan/problem/task:read）是否在 picker 显示。
acceptance:
  - openapi.json ppm 权限枚举含 17 值（8 旧 + 9 新）。
  - platform_admin seed 后拥有 17 个 PPM key。
  - picker 数据源确认并记录（悬空 key 显示与否结论）。
verify:
  - cd backend && uv run python scripts/dump_openapi.py && grep -c "ppm:workbench:view\|ppm:project-member:read\|ppm:task-plan:read" openapi.json
constraints:
  - openapi.json 重生成只接受 ppm 权限相关 diff（R-03 若无关 diff 过多则回退 api-types，但 openapi.json 每提交重生成约定保留）。
  - picker 确认不改动 picker 代码（只读判定）。
---

## 验收标准

- openapi ppm 枚举 17 值
- platform_admin 补种验证通过
- picker 数据源 + 悬空 key 显示结论记录
