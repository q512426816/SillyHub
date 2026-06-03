---
author: qinyi
created_at: 2026-06-03T10:00:00
---

# 测试策略

## 测试框架

### 技术栈

| 项目 | 版本 | 说明 |
|------|------|------|
| Vitest | ^2.0.0 | 测试框架 |
| @testing-library/react | ^16.0.0 | React 组件测试工具 |
| @testing-library/jest-dom | ^6.4.6 | DOM 断言扩展（toBeInTheDocument 等） |
| @vitejs/plugin-react | ^4.3.1 | Vitest React 支持 |
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
    css: false,                   // 跳过 CSS 处理
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },  // 与 tsconfig 路径别名一致
  },
}
```

### 测试 Setup

文件: `frontend/src/test/setup.ts`

```typescript
import "@testing-library/jest-dom/vitest";
```

仅引入 jest-dom 的 Vitest 适配，提供 DOM 相关断言匹配器。

## 测试结构

### 文件分布

所有测试文件位于 `frontend/src/lib/__tests__/` 目录，与被测模块同属 `lib/` 目录：

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

### 测试文件详情

#### `api.test.ts` — apiFetch 核心封装（4 个用例）

| 用例 | 验证内容 |
|------|---------|
| 2xx 响应解析 | 正常 JSON 响应被正确解析并返回类型化对象 |
| 4xx 错误处理 | 结构化错误 payload 被包装为 `ApiError`（检查 name, status, code, message, requestId） |
| 网络错误处理 | fetch reject 被包装为 `ApiError(status=0, code='network_error')` |
| x-request-id 请求头 | 每次请求自动附加 UUID 格式的 request-id（长度 >8） |

Mock 方式: `vi.stubGlobal("fetch", vi.fn().mockResolvedValue(...))`

#### `agent.test.ts` — submitAgentRunInput（1 个用例）

| 用例 | 验证内容 |
|------|---------|
| POST input 请求 | URL 包含 `/agent/runs/{runId}/input`，method 为 POST，content-type 为 application/json，body 正确序列化，响应结构匹配 |

#### `spec-workspaces.test.ts` — bootstrapSpecWorkspace（1 个用例）

| 用例 | 验证内容 |
|------|---------|
| POST bootstrap 请求 | URL 包含 `/spec-bootstrap`，method 为 POST，响应包含 agent_run_id / stream_url / status / spec_root / message |

## 测试命令

```bash
# 单次运行全部测试
pnpm test
# 等同于: vitest run

# 监听模式（开发时使用）
pnpm test:watch
# 等同于: vitest

# 类型检查 + Lint + 测试（完整检查流程）
pnpm typecheck && pnpm lint && pnpm test
```

相关 npm scripts：

| 命令 | 实际执行 |
|------|---------|
| `pnpm test` | `vitest run` |
| `pnpm test:watch` | `vitest` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | `next lint` |

## 覆盖范围

### 有测试的模块

| 模块 | 文件 | 用例数 | 覆盖状态 |
|------|------|--------|---------|
| `api.ts` | `__tests__/api.test.ts` | 4 | 较完整（正常/错误/网络/请求头） |
| `agent.ts` | `__tests__/agent.test.ts` | 1 | 仅覆盖 submitAgentRunInput 一个函数 |
| `spec-workspaces.ts` | `__tests__/spec-workspaces.test.ts` | 1 | 仅覆盖 bootstrapSpecWorkspace 一个函数 |

**总计: 3 个测试文件, 6 个用例**

### 无测试的模块（按优先级）

#### API 层 — 高优先级

以下 `lib/*.ts` 模块无测试覆盖：

- `auth.ts` — 登录/登出/token 刷新流程
- `workspaces.ts` — Workspace CRUD + 扫描
- `changes.ts` — 变更生命周期（最大的 API 模块）
- `agent-stream.ts` — SSE 连接管理（断线重连、去重、token 刷新）
- `workflow.ts` — 审批 + 状态流转
- `tasks.ts` — 任务管理
- `approvals.ts` / `audit.ts` / `incidents.ts` / `releases.ts` / `runtime.ts`
- `knowledge.ts` / `scan-docs.ts` / `health.ts`
- `git-identities.ts` / `settings.ts` / `archive.ts`
- `worktree.ts` / `git-gateway.ts` / `tool-gateway.ts`
- `change-writer.ts` / `components.ts`

#### Store 层 — 中优先级

- `stores/session.ts` — Token 管理、persist 持久化、水合逻辑

#### 组件层 — 中优先级

- `components/app-shell.tsx` — 侧边栏导航
- `components/workspace-scan-dialog.tsx` — 多步骤扫描创建流程
- `components/health-card.tsx` — 健康状态轮询
- `components/workspace-card.tsx` — Workspace 卡片交互
- `components/sillyspec-step-progress.tsx` — 步骤进度条
- `components/component-detail-drawer.tsx` — 组件详情抽屉
- `components/ui/*.tsx` — 基础 UI 原子组件（button, input, badge）

#### 页面层 — 低优先级

- 25 个 `page.tsx` 页面无测试（建议使用 E2E 测试覆盖）
- 1 个 API Route: `app/api/workspaces/[workspaceId]/agent/runs/[runId]/stream/route.ts`
