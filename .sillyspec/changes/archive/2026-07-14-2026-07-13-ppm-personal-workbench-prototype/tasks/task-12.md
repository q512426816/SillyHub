---
id: task-12
title: "前端 api-types 重生成（UserRead.employee_no）+ 类型对齐 + frontend lint/typecheck/test（覆盖：FR-02）"
title_zh: "前端类型重生成与全量校验"
author: qinyi
created_at: 2026-07-14 09:27:18
priority: P0
depends_on: [task-01, task-09, task-10, task-11]
blocks: [task-13]
requirement_ids: [FR-02]
decision_ids: []
allowed_paths:
  - frontend/src/lib/api-types.ts
expects_from:
  - contract: UserRead
    needs: [employee_no]
goal: >
  task-01 后端 UserRead 加 employee_no 之后，重新生成前端 api-types.ts 让生成类型含 employee_no；对齐 workbench 手写类型与生成类型冲突点；跑通 frontend lint/typecheck/test 全绿，为 task-13 e2e 清除类型层阻塞。
implementation:
  - "前置确认：task-01 已落地（auth/schema.py UserRead 含 employee_no: str | None；auth/model.py User ORM 加列；migration 已写）。本 task 依赖后端 schema 变更，若 task-01 未完成则此 task 无法生成出 employee_no 字段——先核 task-01 状态再继续。"
  - "重新生成 api-types.ts（frontend 目录）：命令 `pnpm gen:types`（= `node scripts/gen-api-types.mjs`，gen-api-types.mjs 内部先 `cd backend && uv run python scripts/dump_openapi.py` 刷新 backend/openapi.json，再用 `openapi-typescript` 生成 frontend/src/lib/api-types.ts，一条命令 dump + 生成，跨平台）；或直接 `node scripts/gen-api-types.mjs`（等价，脚本同上）。"
  - "生成后 grep 确认 `app__modules__auth__schema__UserRead`（api-types.ts 当前在 ~L13647）的 properties 含 `employee_no`；同时确认 `MeResponse`（~L8466，MeResponse 继承/含 UserRead 字段，design §5 Wave0「MeResponse 自动带上」）也带 employee_no。"
  - "类型对齐（若冲突）：workbench 域手写类型在 lib/ppm/types.ts（task-07 产出 WorkbenchProfile 含 employee_no: string | null），与平台生成类型 api-types.ts（UserRead.employee_no: string | null）字段语义一致但分属两套类型体系；按 design §前端类型策略「PPM 域手写类型（types.ts）与平台生成类型（api-types.ts）并存，不强行统一」处理——即不把手写 WorkbenchProfile 改成引用生成类型，两套并存。"
  - "仅当某处既有手写类型又 import 了生成类型且字段冲突（如 ProfileSummaryCard 组件 task-09 同时用到 user.employee_no 与 WorkbenchProfile.employee_no）时，统一字段名/可空性（都 string | null），不强行合并类型来源。"
  - "若 task-09~11 组件用到 useSession() 返回的 user 对象（生成类型），其 employee_no 新字段可直接读；若旧代码假设 user 无该字段需补可选链。"
  - "全量校验（frontend 目录，依次跑）：`pnpm lint`（= `next lint`，ESLint）；`pnpm typecheck`（= `tsc --noEmit`，TS 类型检查）；`pnpm test`（= `vitest run`，单元测试）。"
  - "修复全部错误：重点查 api-types 重生成后是否引入 breaking（如某接口返回类型变了导致消费方类型不匹配），workbench 新增组件（task-09~11）是否类型对齐。"
  - "若 vitest 出现与 api-types 无关的预存失败（非本变更引入），记录到 constraints/遗留，不强行修测试（CLAUDE.md 规则9）。"
acceptance:
  - "frontend/src/lib/api-types.ts 中 app__modules__auth__schema__UserRead 的 properties 含 employee_no（string | null 可空）。"
  - "MeResponse 相应带 employee_no（task-01 落地后自动带上）。"
  - "`pnpm lint` 通过（无 ESLint error）。"
  - "`pnpm typecheck` 通过（tsc --noEmit 零错误）。"
  - "`pnpm test` 通过（vitest run 全绿，或仅剩与本变更无关的预存失败已记录）。"
  - "无类型回归：重生成未破坏其他消费 UserRead/MeResponse 的页面（如 settings/profile 类页面）。"
verify:
  - "cd frontend && node scripts/gen-api-types.mjs"
  - "cd frontend && pnpm lint"
  - "cd frontend && pnpm typecheck"
  - "cd frontend && pnpm test"
constraints:
  - "仅重生成 + 类型对齐，不改业务逻辑（不动 workbench service/router/组件实现，仅修类型层冲突）。"
  - "PPM 域手写类型（lib/ppm/types.ts）与平台生成类型（api-types.ts）并存，不强行统一类型来源（design §前端类型策略）。"
  - "用 `pnpm gen:types`（= gen-api-types.mjs：dump openapi.json + openapi-typescript 一条命令），不手改 api-types.ts（生成产物，手改会被下次重生成覆盖）。"
  - "非测试逻辑本身有误时禁止改测试「通过」（CLAUDE.md 规则9）；预存失败记录遗留不在本 task 修。"
  - "重生成依赖 task-01 后端 schema 变更已合入；若后端起不来（dump_openapi.py 失败），先查 backend uv 环境与 task-01 落地。"
---
