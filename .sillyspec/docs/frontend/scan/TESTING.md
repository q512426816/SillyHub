---
author: scan-agent
created_at: "2026-06-03"
---

# SillyHub Frontend — 测试体系

## 测试框架

- **Vitest** ^2.0.0 — 主测试运行器
- **jsdom** ^24.1.0 — DOM 模拟环境
- **@testing-library/jest-dom** ^6.4.6 — DOM 断言扩展
- **@testing-library/react** ^16.0.0 — React 组件测试（已安装，测试中未使用）
- **@vitejs/plugin-react** ^4.3.1 — Vite React 插件

## 配置

### Vitest 配置

项目**没有独立的 vitest.config 文件**，使用 Vitest 默认配置。全局类型在 `tsconfig.json` 中声明：

```json
{
  "types": ["vitest/globals", "@testing-library/jest-dom"]
}
```

### 全局 Setup

`src/test/setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

### 运行命令

```bash
pnpm test          # vitest run（单次运行，CI 模式）
pnpm test:watch    # vitest（监听模式）
```

## 测试文件分布

所有测试文件位于 `src/lib/__tests__/` 目录下，与源码同目录的 `__tests__` 子目录：

```
src/lib/__tests__/
├── api.test.ts               # apiFetch 核心封装测试
├── agent.test.ts             # Agent API 客户端测试
└── spec-workspaces.test.ts    # Spec Workspace 测试
```

**总计**: 3 个测试文件

## 测试内容详情

### 1. `api.test.ts` — apiFetch 核心测试

测试 apiFetch 函数的关键行为：

| 测试用例 | 验证内容 |
|---------|---------|
| 2xx 响应 | 返回正确解析的 JSON 对象 |
| 4xx 响应 | 抛出 ApiError，包含 code/message/status/requestId |
| 网络失败 | 抛出 ApiError(status=0, code="network_error") |
| 请求头 | 每个请求自动附加 x-request-id |

### 2. `agent.test.ts` — Agent API 测试

| 测试用例 | 验证内容 |
|---------|---------|
| submitAgentRunInput | 发送 POST 到正确 URL，携带 JSON body，返回正确结构 |

### 3. `spec-workspaces.test.ts` — Spec Workspace 测试

| 测试用例 | 验证内容 |
|---------|---------|
| bootstrapSpecWorkspace | 发送 POST 到正确 URL，返回 agent_run_id/stream_url 等 |

## 测试策略

### 当前策略
- **单元测试** — API 客户端函数的请求/响应验证
- **Mock 方式** — `vi.stubGlobal("fetch", mockFn)` 替换全局 fetch
- **测试范围** — 仅覆盖 `lib/` 层的 API 客户端函数

### Mock 模式
```ts
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

// 设置 mock 响应
fetchMock.mockResolvedValueOnce(
  new Response(JSON.stringify({ ok: true }), { status: 200 })
);
```

## 测试覆盖缺口

| 未覆盖领域 | 说明 |
|-----------|------|
| **组件测试** | 无任何 React 组件的渲染/交互测试 |
| **页面测试** | 无页面级测试（路由、数据加载、用户交互） |
| **Store 测试** | Zustand session store 未测试 |
| **auth.ts 测试** | 登录/登出/token 刷新流程未测试 |
| **SSE 流测试** | AgentRunStreamClient 未测试 |
| **集成测试** | 无端到端流程测试 |
| **E2E 测试** | 无 Playwright/Cypress 测试 |
| **TypeScript 类型测试** | 无类型层面的验证 |
| **API 客户端** | 22 个模块中仅 2 个有测试（覆盖率 ~9%） |

## 改进建议

1. **优先为 auth.ts 添加测试** — token 刷新、登出逻辑复杂且关键
2. **为 AgentRunStreamClient 添加测试** — 断线重连、消息去重是核心逻辑
3. **添加关键页面测试** — 至少覆盖登录页、Workspace 详情页
4. **考虑引入 TanStack Query Testing** — 如果后续迁移到 TanStack Query 管理服务端状态
5. **添加 E2E 测试** — Playwright 覆盖核心用户流程（登录 → 创建 Workspace → 查看详情）
