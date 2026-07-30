---
id: task-07
title: 全量验收（前端受影响测试 + 后端权限测试 + typecheck）
title_zh: 三端测试与类型检查全量验收
author: qinyi
created_at: 2026-07-30 09:06:13
priority: P0
depends_on: [task-04, task-05, task-06]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-001@v1, D-002@v1, D-003@v1, D-004@v1, D-005@v1, D-006@v1]
allowed_paths:
  - frontend/src/lib/menu-permissions.ts
  - frontend/src/components/app-shell.tsx
  - backend/app/modules/auth/permissions.py
goal: >
  回归验收任务，不改源码：跑通前端受影响测试与全量测试、后端 auth 权限测试、前端 typecheck，并对照 design 全局验收标准逐条核对，确认侧边栏重组整体达标。
implementation:
  - 跑前端受影响测试，含 menu-permissions、admin-role-permission-picker、permission、providers 页面测试文件
  - 跑前端全量 pnpm test 确认零回归
  - 跑后端 auth 权限测试确认新增枚举不破坏 RBAC
  - 跑前端 typecheck 确认 MenuSection 联合类型改动无遗漏引用
  - 对照 design 第2节目标逐条人工核对侧边栏 5 组渲染、3 个新菜单可见、设置页瘦身、图标统一、现有路由不变
acceptance:
  - 前端受影响测试与全量 pnpm test 全部通过
  - 后端 auth 测试全部通过，llm_provider 读取权限枚举生效
  - 前端 typecheck 无错误
  - design 全局验收 5 条逐条核对通过，ppm 组隔离与 navHidden 逻辑未被误伤
verify:
  - cd frontend && pnpm test
  - cd backend && uv run pytest tests/modules/auth -q --no-cov
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 本任务为回归验收，禁止修改源码，发现失败先回报根因再交回对应实现任务修复
  - 禁止为让测试变绿而改测试断言，测试逻辑本身有误除外并须说明依据
  - 验收核对只查不碰，ppm 隔离与现有路由行为必须保持原样
---
