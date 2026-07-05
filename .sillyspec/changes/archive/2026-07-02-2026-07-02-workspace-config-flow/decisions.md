---
author: qinyi
created_at: 2026-07-02 09:52:30
---

# 决策台账 — 2026-07-02-workspace-config-flow（工作区配置流程重设计）

> 本变更的决策记录，每条稳定 ID（D-XXX@vN）。仅记录有实现/验收影响的决策。

## D-001@V1: 文档同步策略 = 整包（YAGNI）
- type: architecture
- status: accepted
- source: user
- question: 平台↔客户端文档同步，整包传还是清单增量？
- answer: 先整包够用再说。文档真大了再升级增量。
- normalized_requirement: spec 树同步复用现有 tar 整树通道（build_bundle / apply_sync / postSpecSync），不做传输层 manifest/版本握手。保留 spec_version 字段作为未来增量扩展点。
- impacts: [W3, verify-整包同步]
- evidence: 用户 step6 决策；spec_workspace/service.py build_bundle:507-548 / apply_sync:682-701 现状
- priority: high

## D-002@V1: 初始化按钮重定义
- type: premise
- status: accepted
- source: user
- question: 「初始化」（下发平台配置到客户端）与现有「初始化」（服务器建 spec 容器）关系？
- answer: 重定义现有按钮——改为「派 init 任务 → daemon 写 .sillyspec-platform.json + pull 文档缓存 + 回灌本地改动」。服务器建 spec_workspace 容器逻辑保留并自动化（在 init dispatch 前完成，不单占按钮）。
- normalized_requirement: 详情页「初始化」按钮（workspaces/[id]/page.tsx:479-491）改为触发 init lease dispatch；bootstrapSpecWorkspace 建容器逻辑作为 init dispatch 的前置自动步骤。
- impacts: [W2, frontend 详情页, backend init dispatch]
- evidence: 用户 step6 决策；现有 bootstrapSpecWorkspace（spec_workspace/service.py）
- priority: high

## D-003@V1: 扫描归属 = 任意成员可扫 + 已有则提示
- type: boundary
- status: superseded by D-003@V2
- source: user
- question: 谁有资格扫描？后来的人怎么处理？
- answer: （已被 V2 取代）任意成员可扫 + 已有则提示。
- normalized_requirement: —
- impacts: []
- evidence: 用户 step6 决策；2026-07-02 用户改为 owner-only
- priority: high

## D-003@V2: 扫描归属 = 仅 owner 可扫
- type: boundary
- status: accepted
- supersedes: D-003@V1
- source: user
- question: 谁有资格扫描？非 owner 怎么处理？
- answer: 仅 workspace owner 可扫描；非 owner 点扫描被拒绝并引导「仅 owner 可扫描，你只需初始化拉文档」。owner 扫描时若工作区已有 scan_documents（count>0）仍弹「已扫过，是否重扫」确认（D-004 永不过期）。
- normalized_requirement: scan_generate 校验 actor 是否该 workspace owner；非 owner 返回 403 + 提示；owner 扫描时 count>0 且无 force=true 返回 409 + 重扫确认。
- impacts: [W2 扫描门禁, backend scan_generate owner 校验, frontend 扫描按钮非 owner 禁用/引导]
- evidence: 用户 2026-07-02 明确"改为 owner 扫描"；workspace owner role（workspace/members）
- priority: high

## D-004@V1: 扫描有效期 = 永不过期
- type: boundary
- status: accepted
- source: user
- question: 「已扫过」如何判定？有无有效期？
- answer: 扫过就算数，永不自动过期。判定 = scan_documents count > 0。重扫需手动确认（D-003）。
- normalized_requirement: 不引入 last_scan_at 过期判断；count > 0 即视为已扫。
- impacts: [W2 扫描门禁]
- evidence: 用户 step7 决策
- priority: medium

