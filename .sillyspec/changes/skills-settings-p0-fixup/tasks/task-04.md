---
author: qinyi
created_at: 2026-07-31 11:45:37
id: task-04
title: 前端单测编辑弹窗 frontmatter 适配加 skills 页 placeholder 断言更新
goal: |
  为 task-02 与 task-03 的前端改动补测试：新建 edit-dialog.test.tsx 测头部预览与校验与模板；更新 page.test.tsx 受 placeholder 与文案改动影响的断言。
implementation: |
  一，新增 edit-dialog.test.tsx：照搬 page.test.tsx 脚手架（QueryClientProvider 加 useSession mock），mock lib/errors 的 useNotify 返回 success 与 error 空函数，mock custom-skills 各 hook；测头部预览随 name 与 description 实时变化、保存前校验（缺 description 时禁用保存）、插入步骤模板填充正文、保存成功调用 createCustomSkill 且触发 notify。二，更新 page.test.tsx：把定位正文框的 getByPlaceholderText 含「技能标题」的匹配改为新步骤骨架 placeholder 匹配；为弹窗渲染补 useNotify mock 避免 App provider 缺失报错；按 P0-4 白话化后的文案调整断言（如「新增技能」按钮与「只读」字样仍在，amber banner 对非 admin 出现）。
acceptance: |
  - edit-dialog.test.tsx 覆盖头部预览与校验与模板与 notify
  - page.test.tsx placeholder 断言更新后通过
  - 两文件 mock useNotify 避免 App provider 缺失报错
verify: |
  - cd frontend 与 pnpm test src/app/(dashboard)/settings/skills
  - cd frontend 与 pnpm exec tsc --noEmit
constraints: |
  - mock useNotify 返回 success 与 error 空函数
  - 测试遵循现有 page.test.tsx 脚手架
allowed_paths:
  - frontend/src/app/(dashboard)/settings/skills/__tests__/edit-dialog.test.tsx
  - frontend/src/app/(dashboard)/settings/skills/__tests__/page.test.tsx
depends_on:
  - task-02
  - task-03
---
