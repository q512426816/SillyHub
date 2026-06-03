---
author: qinyi
created_at: 2026-06-03T10:00:00
---

# CONCERNS — frontend

## 高优先级

### 测试覆盖极低
仅 3 个测试文件（6 个用例），覆盖 `api.ts`、`agent.ts`、`spec-workspaces.ts`。其余 23 个 lib 文件、22 个页面、7 个组件完全没有测试。任何重构都可能引入回归 bug。

### `as any` 类型逃逸
`api.ts:154` 使用 `as any` 强制类型转换，说明 API 响应类型定义不完整。

## 中优先级

### React Query 未充分使用
已引入 `@tanstack/react-query` 但实际使用很少。当前数据获取主要靠 lib 层直接 fetch，缺少缓存、重试、失效策略。

### 组件数量少
仅 7 个组件（含 `ui/` 基础组件），22 个页面中可能有大量内联逻辑。随着功能增长，需要拆分更多可复用组件。

### 硬编码路径
`next.config.mjs` 中 API 代理默认指向 `http://localhost:8000`，Docker 环境需通过 `INTERNAL_API_BASE_URL` 覆盖。

## 低优先级

### 无 TODO/FIXME
源码中没有 TODO 或 FIXME 标记，代码库较干净。

### Tailwind 主题系统
使用 CSS 变量主题系统（HSL 格式），支持 dark mode。当前主题配置较基础。

## 依赖风险

### Next.js 14 锁定
使用 Next.js 14.2.5，App Router API 在 15.x 有较大变更，升级需要评估。

### pnpm 版本锁定
`packageManager: pnpm@9.6.0`，Corepack 管理版本。

### @xyflow/react
流程图组件，版本 12.x，API 可能在后续版本变化。
