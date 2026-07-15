---
id: task-09
title: "account/page.test.tsx 表单组件测试"
title_zh: 个人中心页表单测试
author: WhaleFall
created_at: 2026-07-15 11:24:44
priority: P1
depends_on: [task-07]
blocks: [task-10]
requirement_ids: [FR-07]
allowed_paths:
  - frontend/src/app/(dashboard)/account/page.test.tsx
goal: >
  新建 account 页表单测试：校验（新≥8、新=确认）+ 提交 + 错误展示。
implementation:
  - 新建 frontend/src/app/(dashboard)/account/page.test.tsx
  - 参考 components/__tests__/admin-user-drawer.test.tsx 风格（vitest + @testing-library/react）
  - 覆盖：新密码<8 禁用提交、新≠确认提示、提交调 changePassword、401 旧密码错误展示
acceptance:
  - AC-08 表单校验 + 提交 + 错误展示
verify:
  - cd frontend && pnpm vitest run "src/app/(dashboard)/account"
constraints:
  - 仅测试，不改实现
---

# task-09：个人中心页表单测试

## 依据
- design.md §9 AC-08、§13 文件清单
- 参考既有测试风格已确认：`frontend/src/components/__tests__/admin-user-drawer.test.tsx` 用 `vitest`（describe/it/expect/vi）+ `@testing-library/react`（render/screen/fireEvent/waitFor），mock onSubmit 用 `vi.fn().mockResolvedValue(undefined)` / `.mockRejectedValue(new Error(...))`。

## 实现要点
1. 新建 `frontend/src/app/(dashboard)/account/page.test.tsx`。
2. 用 `vi.mock("@/lib/auth", ...)` mock `changePassword`（参考 admin-user-drawer 用 vi.fn 控制成功/失败）。
3. 测试用例：
   - 新密码 <8 位 → 提交禁用或校验报错（对齐 admin-user-drawer「username 太短禁用提交」模式）
   - 新密码 ≠ 确认密码 → 提示不匹配
   - 合法输入 + 提交 → `changePassword` 被调用，参数为 `{ oldPassword, newPassword }`（参考 `onSubmit.mock.calls[0]` 断言风格）
   - `changePassword` reject（模拟 401）→ 旧密码字段展示「旧密码错误」（参考「登录名已被占用」错误展示用例）

## 验收（AC-08）
- 表单校验（新≥8、新=确认）
- 提交调 changePassword
- 401 旧密码错误展示

## 约束
- 仅测试，不改 task-07 实现（CLAUDE.md 规则 9）
- 风格对齐 admin-user-drawer.test.tsx
