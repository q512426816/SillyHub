---
id: task-13
title: 前端测试 按钮权限与 per-user 列表
title_zh: 前端测试覆盖登录用户见 CRUD 按钮与列表只显示自己
author: qinyi
created_at: 2026-07-31 22:40:05
priority: P1
depends_on: [task-09]
blocks: []
requirement_ids: [FR-07]
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/settings/skills/__tests__/page.test.tsx
---

## 目标
为 skills page 补两类测试：① 登录用户（非 platform_admin）可见新增/编辑/删除按钮（task-09 已将 `is_platform_admin` 门槛移除）；② 自定义技能列表只显示当前用户的（后端 per-user 过滤，前端 mock 验证渲染契约）。

## 实现要点
- 沿用 `page.test.tsx` 现有 mock 套路（`vi.mock` `@/lib/custom-skills` 的 hooks、`@/lib/api` 等）；参考 memory frontend-markdown-text-jsdom-null：若涉及 MarkdownText 组件需 `vi.mock` 纯文本渲染避开 jsdom next/dynamic ssr:false 返回 null。
- 场景 1（按钮权限，FR-07）：mock 当前 user 非 platform_admin → 渲染 page → 断言「新增」「编辑」「删除」按钮可见（不再因 is_platform_admin 隐藏）。
- 场景 2（per-user 列表）：mock `useCustomSkills` 返回当前 user 的技能数组（created_by 为当前 user id）→ 断言列表渲染这些项；mock 返回别的 user 数据时验证前端按后端契约渲染（后端已过滤，前端不二次筛选）。
- created_by 字段 mock 为合法 string（配合 task-10 类型收窄，不再用 null 默认）。

## 验收
- `pnpm --filter frontend test -- skills/page` 全绿。
- 按钮用例覆盖非 platform_admin 登录用户场景。
- 列表用例断言 per-user 渲染（mock 数据 created_by 为当前 user）。
