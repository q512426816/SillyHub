---
author: qinyi
created_at: 2026-08-29 14:18:27
change: 2026-08-29-frontend-e2e-playwright
scale: large
status: drafted
---

# 设计文档 — frontend 浏览器级 E2E 测试体系（Playwright）

## 1. 背景与目标

### 1.1 现状问题（file:line 均已核实）

1. **浏览器级 E2E 是测试版图的明确空洞**：`.sillyspec/docs/SillyHub/scan/TESTING.md` §覆盖与门禁已记录——「前端 devDeps 声明 `@playwright/test ^1.60` 与 `puppeteer ^24.43` 两套浏览器自动化依赖，但仓库内无 playwright 配置文件，浏览器 E2E 套件实际未配置」。frontend 现有 157 个 vitest+jsdom 测试全部是 mock 驱动的组件/逻辑测试，无一条真实浏览器链路。
2. **puppeteer 零引用残留**：grep 核实 `frontend/src` 中无任何 puppeteer 引用，纯残留依赖，拖慢 install（Chrome 二进制下载）。
3. **关键链路只有 mock 视角**：登录/登出/跳转、侧边栏导航、页面可达性等链路在 jsdom mock 下验证的是「组件按预期调用 mock」，不是「真实页面真的能走到」；middleware 移动端分流也只有纯函数单测。

### 1.2 参照体系（C:\Users\qinyi\IdeaProjects\multica）

multica 的 e2e 体系（本设计的参照物，均已通读）：

- 根级 `playwright.config.ts`：极简——chromium only / workers:1 / retries:0 / timeout 60s / baseURL 走 env / **不自动起服务**（服务必须在跑）。
- `e2e/env.ts`：dotenv 加载 `.env.worktree`/`.env`。
- `e2e/fixtures.ts`：`TestApiClient`——原生 fetch 调后端 API 做数据 setup/teardown，零构建时耦合。
- `e2e/helpers.ts`：run-id 唯一化 email/workspace（`E2E_RUN_ID = Date.now+pid`）、`loginAsDefault`（API 登录 → `addInitScript` 注 localStorage token）、`waitForPageText`。
- spec 按功能域拆分（navigation/auth/settings/issues…），`beforeEach` 统一登录。

### 1.3 目标

- G1 建立 frontend 浏览器级 E2E 基础设施（config + fixtures + helpers + 运行脚本），后续用例可低成本扩展。
- G2 首批覆盖两条冒烟链路：真实 UI 登录/登出（auth.spec）、登录后侧边栏导航（navigation.spec）。
- G3 双环境可运行：本机（dev 环境前置，multica 哲学）+ CI（独立 e2e job，services 容器 + 生产 build）。
- G4 清理 puppeteer 残留依赖。

## 2. 方案选型（D-001@v1）

| 维度 | A multica 复刻 | B 全自动零前置 | **C（选定）** |
|---|---|---|---|
| 测试数据 | 固定账号（env） | 同 A 或 C | **run-id 唯一用户，天然隔离** |
| CI frontend 形态 | next dev | 同 | **next build+start（近生产）** |
| 本机前置 | 手动 | playwright webServer 全编排 | **手动（服务在跑，测试专注测）** |
| 落地速度 | 最快 | 最慢 | 中 |
| Windows 风险 | 低 | **最高**（进程编排/僵尸进程） | 低 |

选 C 的完整理由与备选否决原因见 `decisions.md` D-001@v1。用户已在方案选择轮确认。

## 3. 总体设计

### 3.1 目录结构与配置

```
frontend/
├─ playwright.config.ts        # 新增
├─ e2e/                        # 新增目录（6 文件）
│  ├─ env.ts
│  ├─ fixtures.ts
│  ├─ helpers.ts
│  ├─ auth.spec.ts
│  ├─ navigation.spec.ts
│  └─ README.md
```

`playwright.config.ts` 要点：

