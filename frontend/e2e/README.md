# frontend/e2e — Playwright 端到端测试

## 概述

本目录存放 SillyHub 前端的 Playwright 端到端（E2E）回归冒烟测试，定位为**回归冒烟**：覆盖登录/导航等核心链路，不追求全量 UI 覆盖。

目录结构：

- `env.ts` — 环境变量读取（见下方"环境变量"）
- `fixtures.ts` — `TestApiClient`：直连后端 API 的轻量测试数据客户端（原生 fetch，零 `src/` 依赖）
- `helpers.ts` — `createE2EContext()`（一站式搭建冒烟身份）与 `loginAsE2e()`（localStorage 注入会话）
- `auth.spec.ts` / `navigation.spec.ts` — 冒烟用例

配置在 `frontend/playwright.config.ts`：仅 chromium、`workers: 1`（串行）、失败时保留 trace（`retain-on-failure`）。

## 环境变量（D-010@v1）

本项目**不依赖 dotenv**，`env.ts` 直读 `process.env`，因此必须在启动 Playwright 前把变量注入 shell：

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `E2E_BASE_URL` | 否 | `http://localhost:3000` | 前端（被测应用）地址 |
| `E2E_API_URL` | 否 | `http://localhost:8000` | 后端 API 地址 |
| `E2E_BOOTSTRAP_EMAIL` | 是 | — | 引导管理员邮箱 |
| `E2E_BOOTSTRAP_PASSWORD` | 是 | — | 引导管理员密码 |

## 本机前置（四步）

1. **基础设施**：用 `deploy/docker-compose.dev.yml` 启动 PostgreSQL / Redis。
2. **后端配置**：`backend/.env` 按模板 `backend/.env.example` 配置，必须包含
   `PLATFORM_BOOTSTRAP_ADMIN_EMAIL` / `PLATFORM_BOOTSTRAP_ADMIN_PASSWORD`，**并且**
   设置 `AUTH_LOGIN_RATE_LIMIT_PER_MINUTE=60`。
   > 限流说明：登录接口默认限流为 5 次/60s/IP，且登录**成功与失败均计数**。单次完整 e2e run 约 8 次登录，不放宽则第 6 次会得到 429。
3. **启动后端**：`uv run uvicorn app.main:app --reload`（监听 :8000）。
4. **启动前端**：`pnpm dev`（监听 :3000）。

> 替代方案（已实测可行）：复用本机 Docker 全栈（`deploy/docker-compose.yml`，
> frontend 映射 :3001、backend 映射 :8001）——生产形态更接近 CI。此时
> `.env.e2e` 写 `E2E_BASE_URL=http://localhost:3001`、
> `E2E_API_URL=http://localhost:3001`（**API 走前端 /api 代理**：Windows 上
> Node fetch 直连 Docker 映射端口会被 reset，经前端容器代理则稳定）；限流
> 放宽须写入 `deploy/.env` 并 `docker compose up -d backend` 重建容器生效。
> 注意 bootstrap 管理员密码若与 DB 中不一致（bootstrap 只在账号不存在时创建），
> 需自行重置；后端登录 account 是**登录名（username）**而非邮箱（D-001）。

## 首次准备

```bash
cd frontend/e2e
cp .env.e2e.example .env.e2e
# 编辑 .env.e2e，填写 E2E_BOOTSTRAP_EMAIL / E2E_BOOTSTRAP_PASSWORD
# （取值与 backend/.env 的 PLATFORM_BOOTSTRAP_ADMIN_* 一致）
```

`.env.e2e` 含明文密码，已被 gitignore，**禁止提交仓库**。

加载并运行（Git Bash，Windows 下推荐）：

```bash
cd frontend
set -a; source e2e/.env.e2e; set +a
pnpm test:e2e
```

PowerShell 用户可改用 `$env:E2E_BOOTSTRAP_EMAIL="..."; $env:E2E_BOOTSTRAP_PASSWORD="..."` 逐个注入，或直接使用 Git Bash。

## 运行与调试

```bash
# 全量（需先按上述方式注入环境变量）
pnpm test:e2e

# 单个 spec
pnpm exec playwright test e2e/auth.spec.ts

# 有头模式观察交互
pnpm exec playwright test e2e/auth.spec.ts --headed

# 失败后查看 trace（trace 按 retain-on-failure 保留在 test-results/）
pnpm exec playwright show-trace test-results/<失败用例目录>/trace.zip
```

## CI 说明

CI 由 `.github/workflows/e2e-ci.yml`（task-06）承载：services 起 pg/redis，以生产 build 形态构建前端，环境变量通过 workflow 的 `env` 块注入（无需 shell source），失败时上传 trace artifact。

## 注意事项

- **captcha 阈值**：登录失败达 3 次阈值后会触发人机确认。A3（错误密码）用例按"单次失败"设计；反复连续运行会使失败计数累积进而触发 captcha，导致用例不稳定。若遇此情况，等待限流窗口过期或重启后端后重试。
- 测试以 `workers: 1` 串行执行，请不要在本地并行开启多个 run。

## 扩展指引（新增 spec）

1. 新建 `e2e/<name>.spec.ts`，从 `./helpers` 导入 `createE2EContext` 与 `loginAsE2e`：

   ```ts
   import { test, expect } from "@playwright/test";
   import { createE2EContext, loginAsE2e } from "./helpers";

   test("示例用例", async ({ page }) => {
     const ctx = await createE2EContext(); // admin 登录 → 幂等建角色 → 建 run-id 用户 → 用户登录
     await loginAsE2e(page, ctx);          // localStorage 注入会话，免 UI 登录
     // ... 断言
   });
   ```

2. **等待策略**：禁用 `networkidle`（dev server 长连接会导致永久等待），使用 `await page.goto(url)` 后按可见性/`waitForResponse` 等待具体元素或接口。
3. 测试数据一律通过 `ctx.api`（`TestApiClient`）创建，带 run-id 隔离，不污染固定数据。
4. 会话注入格式集中在 `helpers.ts` 单点维护（与 `src/stores/session.ts` 的 zustand persist 形状严格一致），不要在 spec 里手写 localStorage。