## D-005@V1: 初始化 vs 扫描 = 初始化只拉已有，无则提示先扫
- type: boundary
- status: accepted
- source: user
- question: 工作区还没人扫过（服务器无文档）时，新成员点初始化怎么办？
- answer: 初始化只拉已有文档缓存；服务器无文档则提示「工作区尚未扫描，请先扫描」。扫描保持独立按钮，初始化不自动触发扫描。
- normalized_requirement: init dispatch 完成后，若 spec_workspace 无 scan_documents，前端引导提示「请先扫描」；初始化与扫描是两个独立动作。
- impacts: [W2, frontend 流程引导]
- evidence: 用户 step7 决策
- priority: high

## D-006@V1: per-member 接线 = 复用 WorkspaceMemberRuntime
- type: architecture
- status: accepted
- source: code
- question: 每个成员各自的 daemon + 本地路径如何实现？
- answer: 复用已落地的 WorkspaceMemberRuntime 表（commit e2f65d9a）。scan/dispatch 改用 MemberBindingResolver.resolve_member_binding(workspace_id, actor_user_id) 按 actor 路由，替代当前按 user_id + workspace 全局 daemon_runtime_id。
- normalized_requirement: AgentService.start_scan_dispatch / RunPlacementService._resolve_dispatch_runtime / _resolve_decide_runtime 改读 WorkspaceMemberRuntime（按 actor）；废弃 workspace 全局 daemon_runtime_id/root_path 在 dispatch 的读取（表保留只读，见 member_runtimes/model.py:1-8 注释）。
- impacts: [W1, backend agent/placement.py + agent/service.start_scan_dispatch]
- evidence: backend/app/modules/workspace/member_runtimes/{model,resolver,service,router}.py 已就绪；agent/placement.py:459 _get_online_runtime 当前按 user_id（grep resolve_member_binding 在 start_scan_dispatch 命中 0）
- priority: high

## D-007@V1: 客户端路径 = per-member 可编辑
- type: architecture
- status: accepted
- source: code + user
- question: 客户端路径（root_path）编辑粒度？
- answer: per-member（每人本地路径不同）。已绑定后可在详情页「编辑我的接入配置」入口修改 runtime_id / root_path / path_source。
- normalized_requirement: 详情页加「编辑我的接入配置」入口，调 PUT /api/workspaces/{id}/my-binding（已存在）；首次引导卡 + 已绑定编辑共用 WorkspaceAccessGuide 形态（回填当前值）。
- impacts: [W1 frontend, lib/workspace-binding.ts upsertMyBinding 复用]
- evidence: WorkspaceMemberRuntime 复合主键 (workspace_id, user_id) + root_path 字段；member_runtimes/router.py PUT /my-binding 已通
- priority: high

## D-008@V1: 双向冲突 = pull 前先 push 本地改动
- type: risk
- status: accepted
- source: user（隐含）+ code
- question: 客户端缓存被 pull 整树覆盖 vs 本地未回灌改动，谁赢？
- answer: 服务器权威，但 pull 前若本地有未回灌改动（postSpecSync 失败标记 / 本地缓存 mtime 新于上次 synced_at），先 postSpecSync 回灌再 pull。整树覆写语义保留（daemon-client-spec-sync-strategy D-006）。
- normalized_requirement: daemon pullSpecBundle 前检查本地是否有未回灌改动；有则先 postSpecSync；服务器 apply_sync 落盘的 sha256+mtime 去重 + ScanDocConflictService 冲突归档保留。
- impacts: [W3, daemon spec-sync.ts pullSpecBundle]
- evidence: spec_workspace/service.py apply_sync 整树覆盖（D-006 whole-tree overwrite）；ScanDocConflictService.archive_conflict
- priority: high

## D-009@V1: 平台配置下发 = init lease（任务驱动 / 方案 A）
- type: architecture
- status: accepted
- source: user（step8 方案 A）
- question: 配置和文档怎么从平台到客户端 daemon？初始化下发 + 日常保鲜机制。
- answer: 任务驱动——init 走 lease（复用 scan lease 通道）。daemon 拉到 init lease 后执行写 .sillyspec-platform.json + pullSpecBundle + postSpecSync。
- normalized_requirement: 新增 init lease mode（类比 scan lease）；backend start_init_dispatch 派发；daemon（task-runner/interactive 路径）处理 init lease，写配置 + 拉文档 + 回灌。
- impacts: [W2 backend init dispatch + daemon init handler]
- evidence: 用户 step8 选方案 A；agent/service.start_scan_dispatch 现有 lease 模式可复用
- priority: high

