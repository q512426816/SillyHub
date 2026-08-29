---
id: task-01
title: 'Playwright config + test stack isolation'
title_zh: 'Playwright 配置与测试栈隔离'
author: 'qinyi'
created_at: 2026-08-29 14:55:00
priority: P0
depends_on: []
blocks: ['task-02', 'task-03', 'task-04', 'task-05', 'task-06', 'task-07', 'task-08']
requirement_ids: [FR-01, FR-08]
decision_ids: [D-001@v1, D-005@v1, D-009@v1]
allowed_paths:
  - frontend/playwright.config.ts
  - frontend/package.json
  - frontend/tsconfig.json
  - frontend/vitest.config.ts
  - frontend/.gitignore
goal: >
  建立 Playwright 运行骨架并把双测试栈隔离开：playwright.config.ts（chromium/workers:1/
  trace retain-on-failure/zh-CN）+ package.json 的 test:e2e script + tsconfig include e2e
  （typecheck 覆盖）+ vitest.config.ts 显式 exclude e2e（默认 include 必扫 *.spec.ts，D-009@v1）
  + .gitignore 排除 test-results/playwright-report/e2e/.env.e2e（design §3.1/§6，FR-01/FR-08）。
implementation:
  - 新建 frontend/playwright.config.ts：testDir "./e2e"、timeout 60000、workers 1（串行：测试数据无竞争+避免并发突发，计数上限由 R8 限流放宽兜底）、retries process.env.CI ? 1 : 0、projects 仅 chromium、use.baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000"、locale "zh-CN"、trace "retain-on-failure"、reporter ["list", ["html", { open: "never" }]]；不配置 webServer（D-001@v1 本机手动前置）
  - frontend/package.json scripts 增 "test:e2e": "playwright test"（本任务不动 devDependencies 的 puppeteer——归 task-07，避免同 Wave 共享文件语义混乱）
  - frontend/tsconfig.json include 增 "e2e/**/*.ts"（锁定根 tsconfig 方案：typecheck=tsc --noEmit 只用根 tsconfig，独立 e2e/tsconfig.json 不会被消费，design XC-21 定案）
  - frontend/vitest.config.ts test 段增 exclude: ["e2e/**", ...configDefaults.exclude]（从 vitest/config 导入 configDefaults；vitest 无 include 配置，默认 include **/*.{test,spec}.?() 必收集 e2e/*.spec.ts）
  - frontend/.gitignore 追加 e2e/test 相关三行：test-results/、playwright-report/、e2e/.env.e2e
acceptance:
  - cd frontend && pnpm exec playwright test --list 不报配置错误（e2e 目录暂空或仅有占位 spec 时允许 no tests found）
  - cd frontend && pnpm exec tsc --noEmit 通过（含 e2e 代码纳入检查后 0 错）
  - cd frontend && pnpm exec vitest run --exclude 无法收集 e2e（vitest.config exclude 生效后，pnpm test 收集清单不含 e2e/ 下文件——可用 vitest list 验证）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest list | grep -c "e2e/" 输出 0（或等价方式确认 vitest 不再收集 e2e）
constraints:
  - 不安装新 devDependencies（@playwright/test ^1.60 已在 devDeps）
  - playwright.config 不写 webServer/不自动起服务（D-001@v1）
  - vitest exclude 用 [...configDefaults.exclude, "e2e/**"] 形式保留默认排除项
  - 遵守 CLAUDE.md 规则 0：只跑本任务相关检查
---
