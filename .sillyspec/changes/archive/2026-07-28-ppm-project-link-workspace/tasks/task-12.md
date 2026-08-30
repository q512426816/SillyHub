---
id: task-12
title: 前端关联组件测试
title_zh: 弹窗与区块组件交互测试
author: qinyi
created_at: 2026-07-28 14:05:41
priority: P1
depends_on: [task-10, task-11]
blocks: [task-14]
requirement_ids: [FR-02, FR-03]
decision_ids: []
allowed_paths:
  - frontend/src/components/workspace/__tests__/LinkWorkspaceDialog.test.tsx
  - frontend/src/components/workspace/__tests__/LinkedProjectsSection.test.tsx
goal: >
  编写前端组件测试,覆盖关联弹窗与区块的绑定/解绑交互,对称验证双边 UI。
implementation:
  - LinkWorkspaceDialog.test:渲染弹窗、绑定一个工作区、解绑一个、断言列表变化
  - LinkedProjectsSection.test:对称,绑定/解绑项目
  - mock task-09 的 API 客户端
acceptance:
  - 两个测试文件全部通过
  - 覆盖绑定与解绑交互
verify:
  - "cd frontend && pnpm test src/components/workspace --run"
constraints:
  - vitest + @testing-library/react
  - markdown-text 等动态组件测试需 vi.mock(memory 坑)
---
