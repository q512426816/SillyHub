---
author: scan-agent
created_at: "2026-06-03"
---

# SillyHub Frontend — 编码规范

## TypeScript 规范

- **编译目标**: ES2022
- **严格模式**: `strict: true` + `noUncheckedIndexedAccess: true`
- **模块**: ESNext（bundler resolution）
- **路径别名**: `@/*` → `./src/*`
- **不允许 JS**: `allowJs: false`
- **类型全局引入**: `vitest/globals` + `@testing-library/jest-dom`

## 组件结构

### 文件命名
- 页面: `page.tsx`（Next.js 约定）
- 布局: `layout.tsx`（Next.js 约定）
- 业务组件: `kebab-case.tsx`（如 `workspace-card.tsx`、`app-shell.tsx`）
- UI 基础组件: `kebab-case.tsx`（放在 `components/ui/` 下）
- API 客户端: `kebab-case.tsx`（放在 `lib/` 下，虽然用 .ts 后缀但命名一致）
- Store: `kebab-case.ts`（如 `session.ts`）

### 客户端组件标记
- 需要 hooks/状态/浏览器 API 的组件标记 `"use client"`
- 仅服务端逻辑的文件不需要（如根 `layout.tsx`、`route.ts`）

### 组件写法
- **UI 基础组件**: 使用 CVA（class-variance-authority）定义变体，`forwardRef` 包裹
  ```tsx
  const buttonVariants = cva("base-classes", {
    variants: { variant: {...}, size: {...} },
    defaultVariants: {...}
  });
  export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, ...props }, ref) => (
      <button ref={ref} className={cn(buttonVariants({variant, size}), className)} {...props} />
    )
  );
  ```
- **业务组件**: 普通函数组件，接受 Props interface
  ```tsx
  interface Props { workspace: Workspace; onChanged: () => void; }
  export function WorkspaceCard({ workspace, onChanged }: Props) { ... }
  ```

## 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 组件 | PascalCase | `WorkspaceCard`、`HealthCard` |
| Hook | camelCase (use 前缀) | `useSession`、`useWorkspaceId` |
| API 函数 | camelCase (动词前缀) | `listWorkspaces`、`getChange`、`createAgentRun` |
| TypeScript 类型 | PascalCase | `Workspace`、`ChangeSummary`、`AgentRunStatus` |
| CSS 类 | Tailwind 内联 | `className="flex items-center gap-2"` |
| 常量 | UPPER_SNAKE_CASE | `OVERVIEW_NAV`、`COLLAPSED_KEY` |

## API 调用规范（apiFetch）

所有后端 API 调用统一使用 `apiFetch<T>()`：

```ts
// GET 请求
export function listWorkspaces(): Promise<WorkspaceListResponse> {
  return apiFetch<WorkspaceListResponse>("/api/workspaces");
}

// POST 请求
export function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
  return apiFetch<Workspace>("/api/workspaces", {
    method: "POST",
    json: input,
  });
}

// 带查询参数
export function listIncidents(workspaceId: string, status?: string) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiFetch<Incident[]>(`/api/workspaces/${workspaceId}/incidents${qs}`);
}
```

关键约定：
- 每个模块文件定义对应的 TypeScript 类型（对齐后端 schema）
- 导出类型用 `export type` 或 `export interface`
- 错误处理统一用 `ApiError` 类

## Zustand Store 规范

```ts
// 使用 persist 中间件
export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      hydrated: false,
      user: null,
      accessToken: null,
      refreshToken: null,
      setUser: (next) => set({ user: next }),
      setTokens: ({ accessToken, refreshToken }) => set({ accessToken, refreshToken }),
      clear: () => set({ user: null, accessToken: null, refreshToken: null }),
      markHydrated: () => set({ hydrated: true }),
    }),
    {
      name: "multi-agent-platform.session",
      version: 1,
      partialize: (state) => ({ ... }),  // 持久化字段白名单
      onRehydrateStorage: () => (state) => { ... },
    },
  ),
);
```

## Tailwind CSS 用法

- **全局颜色变量**: 使用 CSS 变量 + HSL（如 `hsl(var(--primary))`）
- **深色模式**: `class` 策略
- **工具函数**: `cn()` = `clsx()` + `tailwind-merge()`
- **组件样式**: CVA 定义变体，`cn()` 合并自定义类
- **不使用**: styled-components、CSS Modules、内联 style 对象

## 页面数据获取模式

当前采用手动 `useState` + `useEffect` 模式（未使用 TanStack Query）：

```tsx
export default function SomePage({ params }: Props) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const result = await someApiCall(params.id);
      setData(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    }
  };

  useEffect(() => { void load(); }, []);
  // ...
}
```

## 测试规范

- 框架: Vitest
- 测试文件位置: 与源码同目录的 `__tests__/` 子目录
- 命名: `*.test.ts`
- Mock: `vi.fn()` + `vi.stubGlobal("fetch", ...)`
- 断言: `expect` + `@testing-library/jest-dom` 匹配器
