---
id: task-03
title: 我的供应商独立页面 /settings/providers + 渲染测试
title_zh: 新建我的供应商独立页面及渲染测试
author: qinyi
created_at: 2026-07-30 09:06:13
priority: P0
depends_on: [task-02]
blocks: [task-06]
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/settings/providers/page.tsx
  - frontend/src/app/(dashboard)/settings/providers/__tests__/page.test.tsx
goal: >
  新建我的供应商独立页面，复用现有 LlmProviderSection 组件并配渲染测试，
  让该功能可从侧边栏菜单直达而不再只藏在设置页 Tab 里（design §5.2 Phase 2、D-002）。
implementation:
  - 在 settings/providers/page.tsx 新建客户端页面，结构参考同级 skills/page.tsx，用 PageContainer 加 PageHeader
  - 页面标题写我的供应商，副标题给一句简短中文说明（供应商配置跟随账号、所有工作区通用）
  - 主体直接渲染 LlmProviderSection 组件（从 components/llm-providers/llm-provider-list.tsx 具名导出，不改该组件）
  - 在 __tests__/page.test.tsx 新增渲染测试，参考 skills/__tests__/page.test.tsx 的 QueryClientProvider 脚手架
  - 测试断言页面标题我的供应商渲染出来，且 LlmProviderSection 区块挂载（可 mock 该组件或 mock listProviders 接口）
acceptance:
  - 访问路由 /settings/providers 能渲染我的供应商标题与供应商区块
  - 渲染测试通过，覆盖标题与区块挂载两条断言
  - 不修改 LlmProviderSection 组件源码，菜单 href（task-02 已指向此路由）可直达
verify:
  - cd frontend && pnpm vitest run "src/app/(dashboard)/settings/providers/__tests__/page.test.tsx"
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 只动 allowed_paths 两个文件，不改 LlmProviderSection、不改设置页（设置页瘦身属 task-06）
  - 页面样式沿用 design §5 引用的前端样式系统（PageContainer/PageHeader 组件）
  - 标题与说明文案用中文
---
