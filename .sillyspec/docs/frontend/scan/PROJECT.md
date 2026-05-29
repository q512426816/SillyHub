---
author: qinyi
created_at: 2026-05-29T17:42:00
---

# PROJECT — frontend

## 项目信息

- **名称**：multi-agent-platform-web
- **版本**：0.1.0
- **语言**：TypeScript 5.5.4 (strict)
- **框架**：Next.js 14.2.5 (App Router)
- **包管理**：pnpm 9.6.0
- **Node 要求**：>= 20
- **端口**：3000

## 技术栈

| 维度 | 技术 |
|------|------|
| 框架 | Next.js 14 App Router |
| UI | React 18 + Tailwind CSS 3.4 (shadcn/ui) |
| 状态管理 | Zustand 4.5 (persist) |
| 数据获取 | 自定义 `apiFetch` (原生 fetch) |
| 拓扑图 | @xyflow/react 12.10 |
| 验证 | Zod 3.23 |
| 测试 | Vitest 2 + Testing Library + jsdom |
| Lint | ESLint 8 + TypeScript strict |

## 路由概览

- **(auth)**：1 个路由（登录）
- **(dashboard)**：21 个路由（工作区详情 + 设置）
- **总计**：22 个页面路由

## API 层

21 个 API 模块（`src/lib/*.ts`），每个对应一个后端业务域，统一通过 `apiFetch<T>()` 调用后端 `/api` 端点。

## 验证命令

```bash
make frontend-run          # pnpm dev
make frontend-test         # pnpm test
make frontend-lint         # pnpm lint
make frontend-typecheck    # pnpm typecheck
make frontend-build        # pnpm build
```
