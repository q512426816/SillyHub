---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# 测试策略

## 测试基础设施

### 测试框架

| 项目 | 配置 |
|------|------|
| 测试框架 | Vitest ^2.0.0 |
| 测试运行器 | `vitest run` |
| 监听模式 | `vitest` (或 `pnpm test:watch`) |
| DOM 环境 | jsdom ^24.1.0 |
| React 测试 | @testing-library/react ^16.0.0 |
| DOM 断言 | @testing-library/jest-dom ^6.4.6 |
| React 插件 | @vitejs/plugin-react ^4.3.1 |

### Vitest 配置

```typescript
// vitest.config.ts
{
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,                        // describe/it/expect 全局可用
    setupFiles: ["./src/test/setup.ts"],
    css: false,                           // 不处理 CSS
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
}
```

- `globals: true` — 无需在每个测试文件 `import { describe, it, expect } from "vitest"`
- 路径别名 `@/*` 与 tsconfig.json 保持一致

### TypeScript 测试类型

```json
// tsconfig.json
{
  "types": ["vitest/globals", "@testing-library/jest-dom"]
}
```

### 脚本命令

```json
{
  "test": "vitest run",
  "test:watch": "vitest"
}
```

## 现有测试覆盖

### 已有测试

| 测试文件 | 覆盖范围 | 测试数量 |
|---------|---------|---------|
| `src/lib/__tests__/api.test.ts` | apiFetch 核心封装 | 4 个用例 |

#### api.test.ts 用例详情

1. **2xx 响应解析** — 验证正常 JSON 响应被正确解析返回
2. **4xx 错误处理** — 验证结构化错误 payload 被正确包装为 ApiError
   - 检查 `name`, `status`, `code`, `message`, `requestId`
3. **网络错误处理** — 验证 fetch reject 被包装为 `ApiError(status=0, code='network_error')`
4. **x-request-id 请求头** — 验证每次请求自动附加 UUID 格式的 request-id

### 未覆盖区域

#### API 层 (高优先级)

以下 API 模块无测试覆盖：

- `auth.ts` — 登录/登出/token 刷新流程
- `workspaces.ts` — Workspace CRUD + 扫描
- `changes.ts` — 变更生命周期 (最大的 API 模块)
- `agent.ts` — Agent 运行 + SSE 流
- `approvals.ts` — 审批流程
- `incidents.ts` — 事件管理
- `releases.ts` — 发布管理
- `runtime.ts` — 运行时 API
- 其他所有 `lib/*.ts` 模块

#### 组件层 (中优先级)

- 无任何组件测试
- 需关注的组件：
  - `app-shell.tsx` — 侧边栏导航逻辑
  - `workspace-scan-dialog.tsx` — 多步骤创建流程
  - `health-card.tsx` — 轮询逻辑
  - `workspace-card.tsx` — 操作按钮交互

#### Store 层 (中优先级)

- `session.ts` — Token 管理、持久化、水合逻辑

#### 页面层 (低优先级)

- 所有 `page.tsx` 无测试（页面级 E2E 测试更合适）

## Lint 与类型检查

### ESLint

```bash
pnpm lint
# 等同于: next lint
```

- 预设：`next/core-web-vitals`
- 额外规则：未使用变量警告（`_` 前缀可忽略）

### TypeScript 类型检查

```bash
pnpm typecheck
# 等同于: tsc --noEmit
```

- strict mode 全开
- `noUncheckedIndexedAccess` 防止数组/对象索引越界

### 完整检查流程

```bash
pnpm typecheck && pnpm lint && pnpm test
```

## 测试策略建议

### 短期目标 (应补充)

1. **API 层测试**：为每个 `lib/*.ts` 模块添加 mock fetch 测试
   - 重点覆盖错误分支（网络错误、401 刷新、结构化错误）
   - 使用 `vi.stubGlobal("fetch", ...)` mock
2. **Session store 测试**：验证持久化、水合、token 刷新逻辑
3. **关键组件测试**：
   - `WorkspaceScanDialog`：多阶段状态流转
   - `AppShell`：导航高亮、折叠逻辑

### 中期目标

1. **引入 MSW (Mock Service Worker)**：模拟后端 API 响应
2. **组件集成测试**：使用 Testing Library 测试用户交互
3. **覆盖率目标**：API 层 >80%，核心组件 >60%

### 长期目标

1. **E2E 测试**：使用 Playwright 或 Cypress 覆盖核心流程
2. **Visual Regression**：截图对比防止 UI 回归
3. **CI 集成**：在 CI pipeline 中强制运行 typecheck + lint + test
