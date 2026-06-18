---
author: qinyi
created_at: 2026-06-18T11:25:09
change: 2026-06-18-workspace-client-path
---

# Decisions — 2026-06-18-workspace-client-path

本次变更的决策台账（有实现/验收影响的决策）。

## D-001@v1: workspace 强绑单个 daemon + 离线即失败
- type: architecture / boundary
- status: accepted
- source: user (grill)
- priority: P0
- question: daemon-client workspace 代码在特定 daemon 机器，如何绑定？该 daemon 离线时 agent run 怎么办？（现状 `_get_online_runtime(user_id)` 按 user 选，多 daemon 会路由错）
- answer: 创建时绑定**单个** daemon_runtime_id；agent run 强制路由到该 runtime；离线立即失败并提示
- normalized_requirement: path_source=daemon-client 的 workspace.daemon_runtime_id 必填；`dispatch_to_daemon` 优先按 workspace.daemon_runtime_id 选 runtime（覆盖 user 级），目标离线抛 `NoOnlineDaemonError` 携 runtime 标识
- impacts: [FR-model, FR-route, design §5 Phase4/§6, task placement]
- evidence: placement.py:174（现状按 user）；用户 grill 回答

## D-002@v1: list_dir 用 allowed_roots 白名单
- type: boundary / risk
- status: accepted
- source: user (grill)
- priority: P0
- question: daemon list_dir RPC 能浏览客户端文件系统哪些范围？（daemon 现无 allowed_roots）
- answer: daemon config.json 新增 `allowed_roots: string[]`；list_dir 仅允许列白名单内路径，越界 403
- normalized_requirement: DaemonConfig 加 allowed_roots（默认 `[homedir]`）；list_dir 校验 `path` 必须在某 allowed_root 之下，否则返回 error.code=forbidden
- impacts: [FR-dir-boundary, design §5 Phase2/§6 file-rpc.ts, task config]
- evidence: config.ts DaemonConfig（现状无 allowed_roots）；用户 grill 回答

## D-003@v1: spec 服务器平台托管
- type: architecture
- status: accepted
- source: user (step6)
- priority: P0
- question: 通过 daemon 接入的客户端项目，spec 文档存哪？
- answer: 服务器平台托管（沿用 `spec_workspaces.spec_root = {SPEC_DATA_ROOT}/{ws_id}` 真理源）；daemon 执行时按需借阅到本地临时区、执行后回传
- normalized_requirement: spec 真理源始终为 backend spec_root；daemon 不长期持有 spec 副本；前端列表/编辑读服务器
- impacts: [FR-bundle-sync, design §2/§5 Phase4/§9]
- evidence: spec_workspace/service.py:54；workspace-spec-root-managed-p0 已通电；用户 step6 回答

## D-004@v1: 新增 path_source 字段 + daemon_runtime_id 绑定
- type: data-model
- status: accepted
- source: user (step6)
- priority: P0
- question: workspace 如何区分「服务器本地路径」与「daemon 客户端路径」？
- answer: Workspace 新增 path_source(server-local/daemon-client) + daemon_runtime_id；server-local 兼容不变
- normalized_requirement: workspaces 加 path_source(default server-local) + daemon_runtime_id(FK)；daemon-client 时 daemon_runtime_id 必填
- impacts: [FR-model, design §5 Phase1/§8, task migration]
- evidence: model.py:22-127 Workspace（现状仅 root_path）；用户 step6 回答

## D-005@v1: daemon 新增 list_dir RPC（前端树形浏览）
- type: feature
- status: accepted
- source: user (step6)
- priority: P1
- question: 前端选 daemon 客户端路径时是否需要可视化目录浏览？
- answer: 新增 list_dir RPC（WS RPC 通道），前端树形浏览后选定
- normalized_requirement: daemon 新增 WS RPC（RPC/RPC_RESULT）；backend 暴露 list-dir 转发端点；前端树形组件懒加载子节点
- impacts: [FR-dir-browser, design §5 Phase2/3/§7, task daemon-rpc+frontend]
- evidence: protocol.ts（现状无 RPC 消息）；用户 step6 回答

## D-006@v1: spec 按需下发方案 A（bundle pull / sync push）
- type: architecture
- status: accepted
- source: user (step8)
- priority: P0
- question: spec 下发/回传采用哪种实现方案？
- answer: 方案 A — agent run 时 daemon `GET bundle` 拉 spec 到临时区，执行后 `POST sync` 整树回传；复用现有 lease，不引入同步引擎
- normalized_requirement: spec_workspace router 加 bundle/sync 端点；daemon task-runner 执行前拉取解包、执行后打包回传；回传统一覆盖服务器 spec_root + reparse
- impacts: [FR-bundle-sync, design §5 Phase4/§7.2, task spec-bundle]
- evidence: 用户 step8 回答（方案 A/B/C 对比选定）