- `testDir: "./e2e"`，`timeout: 60000`，`workers: 1`（串行：测试数据无竞争 + 避免并发突发；登录计数上限由 R8 限流放宽兜底——串行本身不减少计数，Design Grill 复核 NP-4 修正表述）。
- `retries: process.env.CI ? 1 : 0`（CI flaky 兜底一次，本机不重试暴露真问题）。
- projects：仅 `chromium`（冒烟单浏览器，后续可加 firefox/webkit）。
- `use.baseURL`：`process.env.E2E_BASE_URL ?? "http://localhost:3000"`；`locale: "zh-CN"`（UI 中文，getByRole name 中文匹配）；`trace: "retain-on-failure"`。
- reporter：list + html。
- **不配置 webServer**（D-001：本机手动前置）。

`package.json` 变更：

- 新增 `"test:e2e": "playwright test"`。
- 移除 devDependencies 的 `puppeteer`（D-006@v1）；`@playwright/test` 复用现有 `^1.60`。
- e2e 代码纳入 `tsc --noEmit` typecheck 范围：**锁定方案=根 tsconfig 的 include 增 `e2e/**/*.ts`**（`typecheck` script 只用根 tsconfig，`frontend/package.json:10`；独立 e2e/tsconfig.json 不会被 tsc --noEmit 消费，与覆盖目标矛盾——Design Grill XC-21 定案）。

### 3.2 测试身份与数据策略（D-002@v2）

双轨身份：

1. **造数身份（bootstrap admin）**：凭 `PLATFORM_BOOTSTRAP_ADMIN_EMAIL/PASSWORD`（本机 `backend/.env`、CI env 注入）走 `POST /api/auth/login` 拿 admin token。TestApiClient 以此身份调用 admin API。bootstrap 在 lifespan 无环境门槛执行（`backend/app/main.py:129-131`），平台管理员短路拥有 USER_WRITE（`rbac.py:121-122`）。
2. **冒烟身份（run-id 唯一用户 + workspace:read 角色，D-002@v2）**：每次测试运行：
   - admin 经 `POST /api/admin/roles` 幂等创建角色，**key 用下划线 `e2e_smoke_<runid>`**（`RoleCreateRequest.key` 校验 `pattern=^[a-z][a-z0-9_]*$` 仅小写字母/数字/下划线，连字符 422——Design Grill 复核 NP-1 定案），`permission_keys: ["workspace:read"]`；
   - admin 经 `POST /api/admin/users` 创建 `e2e-<runid>@test.local`（传 `role_ids` 挂上述角色），run-id = `Date.now().toString(36) + pid`（multica 同款）。

   **为什么必须挂角色（Design Grill B-3 定案）**：`GET /api/workspaces` 要求 `WORKSPACE_READ`（`workspace/router.py:261-264`），无权限用户 403、列表容器不渲染（`workspaces/page.tsx:246` ErrorBanner）——登录默认跳转页 /workspaces 的列表断言（N1）与 A2 页面关键元素都依赖该权限，故「挂 workspace:read 角色」从风险预案升级为主路径。

   **建户载荷硬约束（Design Grill XC-12 + 复核 NP-1 核实）**：
   - `POST /api/admin/users`：请求体 `extra=forbid`（`admin/schema.py:199`）；`username` 必填（min_length=3，`:209`）；`password` ≥8 且须同时含字母与数字（`security.py:87-100`）；
   - `POST /api/admin/roles`：请求体 `extra=forbid`（`admin/schema.py:30-36`）；`key` 须匹配 `^[a-z][a-z0-9_]*$`（`:32`）；`permission_keys` 接受 `workspace:read`（`permissions.py:55`）；
   - CI 的 `PLATFORM_BOOTSTRAP_ADMIN_PASSWORD` 取值须避开弱口令黑名单（`config.py:502-524`）。

   用户随运行累积，无清理负担（测试库/CI 每次全新；本机 dev 库累积无害）。

权限模型约束（已核实 `frontend/src/lib/menu-permissions.ts`）：

