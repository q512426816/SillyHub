---
author: qinyi
created_at: 2026-10-09 11:27:43
---

# 决策记录 — 2026-10-09-tombstone-conflict-root-fix

## D-001@v1: 断根范围=三件全做，③收敛形态=隔离区不硬删
- type: scope
- status: accepted
- source: user
- question: 断根范围怎么定？③的 daemon 收敛形态怎么定（硬删 / 归档区 / 隔离区）？
- answer: 用户选「三件全做（推荐）」——①CLI 归因记账+绿同步清陈旧记录（sillyspec CLI 仓）、②前端冲突行露墓碑根因并隐藏无效裁决入口（daemon→backend→frontend 链路）、③平台删除变更时向绑定数据源机器下发收敛指令。③形态选「隔离区不硬删（推荐）」——daemon 把本地目录移入 `.sillyspec/.runtime/tombstone-quarantine/`（同步树外、不进 git、可找回），进度库行归档；**不移入 changes/archive/**（墓碑守卫对归档区前缀同样拒收，会二次撞墙）。
- normalized_requirement: 三个修复全部纳入本变更范围；daemon 收敛动作 = 移动目录至 `.runtime/tombstone-quarantine/<change>-<时间戳>/` + 进度库 ghost 归档同款语义，禁止 rm。
- impacts: [FR-01, FR-02, FR-03]
- evidence: 用户回答轮次 1（AskUserQuestion 两问）；背景事实：sillyspec 仓 91 条墓碑冲突实证（conflicting_paths 空 + platform_deleted 并集=salv 两路径）；`backend/app/modules/platform_sync/service.py` `_change_key_deleted` 对归档区三段前缀同样拒收。
- 故障面: 隔离区目录若用户手工拷回 changes/ 下会再次撞墓碑（属人为复活，CLI 横幅有指引可处置）。

## D-002@v1: 实现架构=方案 A（注册表直读 + 指令通道复用）
- type: architecture
- status: accepted
- source: user
- question: 三件全做的实现架构选哪个？（A 注册表直读+指令复用 / B 心跳 schema 四层透传 / C CLI 单端自检自愈）
- answer: 用户选方案 A（推荐）。②前端从 backend `spec_conflicts` 注册表直读 platform_deleted（`_upsert_sync_conflict` 已把 details_json.platform_deleted 落库，daemon 心跳链路零改动）；③平台删除变更入口复用 resolve/ghost_cleanup 指令通道新增 `tombstone_cleanup` action，回执走既有 `sillyspec_command_result`。拒 B（backend 注册表已有同样数据，心跳 model→openapi→api-types→前端四层透传属重复建设，且 daemon 不发版前端上不了）；拒 C（CLI 自动动用户目录违反 SpecPushConflict 人工拍板语义——spec-sync.ts:259 钉死注释；daemon 自动同步链路不经 CLI，覆盖不全）。
- normalized_requirement: ②数据源=GET /spec-conflicts（或其前端 API 封装），不改 MachineSillySpecStatusRead 心跳 schema；③新 action 走既有平台→daemon 指令通道与回显链路（含旧 daemon 静默忽略的 150s 超时兜底，R-03 同款）；①CLI 仓独立变更（跨仓交付，见 proposal 拆分）。
- impacts: [FR-01, FR-02, FR-03]
- evidence: 用户回答轮次 1（AskUserQuestion 方案对比）；机制词检索命中 D-005@v1（knowledge/decisions/backend.md:25——删除自动收敛=镜像驱动收敛，已拒「墓碑上行驱动」）：本方案③是本机磁盘收敛层，与 D-005 的平台镜像收敛层互补不冲突；`backend/app/modules/spec_workspace/service.py:1283`（_upsert_sync_conflict 已存 platform_deleted）；`sillyhub-daemon/src/sillyspec-manager.ts:1189`（指令集 resolve/ghost_cleanup 现状）。
- 故障面: ②依赖 daemon 上报的冲突与注册表行的时间差（心跳 15s + 采集 ≤75s，前端以注册表为准展示墓碑详情）；③旧 daemon 静默忽略指令（150s 超时回显恢复，与 resolve/ghost_cleanup 同款既有兜底）。
- 退役判据: 若未来冲突展示统一收敛到单一数据源（注册表），②的直读即终态；若指令通道升级为推送制，③的轮询复用段随之迁移。
