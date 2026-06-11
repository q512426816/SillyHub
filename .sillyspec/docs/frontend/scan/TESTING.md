---
author: qinyi
created_at: 2026-06-10T00:00:00
---

# Frontend 测试策略

## 测试框架

| 工具 | 版本 | 用途 |
|------|------|------|
| Vitest | 2.0+ | 单元测试运行器 |
| @vitejs/plugin-react | 4.3+ | Vitest 中支持 JSX/TSX |
| jsdom | 24.1+ | 浏览器环境模拟 |
| @testing-library/jest-dom | 6.4+ | DOM 断言扩展 |
| @testing-library/react | 16.0+ | React 组件测试工具 |
| @playwright/test | 1.60+ | E2E 测试 (已安装，尚无测试文件) |
| Puppeteer | 24.43+ | 浏览器自动化 (已安装，尚无测试文件) |

## 测试配置

- **运行器**: Vitest，配置在 `vitest.config.ts`
- **环境**: jsdom (模拟浏览器 DOM)
- **全局 API**: `globals: true` (describe/it/expect 无需导入)
- **Setup**: `src/test/setup.ts` — 导入 `@testing-library/jest-dom/vitest`
- **路径别名**: `@` 映射到 `./src` (与 tsconfig 一致)
- **CSS**: `css: false` (测试中不处理 CSS)
- **脚本**: `pnpm test` (单次运行) / `pnpm test:watch` (监听模式)

## 现有测试

项目中有 3 个单元测试文件，全部位于 `src/lib/__tests__/`：

### 1. api.test.ts — API 客户端测试

测试 `apiFetch` 核心封装：
- 2xx 响应返回解析后的 JSON
- 4xx 响应抛出结构化 `ApiError`（含 code, status, message, requestId）
- 网络异常包装为 `ApiError(status=0, code='network_error')`
- 每次请求自动附加 `x-request-id` 头

### 2. agent.test.ts — Agent API 测试

测试 `submitAgentRunInput` 函数：
- 验证请求 URL 包含正确的 workspace 和 run ID
- 验证 HTTP method 为 POST
- 验证 Content-Type 为 application/json
- 验证请求体和响应结构

### 3. spec-workspaces.test.ts — SillySpec 工作空间测试

测试 `bootstrapSpecWorkspace` 函数：
- 验证 POST 请求到正确的端点
- 验证响应结构包含 agent_run_id, stream_url, status, spec_root

## 测试模式

所有测试使用相同的模式：
- `vi.stubGlobal("fetch", vi.fn().mockResolvedValue(...))` mock 全局 fetch
- `beforeEach(() => vi.restoreAllMocks())` 确保测试隔离
- 手动构造 `Response` 对象模拟后端响应
- 直接测试 API 函数的输入输出，不涉及 React 组件渲染

## 测试覆盖盲区

当前测试仅覆盖 API 客户端层的数据转换和请求构造，以下领域缺少测试：
- **页面组件**: 无任何 React 组件测试
- **Zustand Store**: session store 逻辑未测试
- **SSE 客户端**: `AgentRunStreamClient` 重连/去重逻辑未测试
- **认证流程**: token refresh/redirect 逻辑未测试
- **E2E**: Playwright 和 Puppeteer 已安装但无测试文件
- **类型安全**: 未使用 Zod 进行运行时校验测试
