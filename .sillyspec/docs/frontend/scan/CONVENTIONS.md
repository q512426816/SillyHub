---
source_commit: ba87eec
updated_at: 2026-06-23T16:25:04Z
created_at: 2026-06-24T00:25:04
author: qinyi
generator: sillyspec-scan
---

# frontend 代码约定

> 基于 `frontend/src/` grep 摘录（source_commit ba87eec），覆盖旧版文档。
> 纠错：旧版提及 React Query (`@tanstack/react-query`) 实际在源码中**零命中**，本仓数据层为自封装 `apiFetch` + Zustand，下文已更正。

## 框架隐形规则

### Next.js App Router

- **目录约定**：页面固定 `page.tsx`，嵌套用 `layout.tsx`；路由组 `(auth)` / `(dashboard)` 仅组织不出现在 URL；动态段 `[id]` / `[cid]` / `[tid]`。
- **Server / Client 边界**：默认 RSC；任何含 hooks / 浏览器 API / 事件处理 / antd 交互的组件顶部显式 `"use client"`（实测命中 20+ 文件，如 `agent-run-panel.tsx:1`、`workspace-tabs.tsx:1`、`app/(dashboard)/layout.tsx:1`、`antd-providers.tsx:1`）。
- **页面导出**：页面一律 `export default function XxxPage({ params }: Props)`（如 `workspaces/[id]/page.tsx:107`）；根 `app/layout.tsx:8` 用 `export const metadata: Metadata`（RSC 侧）。
- **错误边界**：路由级 `error.tsx` 具名导出（`workspaces/[id]/error.tsx:19`）。
- **路径别名**：`@/*` → `./src/*`（`tsconfig.json` paths）；`experimental.typedRoutes: true` 路由类型受控。
- **StrictMode**：`reactStrictMode: true`（`next.config.mjs:4`）—— effect / SSE 订阅必须容忍双调用。

### 数据访问（无 React Query）

- **统一出口**：所有后端调用走 `lib/api.ts` 的 `apiFetch()`（`api.ts:94`），禁止直接 `fetch("/api/...")` 绕过。
- **工具函数**：`getApiBaseUrl()`（`api.ts:29`）、`safeUUID()`（`api.ts:77`）。
- **路径前缀**：前端只调 `/api/*`，由 `next.config.mjs` `rewrites()` 转发到 backend；不直接拼 backend host。
- **Token 刷新**：`apiFetch` 内部捕获 401 → 自动 `POST /api/auth/refresh` → 重放原请求（`api.ts:187` 递归 `apiFetch<T>`）。
- **领域 client**：`lib/<domain>.ts` 暴露动词式 API（`listXxx` / `getXxx` / `createXxx` / `updateXxx`），见 `lib/changes.ts`、`lib/tasks.ts`、`lib/ppm/*`。
- **服务端取数**：客户端组件内 `useEffect` + `apiFetch` 手动拉取并 `setState`；**无 `useQuery`/`useMutation`**，缓存失效/loading 由组件自管。

### 状态（Zustand）

- store 一律放 `src/stores/`，签名 `export const useXxxStore = create<...>()(...)`：
  - `stores/session.ts`：`create` + `persist` 中间件持久化 token，暴露 `setUser/setTokens/clear/markHydrated`。
  - `stores/kanban.ts`：无 persist，含 `fetchUsers/fetchTasks/assignTask/reorderTasks/setFilters/reset` 等 action，action 内直接调 `lib/ppm/kanban.ts` 并 `message` 反馈。
- 组件用 `useSession` / `useKanbanStore` selector hook 消费。
- **流式数据不进全局 store**：agent run 日志由 `lib/use-agent-run-stream.ts` 的 `useAgentRunStream`（`use-agent-run-stream.ts:73`）在 hook 内用十余个 `useState` 维护（`logs/status/streaming/loading/error/perms/...`），避免高频 SSE 更新触发整树渲染。

### 类型（TypeScript strict）

- `tsconfig.json`: `strict: true` + `noUncheckedIndexedAccess`（旧文档亦载）；数组/对象索引访问需 narrowing 或兜底（`arr[0]!` / `?? fallback`）。
- 领域类型集中在 `lib/*.ts`，`export type` 与 `export interface` 并用：
  - `lib/changes.ts`：大量 `export type ChangeXxx = { ... }`（对象类型偏好 `type`，如 `ChangeSummary`、`ChangeList`）。
  - `lib/workspace-members.ts`、`lib/audit.ts`、`lib/menu-permissions.ts`：偏好 `export interface XxxView`（数据视图/请求体）。
  - 联合字面量用 `type`（`approvals.ts:7` `RiskLevel = "low" | "medium" | "high" | "extreme"`；`agent-stream.ts:10` `StreamStatus`）。
