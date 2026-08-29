# 模块影响分析（Module Impact）— frontend 浏览器级 E2E 测试体系（Playwright）

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| frontend | 新增 | 新建 `frontend/e2e/`（env/fixtures/helpers/auth.spec/navigation.spec/README/.env.e2e.example）+ `playwright.config.ts`；修改 package.json（+test:e2e、-puppeteer）、pnpm-lock.yaml、tsconfig.json（include e2e）、vitest.config.ts（exclude e2e）、.gitignore。纯测试基建，不改 src/ 业务代码 |
| ci | 新增 | 新增 `.github/workflows/e2e-ci.yml`（services pg/redis + backend + next build/start + playwright + trace artifact，paths 仅 frontend/**） |

## 未匹配文件

无。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/frontend.md` | 更新 frontend 模块卡（新增 e2e 测试体系入口与命令） | pending |
| `modules/ci.md` | 更新 ci 模块卡（新增第 4 个 workflow e2e-ci） | pending |
| `_module-map.yaml` | 无变化（未增删模块） | skipped |
