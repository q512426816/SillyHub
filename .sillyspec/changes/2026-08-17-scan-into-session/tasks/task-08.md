---
id: task-08
title: remove-agent-console-frontend
title_zh: 前端移除智能体控制台（agent 页、导航、菜单组、use-agent-runs）
author: qinyi
created_at: 2026-08-17 14:10:00
priority: P0
depends_on: []
blocks: [task-09]
requirement_ids: [FR-06]
decision_ids: [D-003@v1, D-004@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/agent/__tests__/page.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/components/page.tsx
  - frontend/src/lib/menu-permissions.ts
  - frontend/src/lib/use-agent-runs.ts
  - frontend/src/lib/__tests__/use-agent-runs.test.tsx
provides: []
expects_from: []
goal: >
  删除 workspaces/[id]/agent 页（page.tsx 与测试），移除 page.tsx 快捷导航与 components 页
  NAV_ITEMS 的「智能体」入口，删除 menu-permissions.ts「智能体控制台」菜单组（含 13 个权限 key 归属核查），删除仅 agent 页使用的 use-agent-runs.ts 及其测试，grep 复查无死链。
implementation:
  - 删除目录 agent 页（page.tsx 与 __tests__/page.test.tsx 随目录删除）
  - page.tsx 快捷导航与 components/page.tsx NAV_ITEMS 删除「智能体」入口
  - menu-permissions.ts 删除「智能体控制台」菜单组（menuKey=agent）并核查 13 个权限 key 归属（task:read 由 runtime 与 missions 组持有保留，其余 12 个随组移除）
  - 删除 use-agent-runs.ts 与其测试；保留 agent-run-panel.tsx（change-agent-run-log.tsx 复用）、lib/agent.ts（任务页使用）与 agent-profiles
acceptance:
  - agent 目录与 use-agent-runs.ts 及其测试已删除
  - 两处导航入口与 menuKey=agent 菜单组均已移除
  - grep href agent 复查无指向控制台的死链（settings「智能体配置」等非控制台引用除外）
  - AgentRunPanel 仍被变更详情页 change-agent-run-log.tsx 使用
verify:
  - cd frontend && pnpm exec tsc --noEmit，再 grep href agent 复查无残留死链
constraints:
  - menu-permissions.test.ts 与 permission.test.ts 的 agent 断言清理归 task-09，本任务不动；不删除被其它页面复用的 AgentRunPanel、lib/agent.ts 与 agent-profiles 相关
related_tests: [agent/page.test.tsx（随目录删除）, use-agent-runs.test.tsx（随文件删除）]
---
