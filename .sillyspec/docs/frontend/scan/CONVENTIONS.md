---
author: qinyi
created_at: 2026-06-03T20:35:00+08:00
---

# Frontend - 编码规范和约定

## 命名规范

### 文件命名

| 类别 | 规范 | 示例 |
|------|------|------|
| 页面文件 | `page.tsx`（Next.js 约定） | `app/(dashboard)/workspaces/page.tsx` |
| 布局文件 | `layout.tsx`（Next.js 约定） | `app/(dashboard)/layout.tsx` |
| 路由处理器 | `route.ts`（Next.js 约定） | `app/api/.../stream/route.ts` |
| 组件文件 | `kebab-case.tsx` | `workspace-card.tsx`, `health-card.tsx` |
| API 客户端 | `kebab-case.ts` | `agent-stream.ts`, `scan-docs.ts` |
| 测试文件 | `被测模块名.test.ts` | `api.test.ts`, `agent.test.ts` |
| 目录 | `kebab-case/` | `scan-docs/`, `create-change/` |

### 代码命名

| 类别 | 规范 | 示例 |
|------|------|------|
| React 组件 | `PascalCase` 函数组件 | `AppShell`, `WorkspaceCard`, `HealthCard` |
| 组件导出 | 命名导出（`export function`） | `export function Badge(...) {}` |
| UI 原子组件 | `React.forwardRef` + `export const` | `export const Button = React.forwardRef(...)` |
| 类型/接口 | `PascalCase` | `ApiError`, `Workspace`, `AgentRun` |
| API 函数 | `camelCase` 动词开头 | `listWorkspaces`, `getChange`, `createWorkspace` |
| 工具函数 | `camelCase` | `apiFetch`, `cn`, `getApiBaseUrl` |
| CSS 变量 | `--kebab-case` | `--background`, `--primary-foreground` |
| 环境变量 | `SCREAMING_SNAKE_CASE` | `INTERNAL_API_BASE_URL`, `NEXT_PUBLIC_API_BASE_URL` |
| Store hooks | `use` 前缀 | `useSession` |
| 常量 | `SCREAMING_SNAKE_CASE` | `OVERVIEW_NAV`, `COLLAPSED_KEY` |

## 组件设计约定

### 页面组件

所有业务页面遵循统一模式：

```tsx
"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
// 导入 UI 组件
// 导入 API 函数和类型
// 导入 ApiError

interface Props {
  params: { id: string };
}

export default function XxxPage({ params }: Props) {
  // 1. 状态声明
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 2. 数据加载（useEffect + async IIFE）
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchXxx();
        if (!cancelled) setItems(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  // 3. 事件处理函数
  const handleAction = async () => { ... };

  // 4. 渲染（统一错误提示、加载状态、空态）
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
      {/* 页面头部 */}
      {/* 错误提示 */}
      {/* 内容区 */}
    </div>
  );
}
```

关键约定：
- 所有业务页面标记 `"use client"`
- 使用 `let cancelled` + cleanup 防止卸载后 setState
- 错误处理统一模式：`err instanceof ApiError ? err.message : "默认错误消息"`
- 页面使用 `export default function` 默认导出

### 业务组件

- 使用 `"use client"` 标记
- Props 使用 `interface Props` 内联定义，紧跟在 imports 之后
- 状态管理用 `useState`，不引入额外状态库
- 使用命名导出（`export function ComponentName`）

### UI 原子组件

`components/ui/` 下的基础组件遵循 shadcn/ui 风格：
- 使用 `class-variance-authority` (CVA) 管理 variant 和 size
- 使用 `cn()` 工具函数（clsx + tailwind-merge）合并 className
- 交互组件使用 `React.forwardRef` 转发 ref
- 通过 `VariantProps<typeof xxxVariants>` 导出变体类型

## 样式约定

### Tailwind CSS 使用

