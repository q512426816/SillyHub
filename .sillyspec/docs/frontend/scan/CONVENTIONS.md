---
author: qinyi
created_at: 2026-05-29T17:38:00
---

# CONVENTIONS — frontend

## 框架隐形规则

- Next.js App Router 强制页面组件使用 `export default`。
- `(auth)` 路由组：无 auth guard、无 sidebar。
- `(dashboard)` 路由组：客户端 auth guard 检查 Zustand store 的 `accessToken`，缺失则重定向 `/login`。
- Zustand store 使用 `persist` middleware，localStorage key: `multi-agent-platform.session`。
- 所有 API 调用通过 `src/lib/api.ts` 的 `apiFetch<T>()` 统一处理：
  - 自动添加 Authorization Bearer header
  - 401 自动 refresh token → 重试（通过 `x-auth-retry: 1` header 防止循环）
  - 失败则清除 session 并跳转 `/login`
- Tailwind 颜色使用 CSS 变量 + HSL 的 shadcn/ui 语义 token 体系。

## 实体继承规范

- 无 ORM 层。TypeScript 类型在各 `src/lib/*.ts` 中与 API 函数共存。
- `interface` 用于实体数据结构（`Workspace`, `AgentRun`）和组件 Props（`ButtonProps`）。
- `type` 用于联合字面量（`RiskLevel`, `IncidentStatus`）和简单别名（`Component = { ... }`）。
- 约 90+ 导出类型分布在 19 个领域模块中。

## 代码风格

| 维度 | 约定 | 一致性 |
|------|------|--------|
| 文件命名 | kebab-case | 100% |
| 组件命名 | PascalCase | 100% |
| 函数命名 | camelCase + CRUD 动词前缀 | 100% |
| 导出模式 | 页面 `export default`，组件命名导出 | 100% |
| API 函数 | `export function` 声明式，无箭头函数 | 100% |
| CSS | Tailwind utility + shadcn/ui 语义 token | 100% |
| TypeScript | strict + noUncheckedIndexedAccess | 100% |
| 测试 | Vitest + jsdom + Testing Library | — |
| 路径别名 | `@` → `./src` | — |