## D-010@V1: 缓存日常保鲜 = 操作前查 spec_version
- type: architecture
- status: accepted
- source: code（合理默认）
- question: 客户端缓存如何保持最新（服务器文档被他人重扫更新）？
- answer: daemon 每次 agent/scan 任务执行前，比对 lease payload 携带的 latest_spec_version 与本地缓存版本（.sillyspec-platform.json.spec_version）；不一致则触发 pullSpecBundle。
- normalized_requirement: lease payload 增加 latest_spec_version 字段；daemon 本地 .sillyspec-platform.json 记录 synced spec_version + synced_at；不一致触发 pull（整包）。
- impacts: [W3, lease payload 契约, daemon 版本检查]
- evidence: SpecWorkspace 表（spec_workspace/model.py）可承载 spec_version；.sillyspec-platform.json 定义含 spec_version
- priority: medium

## D-011@V1: WorkspaceDaemonSwitcher per-member 化（Design Grill X-001 修正）
- type: consistency
- status: accepted
- source: code（Design Grill 自审）
- question: 现有 WorkspaceDaemonSwitcher 改的是 workspace 全局 daemon_runtime_id，但 D-006 要废弃 dispatch 读全局列——Switcher 改的字段将不再被用，矛盾。
- answer: W1 把 WorkspaceDaemonSwitcher 改为改 per-member runtime_id（调 PUT /my-binding 的 runtime_id 字段），与「编辑我的接入配置」入口统一。不再写 workspace 全局 daemon_runtime_id。
- normalized_requirement: WorkspaceDaemonSwitcher 的 handleSwitch 从 updateWorkspace({daemon_runtime_id}) 改为 upsertMyBinding({runtime_id})；UI 文案保持「切换守护进程」语义。
- impacts: [W1 frontend, workspace-daemon-switcher.tsx:98]
- evidence: Design Grill X-001；workspace-daemon-switcher.tsx:98 现调 updateWorkspace
- priority: high

## D-012@V1: 手动同步入口（本地手改 spec → 服务器，复用 outbox）
- type: architecture
- status: accepted
- source: user（话题A，2026-07-02）+ 方案 a（复用 outbox，对齐 2026-07-02-change-detail-file-tree-editor）
- question: 用户手动在客户端本地改了 spec 文档（不经 agent 任务），怎么同步回服务器？
- answer: 前端就绪态加「同步到服务器」按钮，复用 DaemonChangeWrite outbox（kind 扩展 spec-sync 取值，与 change-detail-file-tree-editor 共享基础设施）。path_source 分流：server-local 直接收；daemon-client 建 kind=spec-sync outbox 行 → daemon 轮询拉取 → 执行 postSpecSync 整树回灌服务器（apply_sync 落盘）→ complete。复用 outbox 状态机/轮询/离线续传。agent 任务产生的改动仍由任务结束自动 postSpecSync 覆盖（W3）。
- normalized_requirement: DaemonChangeWrite.kind 加 spec-sync 取值（依赖 change-detail-file-tree-editor 的 kind 字段 migration 先合）；前端按钮建 outbox 行；daemon 接 kind=spec-sync 行 → postSpecSync（整树 push）；前端轮询 pending→done（对齐 change-detail 状态机）。
- impacts: [W3 daemon spec-sync outbox 处理, W4 frontend 同步按钮+轮询]
- evidence: 用户话题A；change-detail-file-tree-editor D-001/D-006 outbox+path_source 分流范式；spec-sync.ts postSpecSync
- priority: medium
- 交叉点: 依赖 2026-07-02-change-detail-file-tree-editor 的 daemon_change_writes.kind 字段先落地；两变更并行执行，plan 排 migration 依赖顺序（避免双 head）。
