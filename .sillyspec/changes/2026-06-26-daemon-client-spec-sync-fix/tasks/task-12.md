---
author: qinyi
created_at: 2026-06-26 11:36:00
priority: P1
depends_on: [task-10]
blocks: []
requirement_ids: [FR-08, FR-09]
decision_ids: [D-004@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/create-change/**
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/**
  - frontend/src/lib/changes.ts
  - frontend/src/components/**
wave: W4
---

# task-12 — frontend changes 新建入口：daemon-client 走 proxy-create + 禁用引导

## 目标

changes 新建入口在 workspace 为 daemon-client 时改走 `POST /changes/proxy-create`（body 带 `runtime_id=workspace.daemon_runtime_id`），由 daemon 代写；daemon 未绑定/离线时禁用新建按钮 + tooltip 引导；提交返回 `DAEMON_CLIENT_NO_SESSION`(400) 时显示引导 toast/错误条。覆盖 FR-08、FR-09。server-local 行为零回归。

## 依据

- design.md §5.3 Phase 3「前端（changes 新建入口）：workspace 为 daemon-client 时调 proxy 端点（带 runtime_id）；daemon 离线时按钮禁用 + tooltip」
- design.md §7 接口定义：`DaemonClientNoActiveSession(code=DAEMON_CLIENT_NO_SESSION, http_status=400)`
- design.md §7.5 生命周期契约表：proxy-create（daemon 离线）→ 400 DAEMON_CLIENT_NO_SESSION
- FR-08（daemon-client change 经 lease-polling 代写）、FR-09（无 daemon 结构化错误引导）
- D-004@v1（change-write 走 lease-polling，前端只感知 proxy 端点 + 结构化错误）
- 现有代码：
  - 新建表单：`frontend/src/app/(dashboard)/workspaces/[id]/create-change/page.tsx`（`handleSubmit` 调 `createChange`）
  - API 客户端：`frontend/src/lib/changes.ts:235` `createChange` → `POST /api/workspaces/{id}/changes/create`
  - Workspace 类型：`frontend/src/lib/workspaces.ts:40` `path_source: "server-local"|"daemon-client"` + `daemon_runtime_id: string|null`
  - ApiError：`frontend/src/lib/api.ts:61` 暴露 `.code` / `.status`（可直接判 `code==="DAEMON_CLIENT_NO_SESSION"`）
  - runtime 在线状态：`frontend/src/lib/daemon.ts` `listDaemonRuntimes`（`status==="online"`，参考 `AgentProviderSelect.tsx:47`）
  - 入口按钮：`frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx:289` 「+ 新建变更」

## implementation

1. **lib/changes.ts**：新增 `ProxyCreateChangeInput`（`title/description?/change_type?/runtime_id`）与 `proxyCreateChange(workspaceId, input)` → `POST /api/workspaces/{id}/changes/proxy-create`，返回复用 `CreateChangeResponse`。
2. **create-change/page.tsx**：
   - 加载 workspace（`getWorkspace(workspaceId)`）+ runtimes（`listDaemonRuntimes`）；派生 `isDaemonClient = workspace.path_source==="daemon-client"`、`runtime = runtimes.find(r=>r.id===workspace.daemon_runtime_id)`、`daemonOnline = runtime?.status==="online"`。
   - daemon-client 且（`!daemon_runtime_id` 或 `!daemonOnline`）→ 「提交需求」按钮 `disabled` + tooltip「需要在线 daemon 才能在客户端工作区创建变更」（无 Tooltip 组件则用 `title=` 属性兜底，遵循既有组件风格）。
   - `handleSubmit` 分流：daemon-client → `proxyCreateChange(workspaceId, {...input, runtime_id: workspace.daemon_runtime_id!})`；否则原 `createChange`。
   - catch：`err instanceof ApiError && err.code==="DAEMON_CLIENT_NO_SESSION"` → 展示引导文案「当前 daemon 未在线，无法在客户端工作区创建变更，请启动 daemon 后重试」（复用既有 inline `error` 条；该 changes 模块无 toast 体系，沿用 inline 错误，不引入新依赖）；其他错误沿用 `err.message`。
3. **changes/page.tsx**（入口按钮，可选增强）：列表页「+ 新建变更」按钮在 daemon-client 离线时同样 `disabled` + tooltip（与表单页一致；若 workspace 未在此页预加载则降级为仅跳转，由表单页兜底禁用，避免双重加载）。

## acceptance

- daemon-client workspace + daemon 在线：提交 → 调 `proxy-create` → 成功跳转 change 详情（SC4）。
- daemon-client + daemon 离线/未绑定：新建按钮禁用 + tooltip 引导（SC5 前置）。
- daemon-client 提交遇 400 `DAEMON_CLIENT_NO_SESSION`：显示引导文案（SC5）。
- server-local workspace：新建行为与改动前完全一致（调原 `create`，无 runtime 校验）（SC3 回归）。
- 文案中文（CLAUDE.md 规则 11）。

## verify

```bash
cd frontend && pnpm test           # create-change 组件测试（daemon-client 分流 / 禁用 / 400 引导 / server-local 回归）
cd frontend && pnpm exec tsc --noEmit
cd frontend && pnpm lint
```

组件测试要点：mock `getWorkspace`/`listDaemonRuntimes`/`proxyCreateChange`/`createChange`；断言 daemon-client 在线走 proxy-create（payload 含 runtime_id）、离线按钮 disabled、400 DAEMON_CLIENT_NO_SESSION 渲染引导文案、server-local 走 createChange。

## constraints

- UI 文案中文；不破坏 server-local changes 新建链路。
- 复用既有 `apiFetch`/`ApiError`/inline 错误条；不引入新 toast 依赖。
- `runtime_id` 取自 `workspace.daemon_runtime_id`（backend 已存），前端不发明 id。
- 兼容 Windows/Linux/macOS（纯前端，无路径逻辑）。
