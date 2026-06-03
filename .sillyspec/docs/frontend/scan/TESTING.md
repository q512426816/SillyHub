---
author: qinyi
created_at: 2026-06-03T20:35:00+08:00
---

# Frontend - 测试策略

## 测试框架

### 技术栈

| 项目 | 版本 | 说明 |
|------|------|------|
| Vitest | ^2.0.0 | 测试框架（兼容 Vite 生态） |
| @testing-library/react | ^16.0.0 | React 组件测试工具（当前未实际使用） |
| @testing-library/jest-dom | ^6.4.6 | DOM 断言扩展（toBeInTheDocument 等） |
| @vitejs/plugin-react | ^4.3.1 | Vitest React JSX 支持 |
| jsdom | ^24.1.0 | 浏览器 DOM 模拟环境 |

### Vitest 配置

文件: `frontend/vitest.config.ts`

```typescript
{
  plugins: [react()],
  test: {
    environment: "jsdom",         // 模拟浏览器 DOM
    globals: true,                // describe/it/expect 全局可用，无需 import
    setupFiles: ["./src/test/setup.ts"],
    css: false,                   // 跳过 CSS 处理加速测试
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },  // 与 tsconfig 路径别名一致
  },
}
```

关键配置说明：
- `globals: true` 允许直接使用 `describe`/`it`/`expect`/`vi` 而无需在每个文件中 import
- `css: false` 跳过 CSS 处理以加速测试执行
- 路径别名 `@` 与 `tsconfig.json` 保持一致

### 测试 Setup

文件: `frontend/src/test/setup.ts`

```typescript
import "@testing-library/jest-dom/vitest";
```

仅引入 jest-dom 的 Vitest 适配，提供 DOM 相关断言匹配器（如 `toBeInTheDocument`、`toHaveTextContent` 等）。

## 测试命令

```bash
pnpm test          # 单次运行全部测试（vitest run）
pnpm test:watch    # 监听模式（vitest）
pnpm typecheck     # 类型检查（tsc --noEmit）
pnpm lint          # ESLint 检查（next lint）
```

## 测试文件分布

所有测试文件位于 `frontend/src/lib/__tests__/`，采用就近放置原则（与被测模块同属 `lib/` 目录）：

```
frontend/src/
  lib/
    __tests__/
      api.test.ts              # apiFetch 通用请求封装
      agent.test.ts            # submitAgentRunInput 函数
      spec-workspaces.test.ts  # bootstrapSpecWorkspace 函数
    api.ts                     # 被测模块
    agent.ts                   # 被测模块
    spec-workspaces.ts         # 被测模块
    ... (22 个其他 lib 模块，无测试)
  test/
    setup.ts                   # 全局 setup
```

## 测试详情

### `api.test.ts` -- apiFetch 核心封装（4 个用例）

| 用例 | 验证内容 |
|------|---------|
| 2xx 响应解析 | 正常 JSON 响应被正确解析并返回类型化对象 `{ ok: true, n: 42 }` |
| 4xx 错误处理 | 结构化错误 payload 被包装为 `ApiError`（检查 name, status, code, message, requestId） |
| 网络错误处理 | fetch reject 被包装为 `ApiError(status=0, code='network_error')` |
| x-request-id 请求头 | 每次请求自动附加 UUID 格式的 request-id（长度 >8） |

Mock 方式: `vi.stubGlobal("fetch", vi.fn().mockResolvedValue(...))`，配合 `afterEach(() => fetchMock.mockReset())`。

### `agent.test.ts` -- submitAgentRunInput（1 个用例）

| 用例 | 验证内容 |
|------|---------|
| POST input 请求 | URL 包含 `/agent/runs/{runId}/input`，method 为 POST，content-type 为 application/json，body 正确序列化为 `{ content: "..." }`，响应结构匹配 `{ run_id, accepted }` |

Mock 方式: `vi.stubGlobal("fetch", ...)` + `beforeEach(() => vi.restoreAllMocks())`。

### `spec-workspaces.test.ts` -- bootstrapSpecWorkspace（1 个用例）

| 用例 | 验证内容 |
|------|---------|
| POST bootstrap 请求 | URL 包含 `/spec-bootstrap`，method 为 POST，响应包含 agent_run_id / stream_url / status / spec_root / message |

Mock 方式: `vi.stubGlobal("fetch", ...)` + `beforeEach(() => vi.restoreAllMocks())`。

## 覆盖范围

### 已覆盖

| 模块 | 文件 | 用例数 | 覆盖范围 |
|------|------|--------|---------|
| `api.ts` | `__tests__/api.test.ts` | 4 | 核心封装（正常/错误/网络/请求头），未覆盖 Token 刷新/重试逻辑 |
| `agent.ts` | `__tests__/agent.test.ts` | 1 | 仅 `submitAgentRunInput`，未覆盖 SSE stream、list/create/logs/kill |
| `spec-workspaces.ts` | `__tests__/spec-workspaces.test.ts` | 1 | 仅 `bootstrapSpecWorkspace`，未覆盖 import/sync/update/conflicts |

**总计: 3 个测试文件, 6 个用例**

### 未覆盖（按优先级排序）

#### 高优先级 -- API 层

以下 `lib/*.ts` 模块无任何测试：

- `api.ts` 的 Token 刷新/重试逻辑（最核心的认证逻辑，包含 401 自动刷新 + x-auth-retry 防循环 + refresh 失败清除 session）
- `agent-stream.ts` -- SSE 重连（5 次指数退避）、去重（seenLogIds Set）、断线日志回填
- `auth.ts` -- 登录/登出/token 刷新流程（login 调用两次 API：login + me）
- `workspaces.ts` -- Workspace CRUD + 扫描 + 关系 + 拓扑（最核心的业务模块）
- `changes.ts` -- 变更生命周期（最大的 API 模块，含 transition/feedback/dispatch/documents 等）
- `workflow.ts` -- 审批 + 状态流转
- `tasks.ts` -- 任务管理 + 看板
- 其他 17 个模块: approvals/audit/incidents/releases/runtime/knowledge/scan-docs/health/git-identities/settings/archive/worktree/git-gateway/tool-gateway/change-writer/components/utils

#### 中优先级 -- Store + 组件

- `stores/session.ts` -- Token 管理、persist 持久化、hydration 逻辑、partialize
- `components/workspace-scan-dialog.tsx` -- 多步骤扫描创建流程（6 个 phase 状态机）
- `components/sillyspec-step-progress.tsx` -- 步骤进度展示（3 种渲染模式：无配置/无步骤/完整步骤）
- `components/app-shell.tsx` -- 侧边栏导航、路由感知、logout 流程
- `components/health-card.tsx` -- 定时轮询健康状态
- 其他组件: workspace-card, component-detail-drawer, ui/*

#### 低优先级 -- 页面层

- 20 个 `page.tsx` 页面（建议使用 Playwright E2E 测试覆盖）
- 1 个 Route Handler: SSE 代理（转发逻辑简单，但应验证 header 设置）

## Mock 模式

所有测试采用统一的 Mock 模式：

```typescript
// 1. 全局 fetch mock
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// 2. afterEach 清理
afterEach(() => {
  fetchMock.mockReset();
});

// 3. 测试用例中设置 mock 返回值
fetchMock.mockResolvedValueOnce(
  new Response(JSON.stringify({ ... }), { status: 200 })
);

// 4. 验证调用参数
const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
expect(url).toContain("/api/...");
expect(init.method).toBe("POST");
```

注意：`@testing-library/react` 已安装但未使用。当前测试仅覆盖纯函数式 API 调用，未涉及 React 组件渲染测试。