- 挂 workspace:read 角色后，侧边栏可见：**工作区首页（/workspaces，命中 workspace:read）+ 智能体档案（/agent-profiles）+ 智能体会话（/sessions）+ 技能管理（/settings/skills）**（后三项 `permissions:[]` 对所有登录用户可见，`menu-permissions.ts:217,231,189`；技能管理实路径 `/settings/skills`，`:186`——Design Grill B-4 修正）。
- config/system 组子菜单各有独立权限（api_key:admin / settings:admin 等），冒烟身份不可见 → 负向断言素材。

### 3.3 登录与注入（D-003@v1）

- **API 登录**（除 auth.spec 外所有用例的 beforeEach）：`POST /api/auth/login {account, password}`——首登无 captcha（captcha 仅同 IP 失败计数达阈值后触发，`backend/app/modules/auth/captcha_service.py:109-113`）→ 拿 `access_token/refresh_token` → `GET /api/auth/me` 拿 user → `page.addInitScript` 注入：

```json
localStorage["multi-agent-platform.session"] =
  "{\"state\":{\"hydrated\":true,\"user\":{...},\"accessToken\":\"...\",\"refreshToken\":\"...\"},\"version\":1}"
```

格式精确匹配 zustand persist 落盘形状（`frontend/src/stores/session.ts:63-77`，`PersistedSessionEnvelope`）。**user 字段形状（Design Grill XC-02 核实）**：不是 `UserRead` 原样——须复刻 `fetchMe` 的落盘映射（`frontend/src/lib/auth.ts:15-22`）：`displayName` 驼峰降级合并、`permissions` 取自 `GET /api/auth/me` **顶层** `permissions` 字段（`MeResponse={user,workspaces,permissions}`，`router.py:172-186`）合并进 user。helpers 内集中封装注入函数，杜绝形状漂移。

- **UI 登录**（仅 auth.spec）：真实走 `/login` 表单（账号+密码，平台选 sillyhub），覆盖跳转 `/workspaces`（`PLATFORM_REDIRECT`，`frontend/src/app/(auth)/login/page.tsx:28-31`）。

### 3.4 等待策略铁律（D-005@v1）

一律关键元素/文本等待（`waitForPageText` / `getByRole(...).toBeVisible`），**禁用 `networkidle`**——sessions 等页面挂 SSE 长连接（fetch-sse 流），networkidle 永久挂起。页面加载用 `waitUntil: "domcontentloaded"`。

## 4. 首批用例清单

### 4.1 auth.spec.ts（真实 UI 登录链路）

| # | 用例 | 断言 |
|---|---|---|
| A1 | 未登录访问受保护页（如 /workspaces）重定向 /login | URL 变为 /login（机制=客户端守卫 `(dashboard)/layout.tsx:29-32` replace） |
| A2 | 表单登录成功 | 跳转 /workspaces + **PageHeader/侧边栏关键元素可见**（非列表容器——无工作区时列表为空态，`workspaces/page.tsx:224` PageHeader 恒渲染）+ localStorage 出现 token |
| A3 | 错误密码登录失败 | 停留 /login + 错误提示可见（**单次失败**，阈值 3 次才触发 captcha，`config.py:162`） |
| A4 | 登出 | 回 /login + localStorage token 清空 + 受保护页再跳 /login |

### 4.2 navigation.spec.ts（登录后导航冒烟，beforeEach 用 API 登录注入）

| # | 用例 | 断言 |
|---|---|---|
| N1 | /workspaces 列表页渲染 | URL 正确 + PageHeader「选择工作区」/列表容器可见（冒烟身份挂 workspace:read 角色，`GET /api/workspaces` 200，D-002@v2） |
| N2 | 侧边栏导航到智能体会话 /sessions | URL 变化 + 会话页关键元素可见 |
| N3 | 侧边栏导航到智能体档案 /agent-profiles、技能管理 **/settings/skills** | URL 变化 + 页面关键元素可见 |
| N4 | 负向：无权限菜单不显示 | 「API 密钥」「Git 身份管理」等需独立 admin 权限的菜单项在侧边栏不可见 |

