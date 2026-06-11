---
schema_version: 1
doc_type: module-card
module_id: build
author: qinyi
created_at: 2026-06-10T16:55:00
---

# build

## 定位
构建和部署配置。包含 Next.js 构建、Docker 构建等配置。

## 契约摘要
- `next.config.mjs` — Next.js 配置
  - standalone 输出模式（NEXT_BUILD_STANDALONE=1 时启用）
  - API 代理 rewrite：`/api/:path*` → 后端 `${apiBaseUrl}/api/:path*`
  - typedRoutes 实验性特性
  - reactStrictMode + poweredByHeader: false
- `Dockerfile`（在 backend/ 目录，此处仅记录前端构建相关）
- `tsconfig.json` — TypeScript 配置（含 `@/` 路径别名）

## 关键逻辑
- API 代理通过 Next.js rewrites 实现，所有 `/api/*` 请求转发到后端
- 环境变量优先级：INTERNAL_API_BASE_URL > NEXT_PUBLIC_API_BASE_URL > http://localhost:8000
- standalone 模式用于 Docker 部署优化

## 注意事项
- 修改 rewrite 规则会影响所有 API 调用
- typedRoutes 会在构建时检查路由类型安全

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
