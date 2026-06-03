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
| 路由处理器 | `route.ts`（Next.js 约定） | `app/api/.../route.ts` |
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

## 组件设计约定

### 页面组件

所有业务页面遵循统一模式：

```tsx
"use client";

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
  const [pageError, setPageError] = useState<string | null>(null);

  // 2. 数据加载
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchXxx();
        setItems(data);
      } catch (err) {
        setPageError(err instanceof ApiError ? err.message : "加载失败");
      } finally {
        setLoading(false);
      }
    };
    void load();
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

### 业务组件

- 使用 `"use client"` 标记
- Props 使用 `interface Props` 内联定义
- 状态管理用 `useState`，不引入额外状态库

### UI 原子组件

`components/ui/` 下的基础组件遵循 shadcn/ui 风格：
- 使用 `class-variance-authority` (CVA) 管理 variant
- 使用 `cn()` 工具函数合并 className
- `Button` 使用 `React.forwardRef`
- `Badge` 使用命名导出函数

## 样式约定

### Tailwind CSS 使用

- **布局**: `flex`, `grid`, `gap-*` 为主要布局手段
- **间距**: 统一使用 `px-6 py-6`（页面级）或 `px-3 py-2`（卡片级）
- **最大宽度**: `max-w-5xl`（列表页）或 `max-w-6xl`（详情页）
- **圆角**: `rounded-md`（主要容器）、`rounded`（小元素）
- **边框**: `border` + `bg-card` 构成卡片样式

### 主题系统

通过 CSS 变量定义 HSL 颜色值，在 `globals.css` 中配置：

```css
:root {
  --background: 210 20% 98%;
  --foreground: 215 25% 15%;
  --primary: 215 55% 28%;
  --destructive: 0 72% 51%;
  --radius: 0.375rem;
}
```

支持 dark mode（`.dark` 类切换），Tailwind 配置 `darkMode: ["class"]`。

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
- 表格: 全宽、圆角表头、hover 高亮行

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

### URL 构建

- 列表查询使用 `URLSearchParams` 构建 query string
- 路径参数使用模板字符串插值

## TypeScript 配置

```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "forceConsistentCasingInFileNames": true,
  "paths": { "@/*": ["./src/*"] }
}
```

严格模式开启，禁止隐式 any，启用索引访问检查。

## 导入顺序

实际代码中的导入顺序：
1. React / Next.js 相关
2. UI 组件
3. API 客户端和类型
4. Store
