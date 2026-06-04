---
author: scan-agent
created_at: "2026-06-03"
---

# SillyHub Frontend — 技术关注点

## 性能

### Bundle 大小
- **依赖较多但合理**: Next.js、React、Zustand、TanStack Query、Zod、XYFlow 等均为按需加载
- **未使用 tree-shaking 的隐患**: `@tanstack/react-query` 和 `zod` 已安装但大部分页面未实际使用，会增加 bundle 体积
- **Markdown 渲染器**: `@uiw/react-markdown-preview` 较重，仅在部分页面使用，需确认动态导入
- **XYFlow**: `@xyflow/react` 仅用于拓扑图页面，应使用 `next/dynamic` 懒加载

### SSR vs CSR
- **根 layout.tsx**: 服务端组件（设置 metadata、导入全局 CSS）
- **Dashboard Layout**: `"use client"` — 客户端组件（认证检查需要浏览器环境）
- **几乎所有页面**: `"use client"` — 纯 CSR，无 SSR 数据预取
- **首页 page.tsx**: 服务端组件（仅渲染静态链接 + HealthCard）
- **影响**: 首次加载需等 JS 执行后才能获取数据，对 SEO 和首屏速度有一定影响

### 数据获取效率
- **无缓存策略**: 所有页面使用 `useState + useEffect` 手动获取数据，无缓存、无去重、无后台刷新
- **TanStack Query 未使用**: 已安装但未集成，缺少请求去重、缓存失效、乐观更新等能力
- **轮询模式**: HealthCard 使用 `setInterval(5000)` 轮询，可考虑改用 TanStack Query 的 refetchInterval

### 大页面性能
- `WorkspaceDetailPage` 单文件 **570+ 行**，包含大量 state 变量（~15 个 useState）和复杂逻辑，可能影响组件渲染性能

## 安全

### XSS（跨站脚本）
- **React 默认防护**: JSX 自动转义，`dangerouslySetInnerHTML` 未使用（除可能的 Markdown 预览）
- **Markdown 预览**: `@uiw/react-markdown-preview` 内置 sanitize，但需确认配置
- **API 响应**: `apiFetch` 返回原始 JSON，不做 sanitize，依赖 React 渲染时自动转义
- **SSE 消息**: Agent 日志通过 `event.content` 直接渲染，如果包含 HTML 可能存在风险

### CSRF（跨站请求伪造）
- **Token 认证**: 使用 Bearer Token（非 Cookie），天然免疫 CSRF
- **localStorage 持久化**: Token 存储在 localStorage，非 HttpOnly Cookie，存在 XSS 窃取风险
- **无 CSRF Token**: 未实现 CSRF Token（因为使用 Bearer Token 方案，不需要）

### 认证安全
- **Token 存储**: localStorage（非 HttpOnly Cookie），XSS 攻击可窃取 token
- **Token 刷新**: 自动刷新机制良好，但刷新失败时直接清空跳转，无 grace period
- **密码默认值**: 登录页有硬编码的默认 email/password（`admin@sillyhub.local` / `admin12345`），仅开发用，生产环境应移除

### 其他安全关注
- **NEXT_PUBLIC_API_BASE_URL**: 公开环境变量暴露后端地址
- **poweredByHeader**: 已禁用（`poweredByHeader: false`），好实践
- **x-request-id**: 良好的请求追踪机制

## 技术债务

### 高优先级

1. **TanStack Query 未使用**
   - 已安装 `@tanstack/react-query` 但所有页面仍手动管理数据获取
   - 建议: 逐步迁移到 `useQuery`/`useMutation`，获得缓存、去重、后台刷新等能力
   - 影响: 数据获取效率、用户体验

2. **测试覆盖率极低**
   - 22 个 API 模块中仅 3 个有测试
   - 无组件测试、无页面测试、无 E2E 测试
   - 建议: 优先覆盖认证流程、核心 API 客户端

3. **组件层兼容 shim**
   - `components.ts` 是旧 API 的兼容层，将 `Workspace` 映射为旧 `Component` 类型
   - 注释中明确标注为迁移过渡，应尽快完成迁移并删除

### 中优先级

4. **Zod 未使用**
   - 已安装但未在前端做任何表单校验或运行时校验
   - 建议: 在表单提交时使用 Zod 做客户端校验，减少无效请求

5. **大型页面文件**
   - `WorkspaceDetailPage` 570+ 行，逻辑复杂
   - 建议: 拆分为子组件（SpecWorkspacePanel、BootstrapPanel、OverviewCards）

6. **无 Vitest 配置文件**
   - 依赖默认配置，缺少 jsdom environment 显式声明、路径别名等
   - 建议: 添加 `vitest.config.ts`

### 低优先级

7. **类型重复**
   - `changes.ts` 和 `workflow.ts` 都定义了 `transitionChange` 函数
   - `TransitionResponse` 类型在两个文件中有不同定义
   - 建议: 统一到一处

8. **无错误边界**
   - 无 React Error Boundary 包裹路由
   - 组件渲染错误会导致白屏

9. **无 Loading UI 骆架**
   - 每个页面自己实现 loading 状态（显示 "加载中…"）
   - 未利用 Next.js App Router 的 `loading.tsx` 约定

10. **路径别名未在 Vitest 配置**
    - 测试中的 `@/lib/api` 等导入依赖 tsconfig paths
    - 当前能工作但不够明确

## 架构演进建议

1. **引入 TanStack Query** — 替换手动 useState/useEffect，统一数据获取层
2. **增加测试** — 目标: 核心 API 客户端 >80% 覆盖，关键页面有渲染测试
3. **拆分大页面** — WorkspaceDetailPage、ChangeDetailPage 等拆为子组件
4. **添加 Error Boundary** — 全局 + 路由级别
5. **清理技术债务** — 移除未使用的依赖或实际集成它们
