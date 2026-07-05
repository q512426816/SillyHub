---
author: qinyi
created_at: 2026-06-28T04:11:00
---

# Decisions — daemon-client workspace spec 同步策略可选

本变更的决策台账（非长期术语表）。仅记录有实现/验收影响的决策。

## D-001@v1: strategy 须经 lease payload 透传到 daemon（新增链路）
- type: architecture
- status: accepted
- source: code
- question: daemon 端如何感知 workspace 的 spec 同步 strategy？
- answer: 代码查证——daemon 端 `grep strategy` 零匹配，`sillyhub-daemon/src/types.ts` LeaseCtx（execPayload）无 strategy 字段（仅 rootPath/transport/workspaceId 等），`backend/app/modules/agent/service.py:1374` dispatch 时 `spec_strategy="platform-managed"` 硬编码。故 strategy 当前完全未传到 daemon，须新增透传链路。
- normalized_requirement: strategy 作为 scan lease payload 字段，经 `agent/service.py start_scan_dispatch` → `prepare_scan_interactive_dispatch` → `daemon/lease/context.py build_claim_payload`（interactive 分支，与 transport/workspaceId 并列）→ daemon `types.ts LeaseCtx.specStrategy` → `daemon.ts _startInteractiveSession` 读取 → `pullSpecBundle`。AgentRun.spec_strategy（service.py:1374）改为读 `spec_ws.strategy` 而非硬编码。
- impacts: [Phase1, Phase2, task-backend-dispatch, task-daemon-pull-branch]
- evidence: sillyhub-daemon/src grep strategy=0；types.ts:223/288/293；agent/service.py:1374；daemon/lease/context.py task-03 改动点
- priority: P0

## D-002@v1: repo-mirrored canonical 语义 = 初始化单次同步快照
- type: term
- status: accepted
- source: user+code
- question: `spec_workspaces.strategy='repo-mirrored'` 的真实语义？用户称"单次同步"，但 `model.py:31` 注释为 "synced bidirectionally"。
- answer: 采用用户在对话式探索确认的"初始化单次同步快照"语义——daemon 首次 pull（404 或缓存空）时从 `rootPath/.sillyspec` 单次复制到 `~/.sillyhub/daemon/specs/{ws}`，之后平台托管，源项目后续变更不自动反映（分叉）。model.py 旧注释 "bidirectionally synced" 从未实现（所有 workspace 实际皆 platform-managed），实现时同步更新注释。
- normalized_requirement: repo-mirrored 下 pullSpecBundle 在 getSpecBundle 返回 404 或本地缓存为空时，执行一次 `fs.cp(rootPath/.sillyspec → specDir)`；非 404 正常拉 bundle。不实现持续双向同步。model.py repo-mirrored 注释更新为"初始化单次同步快照"。
- impacts: [Phase1-model-comment, Phase2-repo-mirrored-branch]
- evidence: model.py:31 旧注释；用户 step6/step7 确认
- priority: P0

## D-003@v1: 范围限定 daemon-client workspace
- type: boundary
- status: accepted
- source: user
- question: strategy 可选覆盖哪些 workspace 类型？
- answer: 只 daemon-client。server-local 的 strategy 选项（含 .runtime 补全、repo-native 容器路径直读）列为非目标，后续单独变更。理由：用户痛点在 daemon-client；server-local 的 repo-native 软链接落在 backend Docker 容器内（container_path_prefix 路径），与 daemon-client 客户端 junction 是两套机制，混做放大复杂度。
- normalized_requirement: 本次改动只影响 `workspace.path_source=='daemon-client'` 的创建与 scan 链路；server-local 创建（_ensure_spec_workspace copytree）行为不变。
- impacts: [全变更范围约束]
- evidence: 用户 step7 确认；workspace/service.py:1100 vs 1245
- priority: P0

## D-004@v1: 默认值保持 platform-managed
- type: boundary
- status: accepted
- source: user
- question: daemon-client workspace 创建时 strategy 默认值？
- answer: 保持 `platform-managed`，不改变现有 workspace 行为。用户主动选才切换到 repo-mirrored/repo-native，避免意外写入源项目。
- normalized_requirement: 前端创建表单 strategy 选项默认选中 platform-managed；后端 WorkspaceCreate.spec_strategy 默认 'platform-managed'；未显式传 strategy 时行为与现状一致（空 spec_root 等 scan）。
- impacts: [Phase1-前端默认, Phase1-schema-default]
- evidence: 用户 step6 确认
- priority: P1

## D-005@v1: repo-native 接受 daemon scan 写入源项目
- type: boundary
- status: accepted
- source: user
- question: repo-native（junction）下 daemon scan 直接操作源项目 .sillyspec，是否接受此副作用？
- answer: 接受。daemon scan 产出会写入源项目 `rootPath/.sillyspec`；若该目录被 git 跟踪，产出变成源项目工作区改动，由用户自行 commit。这是"源项目即真理"语义的必然结果，在 UI 选项说明中明示。
- normalized_requirement: repo-native 选项 UI 文案明确标注"会写入源项目"；daemon pullSpecBundle repo-native 分支建 junction 后 scan 天然写源项目，不做写入拦截。
- impacts: [Phase1-前端文案, Phase2-repo-native-branch]
- evidence: 用户 step6 确认
- priority: P1
