---
plan_level: full
---

# 实现计划（Plan）：frontend 浏览器级 E2E 测试体系（Playwright）

## Wave 1（并行，无依赖）
- task-01

## Wave 2（依赖前序 Wave）
- task-02
- task-07

## Wave 3（依赖前序 Wave）
- task-03
- task-04
- task-05

## Wave 4（依赖前序 Wave）
- task-06

## Wave 5（依赖前序 Wave）
- task-08

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | Playwright 配置与测试栈隔离 | W1 | P0 | — | FR-01, FR-08 / D-001@v1, D-005@v1, D-009@v1 | playwright.config.ts + test:e2e script + tsconfig include e2e + vitest exclude e2e + .gitignore |
| task-02 | e2e 基础设施 | W2 | P0 | — | FR-02, FR-03 / D-002@v2, D-003@v1 | env.ts + fixtures.ts（TestApiClient：admin 登录/幂等建角色 e2e_smoke_<runid>/建用户挂 role_ids/用户登录）+ helpers.ts（注入 persist v1 格式 + waitForPageText） |
| task-03 | auth.spec 真实 UI 登录链路 | W3 | P0 | task-02 | FR-04 / D-005@v1 | A1-A4 四用例，等待策略禁 networkidle |
| task-04 | navigation.spec 导航冒烟 | W3 | P0 | task-02 | FR-05 / D-002@v2 | N1-N4 四用例（含负向断言） |
| task-07 | 移除 puppeteer 残留 | W2 | P1 | task-01 | FR-09 / D-006@v1 | 与 package.json 变更错 Wave；lockfile 同步更新 |
| task-05 | 运行文档与凭据卫生 | W3 | P1 | task-01, task-02 | FR-06 / D-008@v1 | e2e/README.md（前置/限流说明）+ .env.e2e.example |
| task-06 | CI e2e job | W4 | P0 | task-01, task-03, task-04 | FR-07 / D-004@v1, D-007@v1, D-008@v1 | e2e-ci.yml：services pg/redis + uvicorn（限流 60 + health status=="ok"）+ next build/start + chromium + trace artifact |
| task-08 | 端到端验证 | W5 | P0 | task-01~07 | 全部 FR | 本机实跑全绿 + typecheck/vitest 隔离回归 + CI 首跑 |

## 关键路径
task-01 → task-03/04 → task-06 → task-08（spec 用例与 CI 是交付主线）

## 全局验收标准
1. 本机 dev 环境前置下 `cd frontend && pnpm test:e2e` 全绿（8 用例：A1-A4 + N1-N4）
2. `pnpm typecheck` 0 错（覆盖 e2e 代码）
3. `pnpm test`（vitest）不收集 e2e/*.spec.ts，现有测试不受影响
4. e2e-ci.yml 首跑绿（20min 超时内，失败有 trace artifact）
5. frontend 依赖树无 puppeteer，`pnpm install --frozen-lockfile` 一致
6. （brownfield）未配置 E2E_* 环境变量时业务代码行为零变化（纯新增测试体系，不触碰 src/）

> 逐项核验结果由 verify 阶段写入 verify-result.md；task 级验收对照 TaskCard frontmatter acceptance 字段。

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02 | AC-1（方案 C 骨架落地：config + fixtures/helpers） |
| D-002@v2 | task-02, task-04 | AC-1（run-id 用户挂 workspace:read 角色，N1-N4 通过） |
| D-003@v1 | task-02 | AC-1（API 登录注入，spec beforeEach 生效） |
| D-004@v1 | task-06 | AC-4（CI 用 next build+start） |
| D-005@v1 | task-03, task-04 | AC-1（无 networkidle 挂起，SSE 页面用例通过） |
| D-006@v1 | task-07 | AC-5（依赖树无 puppeteer） |
| D-007@v1 | task-06 | AC-4（触发 paths 仅 frontend/**） |
| D-008@v1 | task-05, task-06 | AC-1/AC-4（限流 60 下 8 次登录无 429） |
| D-009@v1 | task-01 | AC-3（vitest exclude e2e） |
