---
id: task-03
title: 前端 menu-permissions.ts project-members 菜单删悬空 ppm:project:write 条目（覆盖：FR-06, D-001@v1）
title_zh: 前端 project-members 菜单清理悬空的 ppm:project:write 权限引用
author: qinyi
created_at: 2026-07-20 13:12:48
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/lib/menu-permissions.ts
goal: >
  删除 menu-permissions.ts 中 ppm-project-members 菜单条目里将随枚举精简失效的 ppm:project:write 引用，菜单显隐改由 ppm:project:read 单独控制，菜单粒度与可见性语义不变。
implementation:
  - 定位 frontend/src/lib/menu-permissions.ts 中 menuKey="ppm-project-members" 的条目（当前 L354-366）。
  - 删除该条目 permissions 数组中的 `{ key: "ppm:project:write", name: "项目编辑" }` 条目，permissions 仅保留 `[{ key: "ppm:project:read", name: "项目查看" }]`。
  - 同步更新该条目上方注释（当前 L361 注释为"成员管理复用 project:write（后端 project router 成员端点 require PPM_PROJECT_WRITE）"），改为说明显隐仅由 ppm:project:read 控制（task-01 后端成员端点已改为仅认证，不再 require PPM_PROJECT_WRITE）。
  - 不改动该条目其他字段（section/menuKey/menuLabel/icon/href/absolute/matchPattern）及任何其他 ppm/overview/management/admin/system 菜单条目。
acceptance:
  - ppm-project-members 菜单条目的 permissions 数组只含 `{ key: "ppm:project:read", name: "项目查看" }` 一项。
  - menu-permissions.ts 全文 grep `ppm:project:write` 零命中（含数组条目与注释）。
  - 持有 ppm:project:read 的非 admin 用户经 canSeeMenu 判定仍可见该菜单（canSeeMenu → hasAnyPermission 任一命中即 true，permission.ts L43/L57，已核实）。
  - ppm-project-members 菜单条目其余字段原样保留；MENU_PERMISSION_GROUPS 数组长度与 ppm section 条目数不变。
verify:
  - `cd frontend && pnpm typecheck`（应通过，无类型回归）
  - `grep -n "ppm:project:write" frontend/src/lib/menu-permissions.ts`（应无输出）
constraints:
  - 不改 ppm section 其他 13 个菜单条目（ppm-workbench / ppm-projects / ppm-customers / ppm-project-stakeholders / ppm-project-plans / ppm-plan-nodes / ppm-milestone-details / ppm-problem-list / ppm-problem-changes / ppm-task-plans / ppm-work-hours / ppm-work-hour-statistics / ppm-kanban）。
  - 不改菜单粒度（不合并、不增减菜单条目，不改 menuKey/menuLabel/href）。
  - 不改 frontend/src/lib/permission.ts 的 canSeeMenu / hasAnyPermission 逻辑（任一命中即可见的语义保持不变）。
  - 不动 MENU_PERMISSION_GROUPS 顺序、MENU_SECTION_ORDER、MENU_SECTION_LABEL。
  - 不动 PermissionItem / MenuPermissionGroup 类型定义，不改 ppm section 顶部 L317-321 的 section 注释（除 ppm-project-members 自身条目内注释外）。
---

## 背景与依据

- design.md §5 Phase 5（D-001）：project-members 菜单（L362-365）删除悬空的 `{ key: "ppm:project:write" }`，只留 `ppm:project:read`；canSeeMenu 任一命中，有 read 即可见。
- design.md §11 决策 D-001@v1：project-members 菜单悬空 ppm:project:write 引用清理，覆盖于 §5/§6。
- plan.md Wave 1 task-03：menu-permissions.ts L362-365，菜单显隐不变。
- 源码核实：
  - `frontend/src/lib/menu-permissions.ts` L353-366 ppm-project-members 条目，permissions 当前含 `ppm:project:read` + `ppm:project:write`；L361 注释"成员管理复用 project:write（后端 project router 成员端点 require PPM_PROJECT_WRITE）"。
  - `frontend/src/lib/permission.ts` L33-58：`hasAnyPermission` 用 `perms.some` 任一命中即 true，`is_platform_admin` 短路；`canSeeMenu` 调用它。删 write 后持 read 用户仍可见，逻辑无需改动。

## 为什么 ppm:project:write 会悬空

task-04（W2）将 `backend/app/modules/auth/permissions.py` 删除 17 个 PPM_* 操作权限枚举成员，含 `PPM_PROJECT_WRITE`（即 `ppm:project:write`）。本任务提前清理前端对它的引用，避免 menu-permissions.ts 出现指向已删除枚举值的悬空 key（picker 渲染、权限校验都会读到无效 key）。本任务与 task-04 无数据依赖（都改不同文件），故列入 Wave 1。
