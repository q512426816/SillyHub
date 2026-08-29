---
id: task-04
title: 'navigation.spec: sidebar smoke after login'
title_zh: 'navigation.spec 导航冒烟用例（N1-N4）'
author: 'qinyi'
created_at: 2026-08-29 14:55:00
priority: P0
depends_on: ['task-02']
blocks: ['task-06', 'task-08']
requirement_ids: [FR-05]
decision_ids: [D-002@v2, D-005@v1]
allowed_paths:
  - frontend/e2e/navigation.spec.ts
goal: >
  登录后（API 注入，非表单）侧边栏导航冒烟四用例：N1 /workspaces 列表页渲染、
  N2 →/sessions、N3 →/agent-profiles 与 →/settings/skills、N4 负向断言 admin 权限菜单
  不可见（design §4.2，FR-05，D-002@v2 挂 workspace:read 角色）。
implementation:
  - beforeEach：createE2EContext（run-id 用户挂角色）→ loginAsE2e 注入 → goto /workspaces（domcontentloaded）
  - N1：断言 URL /workspaces + PageHeader「选择工作区」或列表容器可见（挂角色后 GET /api/workspaces 200）
  - N2：侧边栏点击「智能体会话」→ URL /sessions + 会话页关键元素可见
  - N3：侧边栏点击「智能体档案」→ /agent-profiles；点击「技能管理」→ /settings/skills（实路径 menu-permissions.ts:186）+ 各自页面关键元素可见
  - N4：断言「API 密钥」「Git 身份管理」等需独立 admin 权限的菜单项在侧边栏不可见（toBeHidden / count=0）
  - 等待策略同 task-03：关键元素/文本，禁 networkidle（D-005@v1）
  - 断言元素执行时按实际 DOM 校正（design 声明延后项）
acceptance:
  - 本机 dev 环境前置下 cd frontend && pnpm exec playwright test e2e/navigation.spec.ts 4 用例全绿
verify:
  - cd frontend && pnpm exec playwright test e2e/navigation.spec.ts
constraints:
  - 只新增 navigation.spec.ts 一个文件
  - beforeEach 每用例独立 context（run-id 用户可复用同一 ctx 对象，登录注入每用例重做——浏览器 localStorage 是 per-context）
  - N4 用例不得通过给用户加 admin 权限来「简化」（负向断言是 D-002@v2 的验证面）
---
