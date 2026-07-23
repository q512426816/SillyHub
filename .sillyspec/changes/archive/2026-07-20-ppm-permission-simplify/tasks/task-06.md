---
id: task-06
title: admin-role-permission-picker 适配确认 + sillyhub-daemon/src/api-types.ts 重新生成（覆盖：FR-07, D-004@v1）
title_zh: 确认 admin 权限选择器不再列被删权限 + 重生成 daemon API 类型产物
author: qinyi
created_at: 2026-07-20 13:12:48
priority: P1
depends_on: [task-04]
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-004@v1]
allowed_paths:
  - frontend/src/components/admin-role-permission-picker.tsx
  - sillyhub-daemon/src/api-types.ts
goal: >
  确认删 17 个 ppm 操作权限后 admin 角色权限选择器不再列出它们，并重新生成 sillyhub-daemon/src/api-types.ts 使派生产物与后端 OpenAPI schema 同步（diff 只含 ppm 权限相关变化）。
provides: []
expects_from: []
implementation:
  - "读 frontend/src/components/admin-role-permission-picker.tsx 确认数据源：本任务调研已核实——picker 完全消费 frontend/src/lib/menu-permissions.ts 的 MENU_PERMISSION_GROUPS（按 section/menuKey/permissions.key 渲染），不读后端 Permission 枚举、不读 OpenAPI、不读 api-types.ts。故 picker 本身零代码改动，仅在 acceptance 标注确认。"
  - "确认 picker 不会因 task-03 删 ppm-project-members 的 { key: 'ppm:project:write' } 条目而显示异常：picker 按权限 key 列 checkbox，project-members 菜单在 task-03 后只剩 ppm:project:read，picker 渲染该菜单时 permissions.length 从 2→1，渲染逻辑（renderMenu / selectedCount / indeterminate）对 length==1 已正确处理，无空数组/全选边界 bug。"
  - "刷新后端 OpenAPI schema：在 backend 目录跑 `uv run python scripts/dump_openapi.py`（或前端 `pnpm gen:types` 联动刷新 backend/openapi.json）。task-04 删枚举成员后 schema 中的 Permission enum PPM_* 取值才会从 25 个变 8 个（api-types.ts:9016 当前含 ppm:project:write/delete/export 串即来自此 enum）。"
  - "重生成 daemon 类型：在 sillyhub-daemon 目录跑 `pnpm gen:types`（即 node scripts/gen-api-types.mjs，读 backend/openapi.json 用 openapi-typescript 产出 src/api-types.ts）。脚本不重新 dump openapi.json，故上一步必须先执行。"
  - "核对 git diff 只含 ppm 权限相关变化：`git diff sillyhub-daemon/src/api-types.ts` 应只见 Permission enum PPM_* 取值减少 + 若有端点签名/响应 schema 副作用仅限 ppm；若出现大量无关 diff（其他模块 enum/schema 漂移）则评估是否本变更引入，若非本变更引入则跳过重生成（R-03，api-types 是派生产物不阻塞主流程），并在 verify 笔记记录跳过原因。"
acceptance:
  - "picker 源码无改动（数据源是 menu-permissions.ts 而非枚举/OpenAPI）；确认 task-03 已删 project-members 的 ppm:project:write 后 picker 渲染该菜单正确（length==1 无空状态）。"
  - "api-types.ts 中 `grep -rn 'ppm:project:write|ppm:project:delete|ppm:project:export'` 零命中（当前 line 9016 命中，重生成后应消失）。"
  - "api-types.ts 的 git diff 经核对只含 ppm 权限相关变化，或无关 diff 已评估为可接受/非本变更引入并记录。"
  - "frontend `pnpm typecheck` 通过；sillyhub-daemon `pnpm typecheck` 通过（重生成后类型对得上）。"
verify:
  - "cd frontend && pnpm typecheck"
  - "cd sillyhub-daemon && pnpm typecheck"
  - "grep -rn 'ppm:project:write\\|ppm:project:delete\\|ppm:project:export' sillyhub-daemon/src/api-types.ts （期望无输出）"
  - "cd backend && uv run python scripts/dump_openapi.py （task-04 后刷新 schema；或前端 pnpm gen:types 联动）"
  - "cd sillyhub-daemon && pnpm gen:types:check （重生成 + git diff --exit-code 守门，确认 diff 干净）"
constraints:
  - "依赖 task-04：只有 backend Permission 枚举 PPM_* 成员先删（task-04），OpenAPI schema 才会变，重生成 api-types 才有 ppm 相关 diff。"
  - "picker 数据源是 menu-permissions.ts（非枚举/OpenAPI），故本任务对 admin-role-permission-picker.tsx 零代码改动，仅确认；menu-permissions.ts 的实际清理在 task-03（本任务 allowed_paths 不含它，只引用确认）。"
  - "api-types.ts 是派生产物（从 backend/openapi.json 生成），若重生成引入大量无关 diff（R-03）则跳过重生成不阻塞主流程，并在 verify 笔记记录跳过原因。"
  - "gen-api-types.mjs 不重新 dump openapi.json（只消费已存在的 backend/openapi.json），故必须先在 backend 跑 dump_openapi.py 或前端 gen:types 刷新 schema，再跑 daemon gen:types。"
  - "picker 当前默认全展开（expandedMenus 初始为所有 MENU_PERMISSION_GROUPS menuKey），task-07 展开态断言依赖此行为，本任务不改 picker 不影响。"
---

## 任务说明

本任务是 Wave 3 收尾（依赖 task-04），确认前端 admin 权限选择器适配 + 重生成 daemon API 类型产物。

### 调研结论（已核实）

1. **picker 数据源**：`frontend/src/components/admin-role-permission-picker.tsx` 第 5-11 行 import `MENU_PERMISSION_GROUPS / MENU_SECTION_LABEL / MENU_SECTION_ORDER` from `@/lib/menu-permissions`，渲染时遍历 `MENU_SECTION_ORDER` → 过滤 `MENU_PERMISSION_GROUPS` → 对每个 menu 的 `permissions[]` 列 checkbox。**完全消费 menu-permissions.ts，不读后端 Permission 枚举、不读 OpenAPI、不读 api-types.ts**。故 picker 零代码改动，删枚举（task-04）对它无直接影响；真正影响它的是 task-03（删 ppm-project-members 的 ppm:project:write 条目）。

2. **api-types 生成链**：`sillyhub-daemon/scripts/gen-api-types.mjs` 读 `backend/openapi.json`（由 `backend/scripts/dump_openapi.py` 产出），用 `openapi-typescript` 生成 `sillyhub-daemon/src/api-types.ts`。package.json 提供 `gen:types`（生成）和 `gen:types:check`（生成 + git diff --exit-code 守门）两个 script。

3. **api-types 当前含被删权限**：`grep` 确认 `sillyhub-daemon/src/api-types.ts:9016` 命中 `ppm:project:write/delete/export`，即 Permission enum 的 PPM_* 取值已进 OpenAPI schema。task-04 删枚举后重生成，这些取值会从 api-types 消失。

### 执行步骤

1. 读 picker（已在本调研完成，零改动）。
2. task-04 完成后，在 backend 刷新 OpenAPI：`uv run python scripts/dump_openapi.py`。
3. 在 sillyhub-daemon 重生成：`pnpm gen:types`。
4. 核对 diff + 跑 verify 命令。

### 风险

- R-03：若重生成 diff 含大量无关变化（其他模块 schema 漂移累积），评估非本变更引入则跳过重生成、记录原因，不阻塞主流程。
