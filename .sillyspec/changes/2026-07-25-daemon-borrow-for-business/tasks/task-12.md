---
id: task-12
title: 前端 lender 共享开关 + owner 共享管理页
title_zh: daemon 共享的前端开关与管理
author: qinyi
created_at: 2026-07-25 21:50:26
priority: P1
depends_on: [task-03, task-04]
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-003@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/
  - frontend/src/components/workspace/
  - frontend/src/lib/workspace-binding.ts
goal: >
  lender 在工作空间设置开关共享自己的 daemon；owner 在成员/设置页管理共享 daemon 与 business_member 角色。
implementation:
  - lender 工作空间设置加"共享我的 daemon"开关，调 PUT /workspaces/{ws}/my-binding/shared
  - owner 成员/设置页加共享 daemon 列表（GET /shared-daemons）+ 撤销按钮 + 给成员授 business_member 角色
  - 复用现有 lib/workspace-binding.ts 封装
acceptance:
  - lender 能开关共享
  - owner 能看到工作空间所有共享 daemon + 撤销 + 授角色
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm test
  - cd frontend && pnpm lint
constraints:
  - 中文 UI（CLAUDE.md 规则 12）
  - 复用现有工作空间设置/成员管理组件，不大改
  - 参考前端样式系统（archive/2026-06-21-frontend-style-system）
---
