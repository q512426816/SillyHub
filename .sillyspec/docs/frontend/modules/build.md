---
schema_version: 1
doc_type: module-card
module_id: build
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:04
---
# build

## 定位
前端工程构建与工具链配置集合。涵盖 Next.js 构建配置（含 API 代理 rewrite、standalone 输出、typedRoutes）、TypeScript 严格类型、Tailwind 主题映射、PostCSS、Vitest 测试配置、Docker 多阶段构建、shadcn components.json 别名。定义脚本命令、依赖版本、路径别名与构建产物形态，是本地 dev、CI 构建、Docker 镜像产出的总开关。

## 契约摘要
- `package.json`：
  - name `multi-agent-platform-web`，private。
  - scripts：`dev`(next dev) / `build`(next build) / `start`(next start) / `lint`(next lint) / `typecheck`(tsc --noEmit) / `test`(vitest run) / `test:watch`。
  - 关键 deps：next 14.2.5、react 18.3.1、antd ^6.4.4、@ant-design/icons、tailwindcss-animate、clsx + tailwind-merge、class-variance-authority、zustand ^4.5、@tanstack/react-query、dayjs、echarts + echarts-for-react、@xyflow/react（拓扑）、zod、lucide-react、@uiw/react-markdown-preview。
  - devDeps：@testing-library/react+jest-dom、@vitejs/plugin-react、vitest、eslint-config-next、autoprefixer、@playwright/test。
- `next.config.mjs`：`reactStrictMode`、`poweredByHeader:false`、`experimental.typedRoutes:true`、`output: "standalone"`（仅 `NEXT_BUILD_STANDALONE=1` 时）、`rewrites()` 把 `/api/:path*` 代理到 `INTERNAL_API_BASE_URL ?? NEXT_PUBLIC_API_BASE_URL ?? http://localhost:8000`。
- `tsconfig.json`：`target ES2022`、`strict` + `noUncheckedIndexedAccess`、`moduleResolution: bundler`、路径别名 `@/* → ./src/*`、`types: ["vitest/globals","@testing-library/jest-dom"]`、next plugin。
- `tailwind.config.ts`：darkMode class、content 三目录、语义色 hsl(var) + 调色板 hex、font-family 接 next/font Inter、shadow/radius/animation（sh- 前缀避免冲突）、tailwindcss-animate 插件。
- `postcss.config.mjs`：tailwindcss + autoprefixer。
- `vitest.config.ts`：jsdom、globals、setupFiles、`@` 别名、plugin-react。
- `Dockerfile`：多阶段（deps → builder → runtime），pnpm + npmmirror 加速、standalone 产物拷入最小运行镜像。
- `components.json`：shadcn 配置（style default、rsc、tsx、slate baseColor、cssVariables、别名 `@/components`/`@/lib/utils`/`@/components/ui`）。

## 关键逻辑
API 代理（本地 dev 与 SSR）：
```
rewrites(): [{
  source: "/api/:path*",
  destination: `${apiBase}/api/:path*`,   // apiBase 优先 INTERNAL_API_BASE_URL
}]
```
Docker 构建链：
```
deps:    pnpm install（frozen-lockfile，npmmirror 加速）
builder: next build（NEXT_BUILD_STANDALONE=1 → output standalone）
runtime: 拷 standalone 产物 + node_modules + public 到 node:slim 镜像
```

## 注意事项
- **API 代理走 Next rewrite**：前端统一请求 `/api/**`，由 Next 转发到后端；容器内 `INTERNAL_API_BASE_URL` 指向后端服务名，外网用 `NEXT_PUBLIC_API_BASE_URL`。改后端地址只需调 env，不动代码。
- `typedRoutes: true` 会校验 `<Link href>` 的路由合法性，新增页面需导出对应类型，拼动态路径需满足类型约束。
- standalone 输出仅 `NEXT_BUILD_STANDALONE=1` 启用（Docker 用），本地 dev 不受影响。
- `noUncheckedIndexedAccess: true` 是严格项：数组/对象索引访问返回 `T | undefined`，需显式判空，新代码易踩。
- 路径别名 `@/*` 是全仓约定，tsconfig / vitest / eslint / next 四处须一致。
- Docker 构建用 pnpm，本地若无 lockfile 首次会 `--no-frozen-lockfile` 回退。
- @tanstack/react-query 虽在依赖中，但数据层主用自封装 apiFetch（非 react-query）——见技术栈说明，混用时注意不要双轨。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
