---
author: qinyi
created_at: 2026-05-29T17:42:00
---

# CONCERNS — frontend

## 严重

- **测试覆盖极低**：22 个页面 + 21 个 API 模块 + 5 个业务组件，仅有 1 个测试文件（67 行）。页面组件、业务逻辑、状态管理均无测试覆盖。
- **@tanstack/react-query 未使用但存在于 dependencies**：增加 bundle 体积，可能误导后续开发者。

## 中等

- **@xyflow/react 仅在拓扑页使用**：大型依赖（~300KB gzip）仅用于单个页面，应考虑 `next/dynamic` 动态导入。
- **`app-shell.tsx:82` 直接使用原生 fetch** 而非 `apiFetch`，绕过了统一的认证/错误处理。
- **`src/app/(dashboard)/releases/` 目录存在但为空**：可能是未完成的功能或遗留目录。
- **无 TypeScript 运行时验证**：Zod 已安装但未广泛使用，API 响应数据未经验证直接使用。

## 低

- **ESLint 配置最小**：仅 `next/core-web-vitals` + `no-unused-vars`，缺少 import 排序、TypeScript 严格规则。
- **无错误边界（Error Boundary）**：页面级错误可能导致整个应用崩溃。
- **12 个 HTML 原型**（`prototype/`）可能与实际实现不同步。
