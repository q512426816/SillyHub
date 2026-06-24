---
schema_version: 1
doc_type: module-card
module_id: frontend
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:42
---
# frontend

## 定位

multi-agent-platform 的 Web 控制台，用户操作平台的唯一图形入口。基于 Next.js 14 App Router + React 18 + TypeScript 构建，向用户呈现工作区、运行时会话、SillySpec 变更中心、PPM 项目管理、Agent 运行面板、权限审批、健康状态等功能。运行时依赖 backend 的 `/api` 接口；daemon 相关交互经 frontend 的 `/api/daemon*` route handler 与后端/守护进程协调。

技术栈：Next.js 14.2、React 18、TypeScript、Tailwind CSS 3.4、Ant Design 6 + @ant-design/icons、Radix UI、TanStack React Query（数据层）、Zustand（状态）、Zod（校验）、ECharts（图表）、@xyflow/react（流程图）、Vitest（单测）、Playwright/Puppeteer（E2E）、pnpm。

## 契约摘要

对外契约是浏览器渲染的页面与少量 BFF route：

- **页面路由**（App Router）：根 `page.tsx`；`(auth)/login` 登录；`(dashboard)/` 下含 workspaces、runtimes、settings、admin、ppm 五大功能区，各自带 `layout.tsx`。
- **BFF route handlers**：`src/app/api/` 下 daemon、daemon-chat、workspaces，承接需要服务端代理的 daemon 通信与 SSE/WS 转发。
- **后端依赖**：所有领域数据来自 backend `/api/*`；daemon 实时会话走 WebSocket/SSE。
- **构建产物**：`next build` 产出独立 Node 服务，Docker 中以独立容器运行，端口对 backend 反代或直连。

## 关键逻辑

- **目录组织**：`src/app`（路由）、`src/components`（40+ 业务组件，含 daemon/、agent-log/、layout/、charts/、permissions/、ui/ 子树及大量 ppm-/workspace-/admin- 前缀组件）、`src/lib`（工具/API 封装）、`src/stores`（Zustand）、`src/styles`、`src/test`。
- **核心组件**：app-shell（外壳布局）、top-bar、workspace-tabs、mission-console（任务控制台）、agent-run-panel、agent-log-viewer、runtime-session-dialog、permission-approval-dialog、ask-user-dialog-card、health-card、server-status-card、sillyspec-step-progress。
- **数据层**：React Query 管理服务端状态，Zustand 管 UI/会话状态；daemon 聊天与权限流为长连接交互。
- **脚本**：dev/build/start/lint/typecheck/test，CI 跑 lint+typecheck+test+build 全链路。

## 注意事项

- UI 文案与文档尽量用中文（项目硬性规则），仅专业术语保留英文。
- frontend 容器 healthcheck 曾因 busybox wget 走 Docker 注入代理误报 unhealthy，属探针问题非服务故障；当前 Dockerfile 用 node20 内置 fetch 零依赖探测。
- 改 daemon 交互类组件（runtime-session-dialog 等）要同步看 backend daemon 模块与 sillyhub-daemon protocol 的契约一致性。

## 人工备注
<!-- MANUAL_NOTES_START -->

## 变更索引
- ql-20260624-003-a7f1 | 优化 /runtimes 会话弹窗布局样式：扩大 RuntimeSessionDialog 工作区，改造会话列表为左侧栏，统一交互式会话与历史回看面板高度和输入栏间距。
- ql-20260624-004-c8a2 | 优化 /settings/api-keys 页面和 API Key 创建弹窗：统一页面容器、标题区、卡片、状态和空态样式，补充统计概览与表格密度整理。

<!-- MANUAL_NOTES_END -->
