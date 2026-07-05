---
author: qinyi
created_at: 2026-07-02 09:59:36
---

# Requirements — 2026-07-02-workspace-config-flow

> 引用 decisions.md 当前版本全部决策 **D-001@V1 ~ D-011@V1**。每条 FR 标注所覆盖决策。

## FR-001 per-member scan/dispatch 接线（D-006）
`AgentService.start_scan_dispatch` / `RunPlacementService._resolve_dispatch_runtime` / `_resolve_decide_runtime` 按 actor 的 `WorkspaceMemberRuntime` 路由 runtime_id + root_path，废弃读 `Workspace` 全局 daemon_runtime_id/root_path。

## FR-002 客户端路径 per-member 可编辑（D-007）
已绑定成员在详情页「编辑我的接入配置」入口能改 runtime_id / root_path / path_source，调 `PUT /api/workspaces/{id}/my-binding`。

## FR-003 WorkspaceDaemonSwitcher per-member 化（D-011）
`WorkspaceDaemonSwitcher.handleSwitch` 从 `updateWorkspace({daemon_runtime_id})` 改为 `upsertMyBinding({runtime_id})`，不再写 workspace 全局列。

## FR-004 初始化按钮重定义（D-002 / D-005 / D-009）
「初始化」触发 init lease dispatch：服务器建容器（`_ensure_spec_workspace`）自动完成 + 派 init lease（payload 带 platform_config + latest_spec_version + root_path）→ daemon 写 `.sillyspec-platform.json` + `pullSpecBundle` + `postSpecSync`。

## FR-005 .sillyspec-platform.json 文件（D-002）
daemon 写到成员 rootPath，schema：`{workspace_id, server_origin, strategy, spec_version, cache_root, synced_at}`。

## FR-006 扫描门禁 = 仅 owner（D-003@V2 / D-004）
`scan_generate` 校验 actor 是否该 workspace owner：非 owner → 403 + 「仅 owner 可扫描」提示；owner 扫描时查 `scan_documents` count（按 workspace_id），>0 且无 `force=true` → 409 + 重扫确认。永不过期（仅 count 判定）。

## FR-007 初始化只拉已有，无则提示先扫（D-005）
init 完成后若服务器无 scan_documents，前端提示「请先扫描」，不自动触发扫描。

## FR-008 文档整包同步（D-001）
spec 树同步复用 tar 整树通道（build_bundle / apply_sync / postSpecSync），不做传输层 manifest。保留 spec_version 作为未来增量扩展点。

## FR-009 缓存日常保鲜（D-010）
lease payload 增加 `latest_spec_version`；daemon 执行 agent/scan 任务前比对本地 `.sillyspec-platform.json.spec_version`，旧了触发 `pullSpecBundle`。

## FR-010 双向冲突保护（D-008）
`pullSpecBundle` 前检查本地未回灌改动（postSpecSync 失败标记 / 本地 mtime 新于 synced_at）；有则先 `postSpecSync`；回灌失败则 abort pull + lease failed，不强行覆盖。

## FR-011 数据模型变更（D-010）
`SpecWorkspace` 加 `spec_version: int`（plan 阶段核实是否复用现有 `profile_version`）；`WorkspaceMemberRuntime` 加 `init_synced_at` / `init_synced_spec_version`。Alembic migration。

## FR-012 默认零回归 / 兼容
未初始化 / 无 force 行为与现状一致；旧 binding（无 WorkspaceMemberRuntime 行）回退读全局列直到首次初始化/编辑；`Workspace` 全局列保留只读不删。

## FR-013 手动同步入口（D-012，复用 outbox）
就绪态「同步到服务器」按钮建 DaemonChangeWrite outbox 行（kind=spec-sync，path_source 分流）；daemon 拉取后调 `postSpecSync` 整树回灌本地手改到服务器；前端轮询 pending→done（对齐 change-detail-file-tree-editor 状态机）。依赖 change-detail-file-tree-editor 的 `kind` 字段先合。

## 剩余风险（未覆盖决策：无）
- D-001~D-011 全部被 FR-001~FR-012 覆盖。
- `spec_version` 复用 `profile_version` 待 plan 核实 model（不影响 FR 成立，仅字段名）。