> 具体断言元素（中文 aria/文本）execute 时按实际 DOM 校正；本表锁定行为契约。

## 5. 双环境编排

### 5.1 本机（手动前置，multica 哲学）

前置（README.md 写明）：

1. `docker compose -f deploy/docker-compose.dev.yml up -d` 起 postgres/redis（已有 dev 环境可跳过）。
2. `backend/.env` 配好 `DATABASE_URL/REDIS_URL/SECRET_KEY/PLATFORM_BOOTSTRAP_ADMIN_EMAIL/PASSWORD`（模板 `backend/.env.example`），**并设 `AUTH_LOGIN_RATE_LIMIT_PER_MINUTE=60`**（Design Grill B-1：默认 5 次/60s/IP 且登录成败均计数 `captcha_service.py:56-71`，单 run ≈8 次登录，不放宽则同一分钟内第 6 次登录 429），`uv run uvicorn app.main:app --reload`（:8000）。
3. `pnpm dev`（frontend :3000）。
4. `cd frontend && pnpm test:e2e`。

环境变量（`e2e/env.ts` 读取，全部有默认值）：

| 变量 | 默认 | 说明 |
|---|---|---|
| E2E_BASE_URL | http://localhost:3000 | 前端入口（浏览器访问） |
| E2E_API_URL | http://localhost:8000 | TestApiClient 直连后端 |
| E2E_BOOTSTRAP_EMAIL / E2E_BOOTSTRAP_PASSWORD | 无默认（必填） | 造数身份凭据 |

dotenv 加载顺序：`frontend/e2e/.env.e2e` → `frontend/.env`（存在则读，兼容本机习惯）。**凭据卫生（Design Grill XC-23）**：`frontend/e2e/.env.e2e` 加入 .gitignore，仓库提供 `frontend/e2e/.env.e2e.example` 模板（含上述变量名与占位值）。

### 5.2 CI（新增 .github/workflows/e2e-ci.yml）

- 触发：`push`/`pull_request` paths `frontend/**` + `.github/workflows/e2e-ci.yml` + `workflow_dispatch`（backend 变更不自动触发，D-007@v1）。
- services：`postgres:16-alpine`（health `pg_isready`）+ `redis:7-alpine`（health `redis-cli ping`）。
- 步骤（frontend 用生产形态 next build+start，D-004@v1）：
  1. checkout → setup pnpm 9.6 + Node 20 → `pnpm install --frozen-lockfile`。
  2. setup uv → `uv sync --all-extras`。
  3. 起 backend：env `DATABASE_URL=postgresql+asyncpg://postgres:postgres@postgres:5432/platform`（services 别名）、`REDIS_URL=redis://redis:6379/0`、`SECRET_KEY`、`PLATFORM_BOOTSTRAP_ADMIN_EMAIL/PASSWORD`（避开弱口令黑名单 `config.py:502-524`）、`AUTH_LOGIN_RATE_LIMIT_PER_MINUTE=60`（Design Grill B-1：单 run ≈8 次登录成败均计数，默认 5/min/IP 必 429）、`CORS_ALLOWED_ORIGINS=["http://localhost:3000"]` → `uv run uvicorn app.main:app --port 8000 &` → 轮询 `GET /api/health` 就绪（恒 200，**校验 body `status=="ok"`** 以覆盖 db/redis 降级场景，`health/router.py:1-5,53`）。
  4. `pnpm build` + `pnpm start &`（next start :3000，env `INTERNAL_API_BASE_URL=http://localhost:8000` 供 rewrites）。
  5. `pnpm exec playwright install --with-deps chromium`。
  6. `pnpm test:e2e`（env：E2E_BOOTSTRAP_* 等）。
  7. 失败时 upload artifact：`playwright-report/`、`test-results/`。
- `timeout-minutes: 20`。

