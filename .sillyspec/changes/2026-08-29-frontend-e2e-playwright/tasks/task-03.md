---
id: task-03
title: 'auth.spec: real UI login/logout flow'
title_zh: 'auth.spec 真实 UI 登录链路用例（A1-A4）'
author: 'qinyi'
created_at: 2026-08-29 14:55:00
priority: P0
depends_on: ['task-02']
blocks: ['task-06', 'task-08']
requirement_ids: [FR-04]
decision_ids: [D-005@v1]
allowed_paths:
  - frontend/e2e/auth.spec.ts
goal: >
  真实浏览器走 /login 表单的四条用例：A1 未登录重定向、A2 登录成功跳转 /workspaces、
  A3 错误密码停留+错误提示（单次失败）、A4 登出清 token 回 /login（design §4.1，FR-04）。
implementation:
  - beforeEach 用 helpers.createE2EContext 准备冒烟用户（不在浏览器登录——表单登录是被测行为本身）
  - A1：page.goto("/workspaces")（waitUntil domcontentloaded）→ 断言 URL 变 /login（客户端守卫 (dashboard)/layout.tsx:29-32 replace）
  - A2：goto /login → 填账号/密码输入框（中文 label/placeholder 定位，按实际 DOM 校正）→ 提交 → 断言 URL 为 /workspaces + PageHeader/侧边栏关键元素可见（非列表容器，design B-3）+ localStorage 的 session 含 accessToken
  - A3：用错误密码提交一次 → 停留 /login + 错误提示可见（后端 401 文案含「用户名或密码」）——严禁多轮失败（阈值 3 次触发 captcha，config.py:162）
  - A4：A2 登录态下触发登出（用户菜单/按钮，按实际 DOM）→ 断言回 /login + localStorage token 清空 + 再访问 /workspaces 跳 /login
  - 所有等待用 getByRole/getByText().toBeVisible 或 waitForPageText，禁用 networkidle（D-005@v1，SSE 挂起）
  - 断言元素选择器执行时按实际页面 DOM 校正（design §4 表已声明此延后项）
acceptance:
  - 本机 dev 环境前置下 cd frontend && pnpm exec playwright test e2e/auth.spec.ts 4 用例全绿
verify:
  - cd frontend && pnpm exec playwright test e2e/auth.spec.ts
constraints:
  - 只新增 auth.spec.ts 一个文件
  - A3 单次失败铁律（R2）
  - 表单平台保持默认 sillyhub（login/page.tsx:46）
---
