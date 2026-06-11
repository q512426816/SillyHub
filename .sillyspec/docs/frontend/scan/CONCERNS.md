---
author: qinyi
created_at: 2026-06-10T00:00:00
---

# Frontend 代码债务 / 风险

## 🔴 严重

### 1. 未使用 React Query — 数据获取缺少缓存和状态管理

虽然 `package.json` 中安装了 `@tanstack/react-query`，但全部数据获取通过 `useEffect` + `useState` 手动管理。这导致：
- 页面切换后重新进入时重复请求
- 无请求去重，同一数据可能并发请求多次
- 无后台刷新 (stale-while-revalidate)
- Loading/error 状态在每个组件中重复处理

**涉及**: 所有 23 个页面组件

### 2. 全部 CSR — 未利用 Next.js SSR/RSC 能力

所有页面组件均标记 `"use client"`，导致：
- 首屏渲染依赖客户端 JS 加载完成
- SEO 完全不可用（虽然作为管理平台影响较小）
- 无法利用 Server Components 减少客户端 JS bundle
- 无 `loading.tsx` / `error.tsx` 内置加载和错误状态

**涉及**: `src/app/` 下所有页面

### 3. 测试覆盖极低 — 仅 3 个 API 单元测试

23 个页面组件、20+ 个 API 客户端模块、1 个 SSE 流客户端、1 个 Zustand store — 仅 `src/lib/__tests__/` 下 3 个测试文件。无组件测试、无集成测试、无 E2E 测试。

**涉及**: 整个前端项目

## 🟡 中等

### 4. 样式拼接不一致 — cn() 定义但未统一使用

`src/lib/utils.ts` 定义了 `cn()` 工具函数 (clsx + tailwind-merge)，但大部分组件直接使用模板字符串拼接 Tailwind 类名。这可能导致：
- 类名冲突无法自动合并
- 条件样式逻辑分散，维护成本高

**涉及**: `app-shell.tsx`, `workspace-card.tsx` 等组件

### 5. 页面组件过于庞大 — 缺少抽象

多个页面组件（如 workspaces/[id]/page.tsx, changes/page.tsx）内联了大量业务逻辑（数据获取、状态管理、UI 渲染），未拆分为自定义 hook 和子组件。单个文件可能超过 200 行。

**涉及**: `src/app/(dashboard)/workspaces/[id]/` 下的页面

### 6. API 客户端类型与后端手动同步

前端 `src/lib/*.ts` 中的接口类型（如 `Workspace`, `ChangeRead`）是手动定义的，未从后端 schema 自动生成。前后端类型不同步可能导致运行时错误。

**涉及**: `src/lib/` 下所有 API 文件

### 7. 认证 Token 存储在 localStorage

Zustand persist 默认使用 localStorage 存储 access_token 和 refresh_token。虽然简化了实现，但存在 XSS 攻击风险。

**涉及**: `src/stores/session.ts`

## 🟢 轻微

### 8. Emoji 作为导航图标

`AppShell` 侧边栏使用 emoji 字符作为图标（如 `\u{1F3E0}` 用于 Home），跨平台渲染不一致。

**涉及**: `src/components/app-shell.tsx`

### 9. 未使用 Zod 进行运行时校验

安装了 `zod` 但未在代码中使用。前端接收后端数据后直接 `as T` 类型断言，无运行时校验。

**涉及**: `src/lib/api.ts` 及所有调用方

### 10. 无全局错误边界

缺少 Next.js `error.tsx` 错误边界和 React Error Boundary，未捕获的异常会导致白屏。

**涉及**: `src/app/` 全局

### 11. 未使用 TypeScript 严格索引访问的潜力

配置了 `noUncheckedIndexedAccess: true`，但部分代码仍使用 `any` 类型（如 `capabilities: Record<string, any>`）。

**涉及**: `src/lib/daemon.ts` 等

## 代码质量

- **Lint**: ESLint (eslint-config-next)，运行 `pnpm lint`
- **类型检查**: TypeScript strict mode (`tsc --noEmit`)
- **格式化**: 无统一 formatter（无 Prettier 配置）
- **提交检查**: 无 pre-commit hook
- **Bundle 分析**: 未配置
- **代码复杂度**: 多个页面组件超过 200 行，缺少自定义 hook 抽象

## 依赖风险

| 依赖 | 风险 | 说明 |
|------|------|------|
| `@tanstack/react-query` | 🟡 死依赖 | 已安装未使用，增加 bundle 大小 |
| `puppeteer` | 🟡 死依赖 | 已安装未使用，体积大 (~300MB) |
| `@playwright/test` | 🟡 死依赖 | 已安装无测试文件 |
| `next@14.2.5` | 🟢 版本锁 | App Router 稳定版，无重大 bug |
| `zustand@4.5` | 🟢 版本锁 | 成熟稳定，API 变更风险低 |
