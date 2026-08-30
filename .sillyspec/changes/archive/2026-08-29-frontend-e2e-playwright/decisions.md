---
author: qinyi
created_at: 2026-08-29 14:39:29
---

# 决策记录 — 2026-08-29-frontend-e2e-playwright

> 幂等规则：按 D-xxx@vN 查重，已存在不重复追加；修正走新版本 D-xxx@vN+1 + supersedes。

## D-001@v1 技术方案选方案 C（骨架贴 multica + 数据唯一化 + CI 生产化）

- 备选：A=multica 复刻极简（固定账号 + CI dev server）；B=全自动零前置（本机也 webServer 编排 compose/uvicorn/next dev）；C=骨架贴 multica + run-id 唯一用户 + CI next build+start。
- 选 C 理由：复用 multica 实战沉淀的组织模式降低认知成本；run-id 唯一用户消除固定账号状态残留（登录失败计数触发 captcha、历史数据干扰断言）；CI 生产 build 比 dev server 更接近真实行为；本机手动前置避开 Windows 全自动进程编排的僵尸进程/端口排障雷区（CLAUDE.md 规则 13 跨平台约束）。
- 否决 A：固定账号有状态残留风险；CI dev server 行为偏离生产。
- 否决 B：本机全自动编排复杂度/排障面与收益不成比例。
- 用户确认轮次：方案选择轮（2026-08-29）。

## D-002@v2 测试身份双轨：bootstrap admin 造数 + run-id 唯一用户挂 workspace:read 角色冒烟

- supersedes: D-002@v1
- type: feasibility
- priority: P1
- status: accepted
- source: design-grill（B-3）
- question: 无权限新用户 `GET /api/workspaces` 403（workspace/router.py:261-264）、列表容器不渲染（workspaces/page.tsx:246），登录默认跳转页的 N1 断言对象不存在。
- answer: 冒烟身份升级为「run-id 唯一用户 + workspace:read 角色」：admin 先 `POST /api/admin/roles` 幂等建角色（key 用下划线 `e2e_smoke_<runid>`，pattern `^[a-z][a-z0-9_]*$` 不容连字符——复核 NP-1），再 `POST /api/admin/users` 建用户传 role_ids。
- normalized_requirement: 冒烟身份侧边栏可见=工作区首页/智能体档案/智能体会话/技能管理(/settings/skills)；N4 负向断言改用 API 密钥/Git 身份管理等 admin 权限菜单。
- impacts: [N1, A2, N4]
- evidence: workspace/router.py:261-264, workspaces/page.tsx:246, menu-permissions.ts:186/217/231/189, admin/router.py:90/464

## D-002@v1 测试身份双轨：bootstrap admin 造数 + run-id 唯一普通用户冒烟（已被 @v2 取代）

- 造数身份：`PLATFORM_BOOTSTRAP_ADMIN_EMAIL/PASSWORD`（backend/.env / CI env）登录拿 admin token，经 `POST /api/admin/users` 创建 `e2e-<runid>@test.local` 唯一用户（显式传密码）。
- 冒烟身份：新建普通用户（无角色无权限），每次运行唯一，天然隔离零清理。
- 依据：菜单权限模型（frontend/src/lib/menu-permissions.ts）——无权限用户侧边栏仅见 permissions:[] 三项（智能体档案/智能体会话/技能管理），「工作区首页」菜单需 workspace:read 等权限。冒烟围绕默认可见集设计 + 负向断言。

## D-003@v1 登录提速走 API 登录 + localStorage 注入，UI 表单登录仅 auth.spec

- 除 auth.spec 外全部用例：TestApiClient `POST /api/auth/login`（首登无 captcha——captcha 仅失败达阈值后触发，backend/app/modules/auth/captcha_service.py:109-113）→ `page.addInitScript` 注入 `localStorage["multi-agent-platform.session"]`。
- 注入格式精确匹配 zustand persist（frontend/src/stores/session.ts:63-77）：`{state:{hydrated:true,user,accessToken,refreshToken},version:1}`。
- auth.spec 保留真实 UI 登录链路覆盖（表单/跳转/错误提示/登出）。

