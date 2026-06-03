---
author: qinyi
created_at: 2026-06-03T20:35:00+08:00
---

# Frontend - 已知问题与技术债

## 高优先级

### 测试覆盖极低

仅 3 个测试文件（6 个用例），覆盖 `api.ts`（部分）、`agent.ts`（1 个函数）、`spec-workspaces.ts`（1 个函数）。其余 22 个 lib 文件、20 个页面、6 个业务组件完全没有测试。

最关键的未覆盖区域：
- `api.ts` 中的 Token 自动刷新/重试逻辑 -- 核心认证路径，包含 401 检测、refresh 调用、retry 标志、失败清除 session
- `agent-stream.ts` 的 SSE 重连/backoff/去重逻辑 -- 实时通信核心，包含指数退避、seenLogIds 去重、断线回填
- `auth.ts` 的登录/登出流程 -- 用户入口，login 调用两次 API（login + me）

### `as any` 类型逃逸

`api.ts` 中 Token 刷新逻辑使用了 `as any` 强制类型转换（第 169 行 `const pair = refreshPayload as any`），说明 API 响应类型定义不完整，削弱了 TypeScript 的类型安全保证。

### 页面内联逻辑过多

多个页面文件超过 300 行，包含大量内联状态管理和业务逻辑，缺少拆分：
- 变更详情页（`changes/[cid]/page.tsx`）：阶段流转、文档矩阵、Agent dispatch、归档门禁等逻辑全部耦合
- Agent 控制台（`agent/page.tsx`）：SSE 连接管理、日志渲染、用户输入交互全部内联
- Workspace 详情页（`workspaces/[id]/page.tsx`）：概览信息、操作面板逻辑混合

缺少自定义 Hook 抽象（如 `useWorkspaceData`、`useAgentStream`、`useChangeDetail`）。

## 中优先级

### React Query 未充分使用

`@tanstack/react-query` v5.51.0 已安装，但当前所有页面使用 `useState + useEffect` 直接调用 `apiFetch`。这意味着：
- 没有请求缓存，同一数据在多个页面可能重复请求
- 没有自动后台刷新，数据可能过期
- 没有 loading/error 状态的标准化管理
- 缺少乐观更新和失效策略
- 每个页面都重复编写相同的 loading/error/data 三态管理代码

### 组件数量偏少

仅 6 个业务组件 + 3 个 UI 基础组件。大量 UI 逻辑直接写在页面中：
- 变更详情页的文档 Tab、审批面板、归档门禁等没有提取为独立组件
- Agent 控制台的日志面板、用户输入面板没有提取
- 各页面的空态/加载态/错误态没有统一的占位组件

### 组件兼容层（components.ts）存在

`lib/components.ts` 是一个将 Workspace 映射为 Component 的兼容层，用于适配后端重构前的 API。该模块通过客户端过滤（获取所有 Workspace 后 `root_path.startsWith(prefix)` 匹配）模拟组件列表：
- 当 Workspace 数量增长时会产生性能问题（全量获取后客户端过滤）
- 过滤逻辑依赖 root_path 路径前缀匹配，在不同操作系统路径格式下可能出错
- 在后端 API 稳定后应考虑移除，直接使用 Workspace API

### SSE 双路径复杂度

Agent 日志流存在两种连接方式（函数式 `streamAgentRunLogs` 和面向对象 `AgentRunStreamClient`）和两种代理路径（Route Handler 代理和直连后端），增加了理解和维护的复杂度。

## 低优先级

### 硬编码默认值

- `next.config.mjs` 中 API 代理默认指向 `http://localhost:8000`
- `api.ts` 中服务端 URL 默认也是 `http://localhost:8000`
- 登录页默认填充 `admin@sillyhub.local` / `admin12345`
- 侧边栏导航使用 emoji 作为图标（未使用已安装的 lucide-react）

### 缺少全局错误边界

没有 React Error Boundary 包裹，如果页面组件抛出运行时错误会导致白屏。

### 无 TODO/FIXME 标记

源码中没有 TODO 或 FIXME 标记，代码库较干净，但也意味着缺少对未来改进点的标注。

### Tailwind 主题系统不完整

CSS 变量主题定义了基础色板（background/foreground/primary/muted/destructive），但：
- `:root` 中定义了 `--success` 和 `--warning`，但 `tailwind.config.ts` 中没有对应的 extend
- dark mode 的 `.dark` 选择器中未定义 `--success` 和 `--warning` 变量
- Badge 的 success/warning variant 使用硬编码的 Tailwind 颜色（`bg-emerald-50`/`bg-amber-50`）而非 CSS 变量

### typedRoutes 未实际使用

`next.config.mjs` 中启用了 `experimental.typedRoutes: true`，但代码中仍使用字符串路径（如 `href="/workspaces"`），未利用自动生成的路由类型。

## 依赖风险

### Next.js 14 版本锁定

使用 Next.js 14.2.5，App Router 在 15.x 有较大 API 变更。升级需要评估：
- `params` 在 15.x 中变为 Promise（当前所有页面直接解构 `params`）
- `Route Handler` API 可能有变更
- `next.config` 格式可能变化（从 `.mjs` 到 `.ts`）

### @xyflow/react API 稳定性

拓扑图组件使用 @xyflow/react 12.x，该库 API 在主版本间可能有较大变化。当前仅在 `components/topology/page.tsx` 中使用，影响范围有限。

### Zustand API 演进

使用 Zustand 4.5.x，Zustand 5.x 有 API 变更（如 `create` 函数签名）。当前仅一个 store，迁移成本低但需要注意。
