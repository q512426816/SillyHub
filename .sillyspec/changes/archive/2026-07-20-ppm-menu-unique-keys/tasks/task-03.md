---
id: task-03
title: frontend menu-permissions.ts 14 菜单 key 重映射
title_zh: 14 个 PPM 菜单的 permissions 改为各自专属 key
author: qinyi
created_at: 2026-07-20 14:58:00
priority: P0
depends_on: []
blocks: [task-04]
requirement_ids: [FR-02]
decision_ids: [D-001, D-002]
allowed_paths:
  - frontend/src/lib/menu-permissions.ts
goal: >
  把 frontend/src/lib/menu-permissions.ts 的 14 个 PPM 菜单的 permissions 数组按 design §5
  映射表改为各自专属 key（单元素数组），使无 2 个菜单共享同一 key。
provides: []
expects_from: []
implementation:
  - 按 design §5 映射表改 14 个菜单的 permissions（每菜单一个专属 key 单元素数组）：
    ppm-workbench→ppm:workbench:view；ppm-projects→ppm:project:read(保留)；
    ppm-customers→ppm:customer:read(保留)；ppm-project-members→ppm:project-member:read；
    ppm-project-stakeholders→ppm:project-stakeholder:read；ppm-project-plans→ppm:project-plan:read；
    ppm-plan-nodes→ppm:plan-node:read；ppm-milestone-details→ppm:milestone-detail:read；
    ppm-problem-list→ppm:problem-list:read；ppm-problem-changes→ppm:problem-change:read；
    ppm-task-plans→ppm:task-plan:read；ppm-work-hours→ppm:work-hour:read(保留)；
    ppm-work-hour-statistics→ppm:work-hour:stat(保留)；ppm-kanban→ppm:kanban:view(保留)。
  - 每个 permissions 的 name 字段保持/更新为菜单对应中文名（如 项目成员→"项目成员查看"）。
  - 菜单数不变（仍 14 PPM 菜单），menuKey/menuLabel/icon/href/matchPattern 不动。
acceptance:
  - 14 菜单 permissions 各 1 专属 key，无 2 菜单共享同一 key。
  - pnpm typecheck 通过。
verify:
  - cd frontend && pnpm typecheck
constraints:
  - 只改 permissions 数组，不动菜单结构/menuKey/href。
  - 保留 5 个 key（project/customer/work-hour:read/work-hour:stat/kanban:view）给对应菜单。
---

## 验收标准

- 14 菜单各 1 专属 key 无共享
- typecheck 通过