## D-004@v1 CI 用 next build + next start，不用 dev server

- e2e-ci.yml 中 frontend 以生产形态运行（next build && next start），比 dev server 更接近生产行为（rewrites/构建产物/性能特征）。
- 本机维持 next dev（开发者日常环境形态，前置文档说明）。

## D-005@v1 等待策略禁用 networkidle，一律关键元素/文本等待

- sessions 等页面挂 SSE 长连接（fetch-sse），networkidle 会永久挂起。
- 统一 waitForPageText / getByRole(...).toBeVisible 模式（multica helpers 同款）。

## D-006@v1 顺手移除 devDependencies 中的 puppeteer 残留

- puppeteer ^24.43 在 frontend/src 零引用（grep 核实），与 @playwright/test 功能重叠且拖慢 install（下载 Chrome 二进制）。
- @playwright/test ^1.60 保留复用。用户确认轮次：需求澄清轮。

## D-007@v1 CI 触发 paths 仅 frontend/** + workflow_dispatch，backend 变更不自动触发

- backend-ci 已覆盖后端单测；e2e job（build+install 约 10-15min）挂在 backend PR 会显著拖慢后端迭代。
- 后端接口变更影响 e2e 时随时 workflow_dispatch 手动跑，或 frontend 侧变更自然触发。

## D-008@v1 e2e 环境登录限流放宽 AUTH_LOGIN_RATE_LIMIT_PER_MINUTE=60

- type: feasibility
- priority: P0
- status: accepted
- source: design-grill（B-1）
- question: 登录限流默认 5 次/60s/IP 且**成败均计数**（captcha_service.py:56-71，config.py:157-161），单 run ≈8 次登录（admin 造数 1 + nav beforeEach 4 + auth.spec 3），TestApiClient 与浏览器（经 rewrites 代理同源出口）对后端同 IP——workers:1 只消除并发不减少计数，不放宽则首跑必 429。
- answer: CI backend env 与本机 backend/.env 均设 `AUTH_LOGIN_RATE_LIMIT_PER_MINUTE=60`（Settings 无 env_prefix，config.py:460-465，env 名直接生效）。可选优化（不阻塞）：fixtures 每 run 复用同一 token 把登录数降至 2。
- impacts: [e2e-ci.yml, e2e/README.md]
- evidence: captcha_service.py:56-71, config.py:157-161/460-465

## D-009@v1 vitest 显式 exclude e2e/**，双测试栈隔离

- type: consistency
- priority: P1
- status: accepted
- source: design-grill（B-2）
- question: frontend/vitest.config.ts 无 include 配置，vitest 默认 include `**/*.{test,spec}.?()` 必收集 `e2e/*.spec.ts`（playwright spec 在 vitest 下必然报错），`pnpm test` 与 frontend-ci.yml 直接红。
- answer: vitest.config.ts 增 `exclude: ["e2e/**", ...configDefaults.exclude]`，vitest 与 playwright 互不收集。
- impacts: [frontend/vitest.config.ts, frontend-ci]
- evidence: vitest.config.ts:5-35（无 include 字段）


## D-010@v1 e2e 环境变量改外部注入，不引入 dotenv 依赖

- type: feasibility
- priority: P2
- status: accepted
- source: execute（task-02 偏差定案）
- question: design §5.1 原写 dotenv 加载 e2e/.env.e2e，但 frontend 无 dotenv 依赖，且 Wave 2 并行约束禁止 task-02 动 package.json（task-07 正在改）。
- answer: env.ts 直读 process.env，由外部注入——本机 shell `set -a; source frontend/e2e/.env.e2e; set +a` 或 CI env 块直接注入；缺失必需变量时中文报错带修复指引。后续如需更顺滑可评估 node --env-file（node 版本约束）或补 dotenv 依赖，属独立优化。
- impacts: [e2e/env.ts, task-05 README, e2e-ci.yml]
- evidence: execute task-02 子代理报告（require.resolve('dotenv') 失败）