## 6. 文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `frontend/playwright.config.ts` | 新增 | §3.1 配置 |
| `frontend/e2e/env.ts` | 新增 | dotenv + E2E_* 常量 |
| `frontend/e2e/fixtures.ts` | 新增 | TestApiClient（admin 登录 / 幂等建角色 / 创建 run-id 用户挂 role_ids / 用户登录 / me） |
| `frontend/e2e/helpers.ts` | 新增 | createE2EUser / loginAsE2E（注入，复刻 fetchMe user 映射）/ waitForPageText / run-id 常量 |
| `frontend/e2e/auth.spec.ts` | 新增 | A1-A4 |
| `frontend/e2e/navigation.spec.ts` | 新增 | N1-N4 |
| `frontend/e2e/README.md` | 新增 | 本机前置/运行/CI 说明 |
| `frontend/e2e/.env.e2e.example` | 新增 | 凭据模板（.env.e2e 本体 gitignore，XC-23） |
| `frontend/package.json` | 修改 | +test:e2e script；-puppeteer devDep |
| `frontend/pnpm-lock.yaml` | 修改 | 移除 puppeteer 后 lockfile 更新（与 package.json 同 commit，保 frozen-lockfile 一致） |
| `frontend/tsconfig.json` | 修改 | include 增 `e2e/**/*.ts`（typecheck 覆盖 e2e，XC-21 定案） |
| `frontend/vitest.config.ts` | 修改 | **显式 exclude `e2e/**`**（默认 include `**/*.{test,spec}.?()` 必收集 e2e/*.spec.ts，不排除则 `pnpm test` 与 frontend-ci 直接红，Design Grill B-2） |
| `frontend/.gitignore` | 修改 | +`test-results/`、`playwright-report/`、`e2e/.env.e2e` |
| `.github/workflows/e2e-ci.yml` | 新增 | §5.2 |

不改任何 backend / 业务前端代码——纯测试体系建设。

## 7. 接口依赖（消费的既有契约，不新增后端接口）

| 接口 | 用途 | 源码位置 |
|---|---|---|
| `POST /api/auth/login` | 登录拿 TokenPair（首登无 captcha） | backend/app/modules/auth/router.py:67 |
| `GET /api/auth/me` | 拿 user + 顶层 permissions（注入 localStorage 的 user 字段） | backend/app/modules/auth/router.py:172 |
| `POST /api/admin/roles` | admin 幂等创建 e2e-smoke 角色（挂 workspace:read） | backend/app/modules/admin/router.py:90 |
| `POST /api/admin/users` | admin 创建 run-id 唯一用户（USER_WRITE 权限，传 role_ids） | backend/app/modules/admin/router.py:464 |
| `GET /api/health` | CI backend 就绪探测（恒 200，轮询校验 body `status=="ok"`） | backend/app/modules/health/router.py:53（main.py:756 挂载 prefix=/api）——Design Grill XC-14 定案 |

## 8. 生命周期契约

**不涉及生命周期契约**。本变更为前端测试基础设施建设，不改动任何业务实体的状态机、租约、心跳或状态流转；文中出现的 session 字样均指登录会话的 localStorage 持久化（zustand persist）与认证会话概念，非 agent_run/daemon 会话实体。

## 9. 测试策略（e2e 自身的验证方式）

- 体系落地验证 = 本机 dev 环境实跑 `pnpm test:e2e` 全绿（真实浏览器 + 真实后端）。
- CI 验证 = e2e-ci.yml 首跑绿（push 分支触发验证）。
- 既有测试影响论证：不改 frontend/src 业务代码 → 157 个现有测试零影响；`pnpm typecheck` 覆盖面扩大到 e2e（新增代码自身须过 tsc）。
- `pnpm test`（vitest）与 `pnpm test:e2e`（playwright）隔离：vitest.config.ts **无 include 配置，默认 include `**/*.{test,spec}.?()` 必收集 `e2e/*.spec.ts`**（Design Grill B-2 核实）——已将 `exclude: ["e2e/**", ...defaults]` 列为必改项（§6），双测试栈互不收集。

## 10. 风险登记

| # | 风险 | 缓解 |
|---|---|---|
| R1 | ~~/workspaces 无权限渲染未实测~~ **已核实并定案（Design Grill B-3）**：`GET /api/workspaces` 要求 WORKSPACE_READ（`workspace/router.py:261-264`），无权限用户 403、列表容器不渲染；路由本身可达（`(dashboard)/layout.tsx:22` 白名单） | 已升级为主路径：冒烟身份挂 workspace:read 角色（D-002@v2），A2/N1 断言按 PageHeader+列表容器定义 |
| R2 | 本机反复跑 A3（错误密码）按 IP 累积失败计数，达阈值（3 次，`config.py:162`）触发 need_captcha | A3 设计为单次失败；README 注明阈值行为；CI 每次全新 runner 无影响 |
| R3 | CI 时长（install + build + 首跑）可能顶 20min | 并行度低（workers:1 但用例少）；chromium 单浏览器；超时预算已含裕量，实测后调整 |
| R4 | ~~e2e 目录被 vitest 误扫（若默认 include 命中）~~ **已定案（Design Grill B-2）**：vitest 无 include 配置，默认必扫 e2e/*.spec.ts | vitest.config.ts 显式 `exclude: ["e2e/**", ...defaults]`（§6 必改项） |
| R5 | zustand persist 格式未来变化（version 升级/partialize 调整）破坏注入 | helpers 内集中封装注入函数 + 注释指向 session.ts 落盘形状；变更点单一 |
| R6 | playwright 版本升级破坏 API | devDep 锁 ^1.60 与 multica（^1.58）同代，短期稳定 |
| R7 | UI 原型核对：本变更不生成 prototype-*.html | 原因：纯测试代码与 CI 配置，无 UI 设计改动，跳过原型 |
| R8 | 登录限流与用例数冲突（Design Grill B-1）：默认 5 次/60s/IP 成败均计数，单 run ≈8 次登录必 429 | 已定案缓解（D-008@v1）：CI backend env `AUTH_LOGIN_RATE_LIMIT_PER_MINUTE=60`（§5.2）；本机 README 同项说明（§5.1）；可选优化=fixtures 每 run 复用 token 降登录数 |

## 11. Non-Goals（不在范围内）

- 不覆盖业务深水区用例（workspace 创建向导、会话发起流、文件预览、PPM 等）——后续变更按域扩展。
- 不做移动端 /m/ UA 分流与主题切换 e2e（需求澄清轮用户未选）。
- 不做 Firefox/WebKit 多浏览器矩阵（chromium 单浏览器起步）。
- 不做本机一键全自动编排（方案 B 否决，D-001）。
- 不做视觉回归（screenshot diff）。
- 不改任何 backend 与 frontend 业务代码。

## 12. 自审（Self-Review）

| 检查项 | 结果 |
|---|---|
| 章节齐全（背景/目标/选型/总体/清单/接口/风险/Non-Goals） | ✅ §1-11 |
| frontmatter 字段齐全（author/created_at/change/scale/status） | ✅ |
| 生命周期关键词命中（session）已豁免 | ✅ §8 明确「不涉及生命周期契约」 |
| 决策可追溯（decisions.md D-001~D-009，design 内引用） | ✅ |
| 用户确认点完整（目标/环境/范围/依赖清理/方案 C/设计 5 Phase/审查修正） | ✅ 三轮 AskUserQuestion |
| 无编造方法：消费的 API 均已 grep 核实存在（§7 表含 file:line） | ✅（Design Grill XC-10~XC-14 逐条复核） |
| UI 原型缺位原因已登记 | ✅ R7 |
| Design Grill 独立审查 4 blocker（B-1~B-4）+ 7 条精度修正 | ✅ 全部按用户确认落盘（R1/R4/R8 定案、D-002@v2、§5/§6/§7 同步） |

## 13. 后续阶段

brainstorm 完成 → `sillyspec run plan --change 2026-08-29-frontend-e2e-playwright` 拆 Wave 与 Task。
