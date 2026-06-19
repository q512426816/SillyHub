---
author: qinyi
created_at: 2026-06-19 12:50:59
source_commit: 0303536
updated_at: 2026-06-19T04:50:59Z
generator: sillyspec-scan
---

# frontend 测试扫描

> 基于 `frontend/src/**/*.{test,spec}.{ts,tsx}` glob + grep 摘录，覆盖旧版文档。

## 框架与配置

- **单元/组件测试**：vitest 2 + jsdom + `@testing-library/react` + `@testing-library/jest-dom`
- **setup**：`src/test/setup.ts`（注册 jest-dom 自定义匹配器，配置 jsdom）
- **config**：`frontend/vitest.config.ts`
- **运行命令**：`pnpm test`（由根 `local.yaml` 定义）
- **E2E**：`@playwright/test ≥1.60` + `puppeteer 24` 已声明依赖，但 `frontend/` 下未发现 `e2e/` / `tests/` / `playwright/` 目录与 spec 文件（glob 0 命中）——E2E 脚本尚未落地

## 测试文件清单（19 份）

### lib/ 领域测试（`src/lib/__tests__/`）

| 文件 | 覆盖 |
|---|---|
| `api.test.ts` | `apiFetch` 网关、401 刷新、Token 注入 |
| `agent.test.ts` | agent 调用 / 流入口 |
| `spec-workspaces.test.ts` | spec-bootstrap POST、stream_url 解析 |
| `admin.test.ts` | 后台领域 client |
| `menu-permissions.test.ts` | 菜单权限模型 |
| `permission.test.ts` | 权限判断 helper |
| `client-path.test.ts` | 客户端路径解析 |
| `workspace-path.test.ts` | workspace 路径解析 |
| `daemon-permission.test.ts` | daemon 权限审批 |
| `daemon-session.test.ts` | daemon session SSE 解析（21 处断言） |
| （根）`daemon.test.ts` | daemon 流式 client |

### components/ 组件测试（`src/components/__tests__/`）

| 文件 | 覆盖 |
|---|---|
| `admin-organization-tree.test.tsx` | 组织树组件 |
| `admin-user-drawer.test.tsx` | 用户 Drawer（create/edit 模式、字段校验、组织勾选等 8 个 case） |
| `admin-role-permission-picker.test.tsx` | 角色权限选择器（4 个分区、菜单数量断言） |

### 其他位置

| 文件 | 覆盖 |
|---|---|
| `src/components/agent-log/__tests__/normalize.test.ts` | SSE 日志归一化 |
| `src/components/daemon/__tests__/interactive-session-panel.test.tsx` | daemon 交互面板（15 处断言） |
| `src/components/permission-approval-dialog.test.tsx` | 权限审批对话框 |
| `src/app/(dashboard)/runtimes/page.test.tsx` | runtimes 页面（3 处断言） |
| `src/app/api/daemon/sessions/[sessionId]/stream/__tests__/route.test.ts` | SSE Route Handler 透传（验证 Accept / Content-Type / 状态码透传） |

## 测试风格

- **断言库**：vitest 原生 `describe / it / test` + `expect`
- **co-locate 约定**：测试文件置于被测模块同级的 `__tests__/` 子目录，文件名 `<name>.test.{ts,tsx}`
- **mock 策略**：fetch/Response 在测试内手动构造（如 SSE 测试用 `new Response("data: {}\n\n", { headers: { "Content-Type": "text/event-stream" } })`）
- **覆盖重心**：数据层（lib/）+ 关键交互组件（admin / daemon / permission）+ SSE 透传 Route Handler；页面级测试仅 runtimes 一例
