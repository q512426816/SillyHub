---
author: qinyi
created_at: 2026-08-29 14:41:30
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 开发者 | 本机跑 e2e 验证改动的工程师（前置 dev 环境后 `pnpm test:e2e`） |
| CI | GitHub Actions e2e job（services 容器 + 生产 build 形态自动跑同一套用例） |
| 冒烟用户 | run-id 唯一测试用户（挂 workspace:read 角色），代表普通登录用户视角 |

## 功能需求

### FR-01: Playwright 基础设施
覆盖决策：D-001@v1, D-005@v1
Given frontend 目录存在 @playwright/test devDep
When 新增 `frontend/playwright.config.ts`（chromium 单浏览器 / workers:1 / timeout 60s / retries CI?1:0 / trace retain-on-failure / locale zh-CN / baseURL 走 E2E_BASE_URL 默认 localhost:3000）与 `"test:e2e": "playwright test"` script
Then `pnpm test:e2e` 可发现并执行 `frontend/e2e/*.spec.ts`，不配置 webServer（本机手动前置）

### FR-02: 测试身份与数据准备
覆盖决策：D-002@v2
Given bootstrap 平台管理员凭据（E2E_BOOTSTRAP_EMAIL/PASSWORD，本机 backend/.env 或 CI env）
When 每次测试运行
Then admin 先 `POST /api/admin/roles` 幂等创建角色（key=`e2e_smoke_<runid>` 下划线、permission_keys=["workspace:read"]），再 `POST /api/admin/users` 创建 `e2e-<runid>@test.local` 用户（username 必填、密码 ≥8 含字母数字、传 role_ids、请求体遵守 extra=forbid），run-id 每次运行唯一

### FR-03: API 登录与会话注入
覆盖决策：D-003@v1
Given FR-02 创建的冒烟用户
When TestApiClient 调 `POST /api/auth/login`（首登无 captcha）+ `GET /api/auth/me`
Then `page.addInitScript` 注入 `localStorage["multi-agent-platform.session"]`，格式 `{state:{hydrated:true,user,accessToken,refreshToken},version:1}`，user 字段复刻 fetchMe 落盘映射（displayName 驼峰、permissions 取自 me 顶层），浏览器会话即已登录

### FR-04: 真实 UI 登录链路用例（auth.spec）
Given dev 环境前后端在跑
When 执行 4 用例：A1 未登录访问 /workspaces 重定向 /login；A2 表单登录成功跳 /workspaces 且 PageHeader/侧边栏可见且 localStorage 有 token；A3 错误密码停留 /login 且错误提示可见（单次失败）；A4 登出回 /login 且 token 清空
Then 全部断言通过；等待策略一律关键元素/文本，禁用 networkidle（SSE 长连接）

### FR-05: 导航冒烟用例（navigation.spec）
覆盖决策：D-002@v2
Given FR-03 注入登录的冒烟用户（挂 workspace:read）
When 执行 4 用例：N1 /workspaces 列表页渲染（PageHeader「选择工作区」/列表容器）；N2 侧边栏→智能体会话 /sessions；N3 侧边栏→智能体档案 /agent-profiles、技能管理 /settings/skills；N4 负向断言「API 密钥」「Git 身份管理」等 admin 权限菜单不可见
Then 全部断言通过

### FR-06: 本机运行文档与凭据卫生
Given 开发者首次使用 e2e 体系
When 阅读 `frontend/e2e/README.md`
Then 可按文档完成前置（dev compose 起 pg/redis、backend/.env 含 bootstrap admin + `AUTH_LOGIN_RATE_LIMIT_PER_MINUTE=60`、uvicorn :8000、next dev :3000）并运行 `pnpm test:e2e`；`e2e/.env.e2e` 被 gitignore，仓库提供 `e2e/.env.e2e.example` 模板

### FR-07: CI e2e job
覆盖决策：D-004@v1, D-007@v1, D-008@v1
Given push/PR 触发 paths frontend/**（或手动 workflow_dispatch）
When e2e-ci.yml 执行：services postgres:16 + redis:7 → uv sync → uvicorn（env 含 AUTH_LOGIN_RATE_LIMIT_PER_MINUTE=60、bootstrap admin，轮询 GET /api/health 校验 body status=="ok"）→ pnpm build + next start :3000 → playwright install chromium → pnpm test:e2e
Then job 在 20min 超时内全绿；失败时 playwright-report/ 与 test-results/ 上传为 artifact

### FR-08: 双测试栈隔离与类型覆盖
覆盖决策：D-009@v1
Given vitest.config.ts 无 include 配置（默认必扫 e2e/*.spec.ts）
When 修改 vitest.config.ts 显式 `exclude: ["e2e/**", ...defaults]` 且根 tsconfig include 增 `e2e/**/*.ts`
Then `pnpm test` 不收集 e2e 用例（157 个现有测试不受影响）；`pnpm typecheck` 覆盖 e2e 代码

### FR-09: 依赖清理
覆盖决策：D-006@v1
Given frontend devDependencies 含零引用的 puppeteer
When 移除 puppeteer 并更新 pnpm-lock.yaml（与 package.json 同 commit）
Then 依赖树无 puppeteer，`pnpm install --frozen-lockfile` 一致，@playwright/test 保留

## 非功能需求

- 兼容性：本机运行路径全用 node/playwright 内置能力（无 bash 专属逻辑），Windows/Linux/macOS 均可跑（CLAUDE.md 规则 13）；CI 走 ubuntu-latest
- 可回退：纯新增测试体系，回退=删除新增文件 + 还原 package.json/lockfile/tsconfig/vitest.config/gitignore 五处修改，无数据/ schema 影响
- 可测试：用例自身即交付物；验收=本机实跑全绿 + CI 首跑绿（design §9）
- 稳定性：run-id 唯一数据天然隔离；限流放宽（D-008@v1）防 429；A3 单次失败不触发 captcha 阈值（3 次）

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 方案 C 总选型（骨架贴 multica + 唯一化 + CI 生产化） |
| D-002@v2 | FR-02, FR-05 | 冒烟身份挂 workspace:read 角色（supersedes D-002@v1） |
| D-003@v1 | FR-03 | API 登录 + localStorage persist v1 注入 |
| D-004@v1 | FR-07 | CI 用 next build+start |
| D-005@v1 | FR-01, FR-04 | 禁 networkidle，关键元素等待 |
| D-006@v1 | FR-09 | 移除 puppeteer |
| D-007@v1 | FR-07 | CI 触发仅 frontend paths |
| D-008@v1 | FR-06, FR-07 | 登录限流放宽 60/min |
| D-009@v1 | FR-08 | vitest exclude e2e |

（全部当前版本决策均已覆盖，无剩余风险项。）