- PPM 领域类型集中在 `lib/ppm/types.ts`。

### SSE hook 隐形规则

- `useAgentRunStream` 内部用 `cancelled` flag（`use-agent-run-stream.ts:179`）保护 unmount / 依赖变化后的旧 effect 闭包（多处 `if (cancelled) return;` 如 `:187/:195`）。**任何修改必须保留该 guard**，否则 StrictMode 双调用或快速重连会产生孤儿订阅或写入已卸载组件。

## 代码风格

### 命名

- **组件文件**：业务组件统一 **kebab-case**（`workspace-tabs.tsx`、`agent-run-panel.tsx`、`ppm-user-select.tsx`、`admin-organization-tree.tsx`）；少量原子组件 PascalCase（`AgentModelInput.tsx`、`AgentProviderSelect.tsx`）。
- **命名空间子目录**：小写（`agent-log/`、`daemon/`、`permissions/`、`charts/`、`layout/`、`ui/`）。
- **导出**：组件 `export function X({ ... }: Props)` 或 `export default function XPage()`；hook `export function useXxx(...)`（`useAgentRunStream`、`useToast`）。
- **store**：`useXxxStore`（`useSession` 例外，历史命名）；action 动词式（`setXxx` / `fetchXxx` / `resetXxx`）。

### 样式（双 UI 库并存）

- **业务组件优先 Ant Design**：`import { Table, Tag, Select, ... } from "antd"`（命中 14+ 文件），`TableProps`/`TableColumnsType` 用 `type` 导入；`@ant-design/icons` 图标；`message` 静态方法反馈。
  - antd 上下文由 `components/antd-providers.tsx`（`App as AntApp` + `ConfigProvider`）统一注入，组件内用 `App.useApp()` 取实例。
- **原子/自定义控件** 用 shadcn 风格 `@/components/ui/*`，类名经 `cn()`（`lib/utils.ts:4` = `clsx` + `tailwind-merge`）合并。
- Tailwind utility 为主，shadcn 主题用 CSS variables（`globals.css` 定义，`tailwind.config.ts` 映射 `hsl(var(--xxx))`）。

### 测试

- vitest + jsdom + @testing-library/react + jest-dom（`globals: true`，无需 import `describe/it/expect`）。
- setup 在 `src/test/setup.ts`；测试与被测同模块 `__tests__/` 下或 `<name>.test.tsx` 并置（`agent-run-panel.test.tsx`、`lib/daemon.test.ts`、`lib/__tests__/`）。

### 导出风格

- 类型与实现同文件导出（`export type Foo = {...}` 紧邻 action / hook）。
- Route Handler（`app/api/**/stream/route.ts`）用具名导出 `GET` / `POST`，返回 `new Response(stream, { headers: { "Content-Type": "text/event-stream" } })`，不写默认导出。

## 典型模式

**模式 1 — 客户端页面 + 手动取数**（无 React Query）

```tsx
"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { ChangeSummary } from "@/lib/changes";

export default function ChangesPage({ params }: Props) {
  const [list, setList] = useState<ChangeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;                 // StrictMode 双调用保护
    apiFetch<ChangeList>(`/api/.../changes`).then(r => {
      if (!cancelled) setList(r.items);
    }).finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [params.id]);
  ...
}
```

**模式 2 — Zustand store + 领域 client**

```ts
export const useKanbanStore = create<KanbanState>()((set, get) => ({
  users: [], tasks: [], filters: {}, loading: false,
  fetchTasks: async () => {
    set({ loading: true });
    const tasks = await listKanbanTasks(get().filters);   // lib/ppm/kanban.ts
    set({ tasks, loading: false });
    return tasks;
  },
  assignTask: async (taskId, userId) => {
    await assignKanbanTask(taskId, userId);
    message.success("已分配");
    await get().fetchTasks();                              // 成功后刷新
  },
}));
```

**模式 3 — 类型集中导出（lib/changes.ts）**

```ts
export type ChangeSummary = { id: string; title: string; status: ChangeStatus; ... };
export type ChangeList = { items: ChangeSummary[]; total: number };
export type RiskLevel = "low" | "medium" | "high" | "extreme";   // 联合字面量
export interface UserSearchHit { id: string; email: string; ... } // 视图/请求体用 interface
```

**模式 4 — antd Table 受控列**

```tsx
import { Table, type TableProps } from "antd";
const columns: TableColumnsType<ChangeSummary> = [
  { title: "标题", dataIndex: "title", key: "title" },
  { title: "状态", dataIndex: "status", render: (_, r) => <Tag>{r.status}</Tag> },
];
<Table rowKey="id" columns={columns} dataSource={list} loading={loading} />;
```
