---
author: qinyi
created_at: 2026-06-03T10:00:00
---

# CONVENTIONS — frontend

## 命名规范

- **文件命名**: `kebab-case.tsx`（如 `workspace-card.tsx`, `scan-docs.ts`）
- **目录命名**: `kebab-case/`（如 `scan-docs/`, `create-change/`）
- **组件命名**: `PascalCase` 函数组件（如 `AppShell`, `WorkspaceCard`）
- **Lib 文件**: `kebab-case.ts`，与后端模块名对应（如 `changes.ts`, `agent.ts`）
- **页面文件**: 统一 `page.tsx`（Next.js App Router 约定）

## 框架隐形规则

### Next.js App Router
- 路由组 `(auth)` 和 `(dashboard)` 用于布局分组，不影响 URL
- `layout.tsx` 定义嵌套布局
- `page.tsx` 是路由入口，必须是 default export
- API Routes 位于 `src/app/api/`

### API 代理
所有 `/api/*` 请求通过 `next.config.mjs` rewrites 代理到后端：
```javascript
rewrites() → /api/:path* → http://localhost:8000/api/:path*
```

## 组件规范

### 函数组件 + 命名导出
```tsx
export function WorkspaceCard({ workspace, onChanged }: Props) { ... }
```
- 不使用 default export（有利于 tree-shaking 和重构）
- Props 使用内联类型或 `interface Props`

### UI 组件
`components/ui/` 下是基础 UI 原子组件（如 Badge），使用 CVA（class-variance-authority）管理变体。

## 代码风格

- **ESLint**: eslint-config-next
- **TypeScript**: 严格模式，`tsconfig.json`
- **路径别名**: `@/` → `src/`
- **CSS**: Tailwind CSS + CSS 变量主题系统

## API 调用规范

### Lib 层封装
每个后端模块对应一个 lib 文件，封装 API 调用：
```typescript
// src/lib/workspaces.ts
export async function listWorkspaces() { ... }
export async function createWorkspace(data: CreateWorkspaceInput) { ... }
```

### 认证
API 调用自动携带 session store 中的 access token。

### SSE 流
Agent 模块使用 SSE 流式通信（`src/lib/agent-stream.ts`）。

## 状态管理规范

### Zustand
- 全局 store 在 `src/stores/` 下
- `session.ts`: 用户会话（token + user info），使用 `persist` 中间件
- 页面级状态优先使用 React state，跨页面状态使用 Zustand

### React Query
已引入 `@tanstack/react-query` 但当前使用较少，主要数据获取通过 lib 层直接 fetch。
