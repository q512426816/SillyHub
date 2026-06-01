---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# 编码规范与约定

## TypeScript 规范

### 严格模式

项目启用 TypeScript strict 模式，额外开启 `noUncheckedIndexedAccess`。

```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "target": "ES2022",
  "moduleResolution": "bundler"
}
```

### 类型定义约定

- 每个 API 模块文件内联定义所需类型（不使用独立的 types/ 目录）
- 使用 `type` 关键字声明类型别名（而非 `interface`），但两者混用也常见
- 后端响应类型以 `Read` / `Response` / `List` 后缀命名：
  - `Workspace` — 单个对象
  - `WorkspaceListResponse` — 分页列表 `{ items, total }`
  - `ChangeRead` — 详细读模型 (extends summary)
  - `ChangeSummary` — 列表摘要模型
- 请求参数类型以 `Input` / `Request` 后缀命名：
  - `CreateChangeInput` — 创建请求体
  - `UpdateIncidentInput` — 更新请求体
- 枚举使用联合类型 (`type Status = "open" | "closed"`) 而非 enum

### 路径别名

```typescript
// tsconfig.json
{
  "baseUrl": ".",
  "paths": { "@/*": ["./src/*"] }
}
```

所有 import 统一使用 `@/` 前缀：
```typescript
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useSession } from "@/stores/session";
```

## React 组件规范

### 组件声明

- 函数组件使用 `function` 声明（非箭头函数）
- Props 使用 `interface` 定义，命名为 `Props`：
  ```typescript
  interface Props {
    open: boolean;
    workspace: Workspace | null;
    onClose: () => void;
  }
  export function ComponentDetailDrawer({ open, workspace, onClose }: Props) { ... }
  ```
- 页面组件接收 `params` prop（Next.js 约定）：
  ```typescript
  interface Props { params: { id: string } }
  export default function WorkspaceDetailPage({ params }: Props) { ... }
  ```

### "use client" 指令

- 几乎所有业务页面和业务组件都标记 `"use client"`
- 仅根 `layout.tsx` 为服务端组件
- DashboardLayout 为客户端组件（需读取 Zustand store）

### Hooks 使用模式

- 状态管理：`useState` + `useEffect` 手动 fetch 模式（占主导）
- 路由：`useRouter` / `usePathname` (next/navigation)
- 全局状态：`useSession()` 从 Zustand store 读取
- 侧边栏折叠状态：`useState` + `localStorage` 持久化
- 轮询：`useEffect` + `setInterval`（如 HealthCard 每 5s 轮询）

### 条件渲染与加载态

页面级组件采用三段式渲染：

```typescript
if (loading) return <div>加载中...</div>;
if (!workspace) return <div>错误信息</div>;
return <main>...</main>;
```

### 样式约定

- 全部使用 Tailwind CSS 原子类，无 CSS Modules
- 使用 `cn()` (clsx + tailwind-merge) 合并条件类名
- 字号倾向使用硬编码值：`text-xs` (12px), `text-[11px]`, `text-sm` (14px), `text-base` (16px)
- 组件间距：`gap-5` (section), `gap-2` (元素), `gap-6` (大区块)
- 卡片结构：`rounded-md border bg-card` + `border-b px-4 py-2.5` header
- 表格：`globals.css` 中定义的统一表格样式
- 深色模式：CSS 变量切换，Tailwind `darkMode: ["class"]`

## API 调用模式

### 统一 fetch 封装

所有 API 调用通过 `apiFetch<T>()` 发起：

```typescript
// GET 请求
const data = await apiFetch<WorkspaceListResponse>("/api/workspaces");

// POST 请求
const result = await apiFetch<Workspace>("/api/workspaces", {
  method: "POST",
  json: { name: "test", root_path: "/path" },
});

// 带查询参数
const data = await apiFetch<ChangeList>(
  `/api/workspaces/${id}/changes?status=active`
);
```

### 错误处理

```typescript
try {
  const data = await someApiCall();
} catch (err) {
  const msg = err instanceof ApiError
    ? `${err.code}: ${err.message}`
    : "操作失败";
  setError(msg);
}
```

### API 模块组织

每个 API 文件遵循统一结构：

```typescript
import { apiFetch } from "./api";

// ── 类型定义 ──
export type SomeType = { ... };
export interface SomeResponse { ... }

// ── API 函数 ──
export function listItems(workspaceId: string) {
  return apiFetch<SomeResponse>(`/api/workspaces/${workspaceId}/items`);
}

export function createItem(workspaceId: string, input: SomeInput) {
  return apiFetch<Item>(`/api/workspaces/${workspaceId}/items`, {
    method: "POST",
    json: input,
  });
}
```

### Token 管理

- Token 存储在 Zustand store (`useSession`)，自动持久化到 localStorage
- `apiFetch` 每次请求自动从 store 读取 `accessToken` 并附加 `Authorization: Bearer` 头
- 401 响应自动触发 token refresh 流程
- Refresh 失败自动清除 store 并重定向到 `/login`
- SSE 连接通过 URL query 参数传递 token (`?token=xxx`)

## 命名约定

### 文件命名

- 页面：`page.tsx` (Next.js 约定)
- 布局：`layout.tsx` (Next.js 约定)
- 组件：`kebab-case.tsx`（如 `app-shell.tsx`, `workspace-card.tsx`）
- API 模块：`kebab-case.ts`（如 `scan-docs.ts`, `git-gateway.ts`）
- Store：`kebab-case.ts`（如 `session.ts`）

### 变量命名

- 组件：`PascalCase` (`WorkspaceCard`, `HealthCard`)
- 函数：`camelCase` (`listChanges`, `apiFetch`)
- 类型/接口：`PascalCase` (`ChangeSummary`, `ApiErrorPayload`)
- 常量：`UPPER_SNAKE_CASE` (`SYNC_STATUS_VARIANT`, `COLLAPSED_KEY`)
- CSS 类：Tailwind 原子类，不使用自定义 CSS class 命名

### 路由参数

- 动态段：`[id]`, `[cid]`, `[tid]`, `[iid]`
- params 对象：`params.id`, `params.cid` 等

## ESLint 规则

```json
{
  "extends": ["next/core-web-vitals"],
  "rules": {
    "no-unused-vars": ["warn", {
      "argsIgnorePattern": "^_",
      "varsIgnorePattern": "^_"
    }]
  }
}
```

- 未使用变量前缀 `_` 可消除警告
- 继承 Next.js 推荐的 Web Vitals 规则
