---
author: qinyi
created_at: 2026-06-19 12:50:59
source_commit: 0303536
updated_at: 2026-06-19T04:50:59Z
generator: sillyspec-scan
---

# frontend 目录结构

> 基于 `frontend/src/` glob 摘录，覆盖旧版文档。

## 目录树

```
frontend/
├── src/
│   ├── app/                      Next.js App Router
│   │   ├── layout.tsx            根 layout（metadata + antd registry）
│   │   ├── page.tsx              首页
│   │   ├── globals.css           Tailwind + shadcn CSS variables
│   │   ├── (auth)/login/         登录页（client）
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx        主壳层
│   │   │   ├── runtimes/         运行时管理
│   │   │   ├── workspaces/       工作区列表
│   │   │   │   └── [id]/         工作区详情（嵌套 layout）
│   │   │   │       ├── layout.tsx
│   │   │   │       ├── page.tsx                  概览
│   │   │   │       ├── agent/                    agent 执行
│   │   │   │       ├── create-change/            创建变更
│   │   │   │       ├── changes/
│   │   │   │       │   ├── page.tsx              变更列表
│   │   │   │       │   └── [cid]/
│   │   │   │       │       ├── page.tsx          变更详情
│   │   │   │       │       └── tasks/{page.tsx, [tid]/page.tsx}
│   │   │   │       ├── components/{page.tsx, topology/page.tsx}
│   │   │   │       ├── releases/ runtime/ members/ knowledge/
│   │   │   │       ├── incidents/{page.tsx, [iid]/page.tsx}
│   │   │   │       ├── approvals/ audit/ scan-docs/
│   │   │   ├── settings/{page.tsx, api-keys/, git-identities/}
│   │   │   └── admin/{layout.tsx, organizations/, users/, roles/}
│   │   └── api/                  Route Handler（SSE 透传）
│   │       ├── workspaces/[workspaceId]/agent/runs/[runId]/stream/
│   │       ├── daemon-chat/[runId]/stream/
│   │       └── daemon/sessions/[sessionId]/stream/
│   ├── components/
│   │   ├── app-shell.tsx                 dashboard 壳层
│   │   ├── antd-providers.tsx            antd registry
│   │   ├── ui/                           shadcn 原子件（button/badge/input）
│   │   ├── agent-log/                    agent 日志（normalize/tool-renderers/types）
│   │   ├── daemon/                       daemon 交互会话面板
│   │   ├── admin-*.{tsx}                 后台管理组件
│   │   ├── workspace-*.{tsx}             工作区相关组件
│   │   ├── permission-approval-{card,dialog}.tsx
│   │   ├── api-key-create-dialog.tsx
│   │   ├── component-detail-drawer.tsx
│   │   ├── sillyspec-step-progress.tsx
│   │   ├── health-card.tsx
│   │   ├── AgentModelInput.tsx / AgentProviderSelect.tsx
│   │   ├── daemon-dir-browser.tsx
│   │   └── __tests__/                    组件测试
│   ├── lib/                      业务/数据层
│   │   ├── api.ts                网关（apiFetch + 401 刷新）
│   │   ├── auth.ts / settings.ts / api-keys.ts / git-identities.ts
│   │   ├── workspaces.ts / workspace-members.ts / workspace-path.ts / client-path.ts
│   │   ├── changes.ts / change-writer.ts / tasks.ts / archive.ts / workflow.ts
│   │   ├── agent.ts / agent-stream.ts
│   │   ├── daemon.ts（+ daemon-permission / daemon-session，见 tests）
│   │   ├── admin.ts / menu-permissions.ts / permission.ts
│   │   ├── releases.ts / runtime.ts / audit.ts / approvals.ts
│   │   ├── incidents.ts / knowledge.ts / components.ts / scan-docs.ts
│   │   ├── spec-workspaces.ts
│   │   ├── git-gateway.ts / tool-gateway.ts / worktree.ts
│   │   ├── health.ts / utils.ts
│   │   └── __tests__/            领域测试
│   ├── stores/
│   │   └── session.ts            Zustand 会话 store（persist）
│   └── test/
│       └── setup.ts              vitest setup（jest-dom）
├── components.json               shadcn/ui 配置
├── next.config.mjs               Next 配置（rewrites / standalone）
├── tsconfig.json                 strict + noUncheckedIndexedAccess
├── tailwind.config.ts
├── vitest.config.ts
├── .eslintrc.json
├── Dockerfile                    生产镜像
└── package.json
```

## 模块说明

| 模块 | 职责 |
|---|---|
| `app/(dashboard)/workspaces/[id]/*` | 工作区主功能区，按业务领域分子路由（agent / changes / releases / runtime / members / knowledge / incidents / approvals / audit / scan-docs / components / topology） |
| `app/(dashboard)/admin/*` | 组织 / 用户 / 角色权限管理（独立 layout + 权限菜单） |
| `app/(dashboard)/settings/*` | 个人设置 / API Key / Git 身份 |
| `app/api/**/stream/route.ts` | 3 个 SSE 透传 Route Handler，统一 `text/event-stream` |
| `components/ui/` | shadcn 原子控件（与 antd 业务组件并存） |
| `components/agent-log/` | agent 执行日志的解析（normalize）+ 工具调用渲染 |
| `components/daemon/` | daemon 交互式会话面板（权限审批、流式输出） |
| `lib/api.ts` | 唯一对外网关：`apiFetch` + Token + 401 自动刷新 |
| `lib/*-stream.ts / daemon.ts` | SSE 客户端消费层 |
| `lib/admin.ts / permission.ts / menu-permissions.ts` | 权限/菜单模型 |
| `stores/session.ts` | 登录态（用户、access/refresh token） |
| `test/setup.ts` | vitest 全局 setup（jest-dom 匹配器、jsdom） |
