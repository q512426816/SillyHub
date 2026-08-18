---
schema_version: 1
doc_type: module-card
module_id: build
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 构建与工具链配置（build）

## 定位
前端工程构建与工具链配置集合（frontend 根 8 个配置文件）。定义脚本命令、依赖版本、路径别名、代理规则、测试环境与 Docker 产物形态，是本地 dev、CI 构建、镜像产出的总开关。

## 契约摘要
- `package.json`：name `multi-agent-platform-web`；`engines.node >= 20`、`packageManager pnpm@9.6.0`。
  - scripts：`dev` / `build` / `start` / `lint`（next lint）/ `typecheck`（tsc --noEmit）/ `test`（vitest run）/ `test:watch` + **`gen:types`**（OpenAPI → `src/lib/api-types.ts`，scripts/gen-api-types.mjs）+ **`gen:types:check`**（生成后 `git diff --exit-code src/lib/api-types.ts` 防漂移）。
  - 关键 deps：next 14.2.5、react 18.3.1、antd ^6.4.4 + @ant-design/icons + nextjs-registry、@tanstack/react-query + react-virtual、zustand ^4.5、dayjs、echarts 6 + echarts-for-react、@xyflow/react、zod、lucide-react、@uiw/react-markdown-preview + rehype-sanitize、radix 原语（dialog/dropdown-menu/avatar）、@fontsource/inter。
  - devDeps：vitest 2 + @testing-library(react/jest-dom) + jsdom、openapi-typescript、puppeteer、@playwright/test、eslint-config-next。
- `next.config.mjs`：
  - `reactStrictMode`、`poweredByHeader:false`、`experimental.typedRoutes:true`、`experimental.optimizePackageImports:[antd, @ant-design/icons, lucide-react, @xyflow/react]`（重依赖命名导入按需转换，减 chunk 加速构建）。
  - `output: standalone` 仅当 `NEXT_BUILD_STANDALONE=1`（Docker 用；本地 dev 不启用）。
  - rewrites 两条：`/api/:path*` 与 `/daemon/:path*`（daemon 安装脚本/版本清单公开端点，backend dist_router 提供无 /api 前缀）→ `${apiBase}` 同名路径；apiBase = `INTERNAL_API_BASE_URL ?? NEXT_PUBLIC_API_BASE_URL ?? http://localhost:8000`（去尾斜杠）。
- `tsconfig.json`：ES2022、`strict` + `noUncheckedIndexedAccess`、moduleResolution bundler、别名 `@/* → ./src/*`、`types` 含 vitest/globals + @testing-library/jest-dom、include 含 `.next/types/**/*.ts`（typedRoutes 生成类型）。
- `tailwind.config.ts`：darkMode class；content 三目录（app/components/lib）；shadcn 语义色 hsl(var(--…)) + hex 调色板；container 居中 2xl:1280。
- `vitest.config.ts`：jsdom + globals + `setupFiles: src/test/setup.ts`；`clearMocks:true`（明确**不用** restoreMocks——大量测试在 describe/beforeAll 级持久 mock，restore 会还原实现致 21 用例红）；`testTimeout:15000`（治全量并行 jsdom flaky 超时）；`environmentMatchGlobs` 把纯逻辑 lib 测试（白名单精确到文件名）切 node 环境省 jsdom 启动。
- `postcss.config.mjs`：tailwindcss + autoprefixer。
- `Dockerfile`：多阶段（deps → builder → runtime），`node:20-slim` 基底；corepack enable pnpm + `COREPACK_NPM_REGISTRY=npmmirror` 规避国内拉 pnpm tarball TLS 失败；standalone 产物拷入最小运行镜像。
- `components.json`：shadcn CLI 配置（style default、rsc、tsx、slate baseColor、cssVariables、别名 `@/components` / `@/lib/utils` / `@/components/ui`）。

## 关键逻辑
```
代理: rewrites = [{/api/:path* → ${apiBase}/api/:path*},
                  {/daemon/:path* → ${apiBase}/daemon/:path*}]  // apiBase 优先 INTERNAL
类型: pnpm gen:types = 后端 OpenAPI → api-types.ts（禁手写）
      gen:types:check = 生成后 git diff --exit-code（CI 防漂移门）
Docker: deps(pnpm install) → builder(next build, STANDALONE=1)
        → runtime(拷 standalone 产物入 slim 镜像)
```

## 注意事项
- **api-types.ts 必须生成、禁手写**：后端 schema 有改动的 change 内必须跑 `pnpm gen:types` 并提交 api-types.ts + openapi.json；node_modules 半坏会产生**假的** `CSSProperties 不存在某属性` / `Cannot find module '@ant-design/icons'` 报错，先 `pnpm install --force` 再排查代码。
- `typedRoutes:true` 校验 `<Link href>` 合法性：新页面路由需 `next build` / typecheck 生成 `.next/types` 后才过；拼动态路径须满足类型约束。
- `noUncheckedIndexedAccess` 索引访问返回 `T|undefined`，新代码须显式判空。
- `/daemon/*` rewrite 是 daemon 安装链路（`curl | bash` 拉 install.sh、latest.json、bundle 都经前端代理到 backend）依赖，勿删；只代理 /api 会让安装脚本 404。
- vitest 勿动 restoreMocks 与 node 环境白名单，除非先全量跑红绿；启用 restoreMocks 需先把 describe 级 spy 下沉 beforeEach。
- 路径别名 `@/*` 在 tsconfig / vitest / next 三处须一致；Docker 构建用 pnpm frozen-lockfile，本地 lockfile 缺失首次需 `--no-frozen-lockfile` 回退。
- react-query 已实际投入使用（会话门户 / changes 列表 / hooks 层），与自封装 apiFetch 双轨并存：新代码按域内既有惯例选型，勿在同一数据流混用两套缓存。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
