---
id: task-06
title: "前端 gen-api-types 重新生成 + lib/auth.ts changePassword"
title_zh: 前端 API 类型与 changePassword 函数
author: WhaleFall
created_at: 2026-07-15 11:24:44
priority: P0
depends_on: [task-04]
blocks: [task-07]
requirement_ids: [FR-01]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - frontend/src/lib/auth.ts
expects_from:
  task-04:
    - contract: "POST /api/auth/change-password"
      needs: [old_password, new_password]
provides:
  - contract: changePassword
    fields: [oldPassword, newPassword]
goal: >
  重新生成前端 api-types（含 ChangePasswordRequest）+ 在 lib/auth.ts 新增 changePassword 函数。
implementation:
  - 跑 scripts/gen-api-types.mjs 重新生成 frontend/src/lib/api-types.ts（含 ChangePasswordRequest）
  - 在 frontend/src/lib/auth.ts 新增 changePassword(oldPassword, newPassword)，用 apiFetch 调 POST /api/auth/change-password（json 传 old_password + new_password，完整代码见正文）
acceptance:
  - api-types.ts 含 ChangePasswordRequest 类型
  - changePassword 函数存在且类型正确
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - api-types 全量重生，不手写类型
  - 风格对齐既有 login()（apiFetch + json）
---

# task-06：前端 API 类型与 changePassword 函数

## 依据
- design.md §5.2（前端 API 函数）、§13 文件清单、D-002（body 只收 old_password + new_password）
- 既有代码：`frontend/src/lib/auth.ts` 中 `login()` 用 `apiFetch(url, { method:"POST", json:{...} })` 风格，已确认真实
- 类型来源：`frontend/src/lib/api-types.ts` 由 `scripts/gen-api-types.mjs` 从后端 OpenAPI 自动生成（auth.ts 顶部注释明确）

## 实现要点
1. 后端 task-04 落地 `ChangePasswordRequest` + `POST /api/auth/change-password` 后，跑 `node scripts/gen-api-types.mjs`（或对应 pnpm 脚本）全量重生 `api-types.ts`，`ChangePasswordRequest` 自动出现，不手写。
2. 在 `auth.ts` 末尾新增：
   ```ts
   export async function changePassword(oldPassword: string, newPassword: string) {
     await apiFetch("/api/auth/change-password", {
       method: "POST",
       json: { old_password: oldPassword, new_password: newPassword },
     });
   }
   ```
   端点返回 204 无 body，故不接返回值、不加 `<T>` 泛型。

## 验收（AC）
- `api-types.ts` 含 `ChangePasswordRequest`（old_password + new_password）
- `changePassword` 函数签名 `(oldPassword: string, newPassword: string) => Promise<void>`
- `pnpm exec tsc --noEmit` 通过

## 约束
- api-types 全量重生，禁止手写类型（R-004）
- 风格对齐 `login()`（apiFetch + json）
