---
id: task-10
title: 前端 CustomSkillRead.created_by 类型收窄
title_zh: 前端自定义技能 created_by 类型从可空收窄为必填
author: qinyi
created_at: 2026-07-31 22:40:05
priority: P1
depends_on: [task-05]
blocks: []
requirement_ids: [FR-04]
decision_ids: []
allowed_paths:
  - frontend/src/lib/custom-skills.ts
---

## 目标
将 `frontend/src/lib/custom-skills.ts` 中 `CustomSkillRead.created_by` 的 TS 类型从 `string | null` 收窄为 `string`，与后端 task-05（schema `uuid.UUID | None` → `uuid.UUID`）对齐。per-user 归属（D-001）下 created_by 必有值，前端不应再保留 null 语义。同时处理 task-05 排查发现的前端 null 默认引用。

## 实现要点
- 修改 `CustomSkillRead` 接口（custom-skills.ts:27）：`created_by: string | null` → `created_by: string`。
- 排查 task-05 发现的 null 默认：grep `created_by: null` / `created_by: undefined` 在 lib/custom-skills.ts 及其测试 mock（含 `frontend/src/app/(dashboard)/settings/skills/__tests__/page.test.tsx`），将不合法的 null 默认改为合法 string（用户 id 字符串）。
- `CustomSkillDetail extends CustomSkillRead` 自动跟随收窄，无需单独改。
- 此 task 仅收窄类型 + 修 null 引用，不动 CRUD 逻辑（CRUD 由 task-09 负责）。
- 覆盖 Grill gap#5（类型收窄排查的前端落地）。

## 验收
- `pnpm --filter frontend tsc --noEmit` 通过（typecheck 绿）。
- grep 无 `created_by: null` / `created_by: undefined` 默认残留。
- 前端单测 mock 数据 created_by 字段为合法 string。
