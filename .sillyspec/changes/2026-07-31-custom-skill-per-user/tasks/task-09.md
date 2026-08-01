---
id: task-09
title: settings/skills/page 按钮权限 is_platform_admin 改为登录即可
title_zh: 技能页按钮任意登录用户可操作
author: qinyi
created_at: 2026-07-31 22:41:43
priority: P1
depends_on: [task-08]
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-003]
allowed_paths:
  - frontend/src/app/(dashboard)/settings/skills/page.tsx
---

## 目标
`settings/skills/page.tsx` 新增/编辑/删除按钮从「仅平台管理员」改为「登录用户即可」；自定义技能列表只显示自己的（后端 task-04 已按 user 过滤，前端直接渲染返回值即可）。修前后端不一致 bug（D-003）。

## 实现要点
- 现状（page.tsx）：
  - :59 `const isPlatformAdmin = useSession((s) => s.user?.is_platform_admin === true);`
  - :186 非管理员 amber banner「仅平台管理员可编辑，当前为只读视图」。
  - :287 / :314 自定义技能 SectionCard 的「新增技能」按钮 `isPlatformAdmin ? <Button/> : null`。
  - :307 / :350 空态描述与行内编辑/删除按钮同样受 `isPlatformAdmin` 控制。
- 改动：
  - 移除 `isPlatformAdmin` 变量及所有用它的条件分支，让新增/编辑/删除按钮始终渲染。
  - 删除 :186 的 amber banner（或改文案为说明 per-user：技能是个人资产，只显示自己的，AI 只加载系统 + 自己的）。
  - 空态文案（:307）调整：从「分发给我的 AI 助手」语义改写，去掉「需要平台管理员权限才能新增」的描述。
- 自定义技能列表区域不额外做前端筛选——后端 list 已按 user 过滤（task-04），前端直接渲染。
- 系统技能区域（只读展示）不动。

## 验收
- 登录用户（非管理员）在 `/settings/skills` 看到「新增技能」按钮、行内「编辑/删除」按钮可用。
- amber banner 消失（或改为 per-user 说明文案）。
- 非管理员实际操作新增/编辑/删除成功（后端 task-03 放开权限）。
- typecheck 过；前端单测（page.test.tsx 由 task-13 补）。
