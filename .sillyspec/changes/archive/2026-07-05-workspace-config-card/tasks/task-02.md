---
id: task-02
title: 实现「我的接入」组渲染（绑定守护进程 daemon-chip / 本地项目路径 / 路径来源 / 初始化状态徽标 / 上次接入同步 + 编辑入口按钮）
author: qinyi
created_at: 2026-07-05 01:18:51
priority: P0
depends_on: [task-01]
blocks: [task-04]
requirement_ids: [FR-001, FR-008]
decision_ids: [D-001@V1]
allowed_paths: [frontend/src/components/workspace-config-card.tsx]
---

## Goal

> 在 task-01 骨架的「我的接入」组位置（per-member 可编辑区），按 design §7.4 字段映射渲染当前用户绑定信息：绑定守护进程 daemon-chip（hostname + alias + provider 徽标 + online dot）、本地项目路径（mono-path + truncate + tooltip）、路径来源 badge（daemon-client / server-local）、接入初始化状态徽标（已初始化 emerald / 未初始化 amber + 时间 + 文档版本）、上次接入同步时间，并在组右上角挂「编辑我的接入」按钮入口（点击行为留 task-04 接线，本任务仅渲染按钮）。

## Implementation

- 在 task-01 骨架「我的接入」组占位处填充渲染；数据来源仅 `props.myBinding: MemberBindingView` 与 `props.boundDaemon: DaemonInstanceRead | null`（D-001@V1：纯 backend API 数据，不读本地文件）。
- 字段渲染（用 `<dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-xs">`，与详情页现有 SectionCard 内 dl 一致）：
  - **绑定守护进程**：参考 `workspace-path-fields.tsx` 第 57-110 行 daemon 实体渲染风格——主标 `boundDaemon.display_alias ?? boundDaemon.hostname`（truncate + title=boundDaemon.id）+ provider 徽标列表（`boundDaemon.providers.map(p => PROVIDER_META[p.provider]?.label ?? p.provider)`，每项 `<Badge variant="outline" className="text-[10px]">`）+ online 徽标（`boundDaemon.status === "online" ? "在线" : "离线"`，variant `success` / `outline`）。`boundDaemon == null` 时显示「未绑定守护进程」muted 文案。
  - **我的本地项目路径**：`<dd className="truncate font-mono" title={myBinding.root_path}>{myBinding.root_path}</dd>`（truncate + font-mono + tooltip 全路径，design §5.5）。
  - **路径来源**：`<Badge variant={isDaemonClient ? "default" : "outline"}>{workspacePathSourceLabel(myBinding.path_source as WorkspacePathSource)}</Badge>`（daemon-client=default/blue、server-local=outline/slate，复用 `@/lib/workspace-path` 现有函数）。
  - **接入初始化状态**：`myBinding.init_synced_at` 非空 → `<Badge variant="success">已初始化</Badge>` + `formatTs(init_synced_at)` + `（v${myBinding.init_synced_spec_version}）`；为空 → `<Badge variant="warning">未初始化</Badge>`。
  - **上次接入同步**：`formatTs(myBinding.synced_at)`（与详情页 `formatTs` 同实现 `raw ? new Date(raw).toLocaleString() : "---"`，本组件内复制定义，避免新增 util）。
- 组右上角「编辑我的接入」`<Button size="sm" variant="outline" data-testid="config-edit-entry" onClick={() => setEditing(true)}>编辑我的接入</Button>`；`editing` state 由 task-01 骨架预留或本任务补 `const [editing, _setEditing] = useState(false)`（setter 在 task-04 接线保存后收起，本任务仅占位 `_setEditing` 避免未使用告警）。
- server-local 工作区（`myBinding.path_source === "server-local"`）按 §5.3 隐藏「绑定守护进程」字段并显示「服务器本地工作区，无需守护进程」说明文案；其余字段正常渲染。

## Acceptance

- `WorkspaceConfigCard` 在 `myBinding != null && path_source === "daemon-client"` 时完整渲染上述 5 个字段 + 编辑入口按钮；6 个 props 中本任务至少消费 `myBinding` / `boundDaemon`（其余 props 留 task-03/06 消费，不应触发未使用告警——按 task-01 约定以占位引用或 `_` 前缀兼容）。
- daemon-chip 字段顺序与样式（主标 + provider outline 徽标列表 + online dot）与现有 `workspace-path-fields.tsx` daemon 分支一致，不重写已稳定的 chip 视觉。
- 路径字段一律 `font-mono + truncate + title 全路径`（§5.5）；徽标一律复用 `Badge` 现有 variant（不新增 variant、不改 badge.tsx）。
- 标签全部中文（绑定守护进程 / 我的本地项目路径 / 路径来源 / 接入初始化状态 / 上次接入同步 / 编辑我的接入）；时间用本地化 `toLocaleString()`。
- 不改 backend / daemon / API client / page.tsx；仅修改 `workspace-config-card.tsx`（在 task-01 骨架基础上填充）。

## Verify

- `cd frontend && pnpm exec tsc --noEmit`（类型零错误；含 strict null check：`boundDaemon` / `init_synced_at` / `synced_at` 均为可空）。
- `cd frontend && pnpm exec vitest run`（本任务不写新测试，task-08 统一覆盖；既有套件零回归）。

## Constraints

- 字段映射严格按 design §7.4「我的接入」组表（绑定守护进程 / 我的本地项目路径 / 路径来源 / 接入初始化状态 / 上次接入同步）；不增不减字段（YAGNI）。
- 复用现有约定：`Badge` + `font-mono` + `truncate` + `workspacePathSourceLabel` + `PROVIDER_META`，不重写 `workspace-path-fields.tsx` 已稳定的 daemon-chip 逻辑（design §5.1「复用而非重写」）。
- daemon-chip 字段来源 = `props.boundDaemon`（page.tsx 第 214-247 行 useEffect 已按 `myBinding.daemon_id` 从 `listDaemonInstances` find 出的实例），卡片内不再发请求（§7.R-03 已降级）。
- 中文 UI（CLAUDE.md 规则 11、15）；路径展示跨平台统一 POSIX `/`（`myBinding.root_path` 原样展示，不转换分隔符）。
- 「编辑我的接入」按钮本任务仅渲染 + 占位 `setEditing(true)`，就地展开 WorkspaceAccessGuide 编辑模式 + 保存调 `upsertMyBinding` + `onRefresh` + 收起留给 task-04（依赖本任务的 `editing` state + 按钮 testid）。
- 本任务零 API 调用、零生命周期事件（design §7.5），纯展示 + 一个本地 state。
