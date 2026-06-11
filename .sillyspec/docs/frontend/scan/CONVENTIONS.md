---
author: qinyi
created_at: 2026-06-10T00:00:00
---

# Frontend 代码约定

## 框架隐形规则

### Next.js App Router

- **路由分组**: 使用 `(dashboard)` 和 `(auth)` 路由组控制布局嵌套，不影响 URL。
- **全部 `"use client"`**: 当前所有页面组件均标记为客户端组件，无 Server Components 使用。
- **无 `loading.tsx` / `error.tsx`**: 未使用 Next.js 内置的加载和错误边界文件。
- **Metadata 导出**: 仅在 `src/app/layout.tsx` 中导出静态 metadata，页面级无 metadata。

### TypeScript

- **strict 模式**: `strict: true` + `noUncheckedIndexedAccess: true`。
- **路径别名**: `@/*` 映射到 `./src/*`，在 tsconfig 和 vitest.config 中均配置。
- **接口命名**: API 响应类型使用 `interface`（如 `Workspace`, `ChangeRead`），复合类型使用 `type`。
- **命名约定**:
  - 页面: `export default function XxxPage()`
  - 组件: `export function Xxx({ ... })`
  - API 函数: `export async function xxxYyy()`
  - 类型: PascalCase，后缀 `Input`/`Response`/`List`/`Read`

## 代码风格

### API 调用模式

所有后端调用通过 `apiFetch` 统一封装，每个业务域一个文件：

```typescript
// src/lib/workspaces.ts
export async function listWorkspaces(): Promise<WorkspaceListResponse> {
  return apiFetch<WorkspaceListResponse>("/api/workspaces");
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
  return apiFetch<Workspace>("/api/workspaces", {
    method: "POST",
    json: input,
  });
}
```

### 页面组件模式

页面组件直接调用 API 函数，使用 `useState` + `useEffect` 管理数据获取：

```typescript
"use client";
import { useState, useEffect } from "react";

export default function SomePage() {
  const [data, setData] = useState(null);
  useEffect(() => {
    fetchData().then(setData);
  }, []);
  // ... render
}
```

### 状态管理模式

Zustand + persist middleware，store 定义包含接口、状态、actions：

```typescript
interface SessionState extends SessionTokens {
  hydrated: boolean;
  user: SessionUser | null;
  setUser: (_user: SessionUser | null) => void;
  setTokens: (_tokens: SessionTokens) => void;
  clear: () => void;
}

export const useSession = create<SessionState>()(
  persist((set) => ({ ... }), { name: "storage-key" })
);
```

### 样式约定

- 使用 Tailwind CSS + shadcn/ui CSS Variables 主题系统。
- 颜色通过 HSL 变量定义：`hsl(var(--primary))`。
- 条件样式使用模板字符串拼接 Tailwind 类名。
- 工具函数 `cn()` (clsx + tailwind-merge) 在 `src/lib/utils.ts` 中定义，但当前组件中直接拼接类名居多。

### 组件结构

- shadcn/ui 基础组件放在 `src/components/ui/`，使用 CVA (class-variance-authority)。
- 业务组件放在 `src/components/`，直接导出命名函数。
- 复杂组件拆分子模块目录：如 `agent-log/` 下含 `normalize.ts`、`tool-renderers.tsx`、`types.ts`。

## 典型代码模式

1. **API 客户端文件**: `src/lib/xxx.ts` — 定义类型接口 + 导出 async 函数
2. **页面组件**: `"use client"` + useState/useEffect + API 调用 + JSX 渲染
3. **布局守卫**: `(dashboard)/layout.tsx` 检查 session → 无 token 重定向
4. **SSE 流式客户端**: `AgentRunStreamClient` 类封装 EventSource + 自动重连
5. **导航配置**: `AppShell` 中定义 `NavItem[]` 数组，支持相对/绝对路径解析
