---
author: qinyi
created_at: 2026-08-29 14:41:30
---
# 任务清单（Tasks）

- [ ] task-01: Playwright 配置与测试栈隔离（playwright.config.ts + package.json test:e2e script + tsconfig include e2e + vitest exclude e2e + .gitignore）
- [ ] task-02: e2e 基础设施（env.ts 环境变量 + fixtures.ts TestApiClient + helpers.ts run-id 用户/登录注入/等待工具）(depends_on: task-01 可并行，仅软依赖)
- [ ] task-03: auth.spec 真实 UI 登录链路用例（A1-A4）(depends_on: task-02)
- [ ] task-04: navigation.spec 导航冒烟用例（N1-N4）(depends_on: task-02)
- [ ] task-05: 运行文档与凭据卫生（e2e/README.md + .env.e2e.example）(depends_on: task-01, task-02)
- [ ] task-06: CI e2e job（.github/workflows/e2e-ci.yml）(depends_on: task-01, task-03, task-04)
- [ ] task-07: 移除 puppeteer 残留依赖并更新 lockfile (depends_on: task-01)
- [ ] task-08: 端到端验证（本机实跑全绿 + typecheck/vitest 隔离回归 + CI 首跑）(depends_on: task-01, task-02, task-03, task-04, task-05, task-06, task-07)
