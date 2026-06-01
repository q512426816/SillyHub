---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# 已知问题与技术债务

## 架构层面

### 1. React Query 未充分利用

**现状**：已安装 `@tanstack/react-query` v5.51.0，但所有页面使用 `useState` + `useEffect` 手动管理数据获取和缓存。

**影响**：
- 每次组件挂载都重新 fetch，无缓存复用
- 需要手动处理 loading/error 状态
- 无自动后台刷新、乐观更新等高级特性
- 并发请求模式不统一（有的用 Promise.all，有的串行）

**建议**：逐步迁移至 React Query 的 `useQuery` / `useMutation` 模式。

### 2. 无全局错误边界

**现状**：页面错误直接通过 `try/catch` 在组件内部处理并显示错误信息，无 React Error Boundary。

**影响**：
- 未捕获的渲染错误会导致白屏
- 无法统一上报前端异常
- 错误恢复需用户手动刷新

**建议**：在 `DashboardLayout` 和各路由组添加 Error Boundary。

### 3. 无加载骨架屏

**现状**：加载态仅显示文字 "加载中..." 或无反馈。

**影响**：用户体验较差，页面切换时出现布局跳动。

**建议**：引入 Suspense + 骨架屏组件。

## 代码质量

### 4. 组件内逻辑过重

**现状**：部分页面组件（如 `WorkspaceDetailPage`）包含大量 useState 和业务逻辑，超过 300 行。

**影响**：
- 可读性差，难以维护
- 无法复用业务逻辑
- 难以单独测试逻辑

**建议**：提取自定义 Hooks（如 `useWorkspace`、`useSpecWorkspace`）。

### 5. API 模块与兼容层并存

**现状**：`components.ts` 是一个兼容适配层，将旧的 Component API 映射到新的 Workspace API。`changes.ts` 和 `workflow.ts` 存在重复的 `transitionChange` 函数。

**影响**：
- 概念混淆（Workspace vs Component）
- 潜在的类型不匹配
- 维护时容易改错文件

**建议**：完成迁移后移除兼容层，合并重复函数。

### 6. 缺少类型守卫

**现状**：API 响应依赖 `apiFetch<T>` 的泛型断言，无运行时验证。

**影响**：
- 后端 schema 变更时前端可能静默获取错误数据
- 仅在访问 undefined 属性时才暴露问题

**建议**：利用已安装的 Zod 库为关键 API 响应添加 schema 验证。

## 安全性

### 7. Token 存储在 localStorage

**现状**：access_token 和 refresh_token 存储在 localStorage 中。

**风险**：
- XSS 攻击可直接读取 token
- 无 HttpOnly cookie 的额外保护

**建议**：评估 HttpOnly cookie 方案；短期至少对 localStorage key 做混淆。

### 8. SSE Token 通过 URL 传递

**现状**：Agent 日志流的 EventSource 通过 URL query 参数传递 token。

**风险**：
- Token 暴露在 URL 中，可能被服务器日志记录
- 浏览器历史记录中可见

**建议**：使用 withCredentials + cookie 或 POST 获取临时 SSE token。

## 可维护性

### 9. 缺少 Storybook 或组件文档

**现状**：UI 组件无独立文档，样式和 variant 需要阅读源码了解。

**建议**：引入 Storybook 为基础 UI 组件建立文档。

### 10. 缺少 E2E 测试

**现状**：仅有一个 API 层单元测试文件，无端到端测试。

**影响**：
- 核心流程（登录→创建变更→审批→发布）无自动化验证
- 重构时容易引入回归

**建议**：优先覆盖 3-5 个核心用户流程的 E2E 测试。

### 11. 未使用的依赖

**现状**：Zod 和 React Query 已安装但未使用。

**影响**：增加 bundle 体积（虽然 tree-shaking 可缓解），增加认知负担。

**建议**：要么使用它们，要么移除。

## 性能

### 12. 缺少数据缓存策略

**现状**：导航回已访问页面时完全重新 fetch 数据。

**建议**：使用 React Query 的 staleTime/cacheTime 或简单的客户端缓存。

### 13. 列表页无分页优化

**现状**：API 层支持分页参数，但部分列表页未传递分页参数。

**建议**：对可能大量数据的列表（变更、事件、审计日志）实现分页或无限滚动。

### 14. 前端 bundle 分析缺失

**现状**：未配置 bundle 分析工具。

**建议**：添加 `@next/bundle-analyzer` 定期检查包体积。

## 改进路线图

### P0 (紧急)

- [ ] 添加全局 Error Boundary
- [ ] 提取页面级自定义 Hooks
- [ ] 清理 API 兼容层和重复函数

### P1 (重要)

- [ ] 引入 React Query 管理服务端状态
- [ ] 补充 API 层测试 (至少覆盖 auth + changes + agent)
- [ ] 添加加载骨架屏

### P2 (改善)

- [ ] 移除或正式启用 Zod 验证
- [ ] 引入 Storybook
- [ ] SSE Token 传递方式优化
- [ ] 列表页分页优化

### P3 (探索)

- [ ] E2E 测试 (Playwright)
- [ ] Bundle 分析与优化
- [ ] Token 存储安全增强