- **布局**: `flex`, `grid`, `gap-*` 为主要布局手段
- **间距**: 统一使用 `px-6 py-6`（页面级）或 `px-3 py-2`（卡片级）或 `px-4 py-2.5`（卡片头部）
- **最大宽度**: `max-w-5xl`（列表页）或 `max-w-6xl`（详情页）或 `max-w-3xl`（首页）
- **圆角**: `rounded-md`（主要容器）、`rounded`（小元素如按钮）
- **边框**: `border` + `bg-card` 构成卡片样式，`border-b` 用于分隔线
- **字号**: `text-xs`（辅助信息 11px）、`text-sm`（正文 13px）、`text-base`（标题 16px）
- **颜色**: 优先使用语义化颜色（`text-foreground`, `text-muted-foreground`, `text-destructive`）

### 主题系统

通过 CSS 变量定义 HSL 颜色值，在 `globals.css` 中配置：

```css
:root {
  --background: 210 20% 98%;
  --foreground: 215 25% 15%;
  --primary: 215 55% 28%;
  --primary-foreground: 210 40% 98%;
  --card: 0 0% 100%;
  --muted: 215 16% 92%;
  --muted-foreground: 215 12% 45%;
  --destructive: 0 72% 51%;
  --border: 215 16% 88%;
  --input: 215 16% 88%;
  --ring: 215 55% 28%;
  --radius: 0.375rem;
  --success: 152 60% 35%;
  --warning: 38 92% 50%;
}
```

支持 dark mode（`.dark` 类切换），Tailwind 配置 `darkMode: ["class"]`。Dark mode 变量也定义在 `globals.css` 的 `.dark` 选择器中。

### 字体

系统字体栈，优先中文友好字体：
```
-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
"Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif
```

基础字号 `14px`，行高 `1.5`。

### 统一文本样式

通过 `globals.css` 中 `@layer base` 定义标题和表格基础样式：
- `h1`: `text-xl font-semibold tracking-tight`
- `h2`: `text-base font-semibold`
- `h3`: `text-sm font-medium`
- 表格: 全宽、圆角表头（`bg-muted/60`）、hover 高亮行（`hover:bg-muted/30`）
- `*`: 统一 `border-border` 边框颜色

## API 客户端约定

### 模块化封装

每个后端模块对应一个 `lib/*.ts` 文件，包含：
1. **TypeScript 类型定义** -- 导出与后端 Schema 对应的 interface/type
2. **API 函数** -- 导出异步函数，内部调用 `apiFetch`

```typescript
// src/lib/example.ts
import { apiFetch } from "./api";

export interface Example { id: string; name: string; }

export function listExamples(): Promise<Example[]> {
  return apiFetch<Example[]>("/api/examples");
}
```

### 错误处理

- 统一使用 `ApiError` 类处理 API 错误
- 页面中 catch 块统一模式：`err instanceof ApiError ? err.message : "默认错误消息"`
- 网络错误包装为 `ApiError(status=0, code='network_error')`
- ApiError 包含 `status`, `code`, `message`, `requestId`, `details` 字段

### URL 构建

- 路径参数使用模板字符串插值：`` `/api/workspaces/${workspaceId}/changes` ``
- 列表查询使用 `URLSearchParams` 构建 query string
- `apiFetch` 支持 `query` 选项自动附加查询参数

### 模块注释

部分 API 模块在文件头部包含 JSDoc 注释说明对应的后端模块路径：
```typescript
/**
 * Workspace API client. Mirrors backend/app/modules/workspace/schema.py.
 */
```

## TypeScript 配置

项目使用 TypeScript 5.5.4 严格模式：
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `forceConsistentCasingInFileNames: true`
- 路径别名: `@/*` 映射到 `./src/*`

## 导入顺序

实际代码中的导入顺序（由 ESLint 格式化隐含）：
1. React / Next.js 相关（`"use client"`, `type` imports, `useState`, `useEffect`, `useRouter`）
2. 第三方库
3. UI 组件（`@/components/...`）
4. API 客户端和类型（`@/lib/...`）
5. Store（`@/stores/...`）

## 测试约定

- 测试框架：Vitest（`globals: true`，无需显式 import `describe`/`it`/`expect`）
- Mock 方式：`vi.stubGlobal("fetch", vi.fn().mockResolvedValue(...))`
- 测试隔离：`afterEach(() => fetchMock.mockReset())` 或 `beforeEach(() => vi.restoreAllMocks())`
- 测试文件放在 `lib/__tests__/` 目录，与被测模块同级
