---
id: task-08
title: menu-permissions 技能管理菜单放开为所有登录用户可见
title_zh: 技能管理菜单对所有登录用户可见
author: qinyi
created_at: 2026-07-31 22:41:43
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-003]
allowed_paths:
  - frontend/src/lib/menu-permissions.ts
---

## 目标
技能管理菜单去掉 `settings:admin` 门槛，所有登录用户都能在侧边栏看到（D-003 权限放宽到任意登录用户；修复前后端权限不一致 bug——后端 task-03 已放开，前端须对齐）。

## 实现要点
- 现状（menu-permissions.ts:204-215）：`menuKey: "skills"` 这一项的 `permissions: [{ key: "settings:admin", name: "平台设置管理" }]`，非 settings:admin 用户看不到该菜单。
- 放开：把 `permissions` 改为「登录即可见」语义。具体实现二选一（execute 时选与现有机制最契合的）：
  1. `permissions: []`（空数组）——若 `canSeeMenu` 约定为空数组=无需任何权限=登录即可见。
  2. 引入一个登录态标识（如检查现有菜单无先例则倾向方案 1，最小改动）。
- 不动同组其它菜单项（`mcp` 仍保留 settings:admin，`llm-providers` 仍 llm_provider:read 等）。
- 更新该项的注释，说明「D-003 技能管理对登录用户放开，后端 custom-skills 端点已任意登录可调」。
- 在改之前先 grep `canSeeMenu` / `hasAnyPermission` 实现，确认空数组语义（避免误判=全拒或=全显错方向）。

## 验收
- 非管理员登录用户侧边栏能看到「技能管理」菜单，点击进入 `/settings/skills`。
- `mcp` 菜单仍仅 settings:admin 可见（未受影响）。
- 现有前端单测过（如有 menu-permissions 断言）；typecheck 过。
