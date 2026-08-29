---
author: qinyi
created_at: 2026-08-29 14:41:30
---
# 提案书（Proposal）

## 动机

frontend（Next.js 14）现有 157 个 vitest+jsdom 测试全部是 mock 驱动的组件/逻辑测试，无一条真实浏览器链路；devDependencies 里声明了 `@playwright/test ^1.60` 与 `puppeteer ^24.43` 两套浏览器自动化依赖但仓库内无任何 playwright 配置（TESTING.md §覆盖与门禁已记录此空洞）。本变更为 frontend 建立浏览器级 E2E 测试体系（参照 multica 的 e2e 模式），补上测试版图中「真实浏览器 × 真实后端」这一层，并顺手清理 puppeteer 残留。

## 关键问题

1. **关键链路只有 mock 视角**：登录/登出/跳转、侧边栏导航、页面可达性在 jsdom mock 下验证的是「组件按预期调用 mock」，不是「真实页面真的能走到」——后端接口、路由、localStorage 持久化、SSE 连接任何一环断裂都测不出来。
2. **无回归冒烟网**：大改后（如近期多次 SSE 重连修复）缺少一条快速验证「登录还能登、核心页面还能到」的浏览器级守护链。
3. **CI 无集成形态验证**：frontend-ci 只跑 lint+build+vitest（全部 mock），前后端真实组装形态（rewrites 代理、JWT 会话、权限菜单）在 CI 上零覆盖。

## 变更范围

- 新增 `frontend/playwright.config.ts` + `frontend/e2e/`（env/fixtures/helpers/auth.spec/navigation.spec/README/.env.e2e.example，共 8 文件）
- 新增 `.github/workflows/e2e-ci.yml`（services pg/redis + backend + next build/start + chromium + trace artifact）
- 修改 `frontend/package.json`（+test:e2e、-puppeteer）、`pnpm-lock.yaml`、`tsconfig.json`（include e2e）、`vitest.config.ts`（exclude e2e）、`.gitignore`
- 纯测试体系建设，**不改任何 backend / frontend 业务代码**

## 不在范围内（显式清单）

- 不做业务深水区用例（workspace 创建向导、会话发起流、文件预览、PPM 等）——后续变更按域扩展
- 不做移动端 /m/ UA 分流与主题切换 e2e（需求澄清轮用户未选）
- 不做 Firefox/WebKit 多浏览器矩阵（chromium 单浏览器起步）
- 不做本机一键全自动编排（方案 B 已否决，D-001@v1）
- 不做视觉回归（screenshot diff）
- 不改任何 backend 与 frontend 业务代码

## 成功标准（可验证）

- 本机 dev 环境前置下 `cd frontend && pnpm test:e2e` 全绿（7 用例：auth 4 + navigation 3）
- CI e2e-ci.yml 首跑绿（push 触发，20min 超时内）
- `pnpm test`（vitest）不收集 e2e/*.spec.ts（双测试栈隔离，D-009@v1）
- `pnpm typecheck` 覆盖 e2e 代码且 0 错
- frontend 依赖树中不再有 puppeteer，`pnpm install --frozen-lockfile` 一致
