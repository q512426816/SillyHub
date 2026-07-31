---
author: qinyi
created_at: 2026-07-31 11:45:37
id: task-03
title: skills 页生效提示加新手引导加白话化加只读 banner
goal: |
  让 skills 页看得懂、知道生效没：上区灰字提示生效时机、顶部新手引导卡、全页术语白话化、非管理员 amber banner。
implementation: |
  改 settings/skills/page.tsx。一，上区 SectionCard 内加灰字「技能变更不会热推送，守护进程下次启动时从平台拉取最新技能包」。二，PageHeader 下、两个 SectionCard 之上加可折叠「新手引导」卡，白话解释「技能是给 AI 看的操作说明书」，区分平台技能（自带只读）与自定义技能（你创建）。三，白话化：副标题「分发给所有守护进程」改「发给本机所有 AI 助手使用」；空状态文案白话化（去「skills bundle」「守护进程」黑话）。四，非管理员（is_platform_admin 为 false）在 PageHeader 下加 amber banner「仅平台管理员可编辑，当前为只读视图」，className 与文案与 settings/mcp 逐字一致。
acceptance: |
  - 上区卡片有生效时机灰字提示
  - 页顶有可折叠新手引导卡
  - 副标题与空状态文案白话化
  - 非管理员看到 amber banner，管理员不显示
verify: |
  - cd frontend 与 pnpm test src/app/(dashboard)/settings/skills/__tests__/page.test.tsx
  - cd frontend 与 pnpm exec tsc --noEmit
constraints: |
  - 只改文案与样式，不改 CRUD 逻辑
  - amber banner 与 settings/mcp 逐字一致
allowed_paths:
  - frontend/src/app/(dashboard)/settings/skills/page.tsx
depends_on: []
---
