---
author: qinyi
created_at: 2026-06-03T20:35:00+08:00
---

# Frontend - 已知问题与技术债

## 高优先级

### 测试覆盖极低

仅 3 个测试文件（6 个用例），覆盖 `api.ts`（部分）、`agent.ts`（1 个函数）、`spec-workspaces.ts`（1 个函数）。其余 21 个 lib 文件、20 个页面、6 个业务组件完全没有测试。

最关键的未覆盖区域：
- `api.ts` 中的 Token 自动刷新/重试逻辑 -- 核心认证路径
- `agent-stream.ts` 的 SSE 重连/backoff/去重逻辑 -- 实时通信核心
- `auth.ts` 的登录/登出流程 -- 用户入口

### `as any` 类型逃逸

`api.ts` 中 Token 刷新逻辑使用了 `as any` 强制类型转换（`const pair = refreshPayload as any`），说明 API 响应类型定义不完整，削弱了 TypeScript 的类型安全保证。

### 页面内联逻辑过多

多个页面文件超过 300 行（如 `changes/[cid]/page.tsx` 约 1030 行、`agent/page.tsx` 约 790 行、`workspaces/[id]/page.tsx` 约 570 行），包含大量内联状态管理和业务逻辑，缺少拆分：
- 状态声明、数据加载、事件处理、渲染逻辑全部耦合在一个函数中
- 缺少自定义 Hook 抽象（如 `useWorkspaceData`、`useAgentStream`）

## 中优先级

### React Query 未充分使用

`@tanstack/react-query` v5.51.0 已安装，但当前所有页面使用 `useState + useEffect` 直接调用 `apiFetch`。这意味着：
- 没有请求缓存，同一数据在多个页面可能重复请求
- 没有自动后台刷新，数据可能过期
- 没有 loading/error 状态的标准化管理
- 缺少乐观更新和失效策略

### 组件数量偏少

仅 6 个业务组件 + 3 个 UI 基础组件。大量 UI 逻辑直接写在页面中（如变更详情页的文档 Tab、审批面板、归档门禁等），缺少可复用的业务组件抽象。

### 组件兼容层存在

`lib/components.ts` 是一个将 Workspace 映射为 Component 的兼容层，用于适配后端重构前的 API。该模块通过客户端过滤（`root_path.startsWith(prefix)`）模拟组件列表，效率低且逻辑脆弱。在后端 API 稳定后应考虑移除。

### components.ts 客户端过滤

`listComponents()` 函数获取所有 Workspace 后在客户端通过 `root_path` 前缀匹配来过滤子组件，当 Workspace 数量增长时会产生性能问题。

## 低优先级

### 硬编码默认值

- `next.config.mjs` 中 API 代理默认指向 `http://localhost:8000`
- 登录页默认填充 `admin@sillyhub.local` / `admin12345`
- Agent 页面的 "Allowed Paths" 显示硬编码为 `src/**, tests/**`
- Agent 页面的 "Cost" 显示硬编码为 `$0.00`

### 缺少全局错误边界

没有 React Error Boundary 包裹，如果页面组件抛出运行时错误会导致白屏。

### 无 TODO/FIXME 标记

源码中没有 TODO 或 FIXME 标记，代码库较干净，但也意味着缺少对未来改进点的标注。

### Tailwind 主题系统较基础

CSS 变量主题定义了基础色板，但缺少 success/warning 的完整主题色定义（仅在 `:root` 中定义了 success，dark mode 未定义 success/warning）。

## 依赖风险

### Next.js 14 版本锁定

使用 Next.js 14.2.5，App Router 在 15.x 有较大 API 变更。升级需要评估：
- `params` 在 15.x 中变为 Promise
- `Route Handler` API 可能有变更
- `next.config` 格式可能变化

### pnpm 版本锁定

`packageManager: pnpm@9.6.0` 通过 Corepack 管理版本，升级需确保 CI/CD 环境同步更新。

### @xyflow/react API 稳定性

拓扑图组件使用 @xyflow/react 12.x，该库 API 在主版本间可能有较大变化。
