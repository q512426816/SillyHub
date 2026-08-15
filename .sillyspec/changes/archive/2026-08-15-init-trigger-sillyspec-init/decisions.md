---
author: qinyi
created_at: 2026-08-15T15:07:51
change: 2026-08-15-init-trigger-sillyspec-init
stage: brainstorm
status: draft
---

# 决策台账 — 2026-08-15-init-trigger-sillyspec-init

> 完整决策依据见 design.md「决策记录」章节；此处为可追溯台账。

## D-001@v1: 驱动方式 = daemon spawn CLI 子进程
- type: architecture
- status: accepted
- source: user
- question: daemon 如何驱动 sillyspec init？
- answer: spawn 子进程执行 `sillyspec init`（方案A）。否决 B（直调 npm 包 API，耦合 ESM/CJS 混合结构）、C（TS 复刻 init 动作，重演 2026-07-07 platform-json 双写漂移教训）。
- normalized_requirement: runSillyspecInit 经 spawn 调 CLI，不 import sillyspec 内部模块，不复制其逻辑。
- impacts: [FR-01, task-04]
- evidence: design.md D-001；2026-07-07-platform-json-contract-align D-001@v1
- priority: high

## D-002@v2: 插入位置 = pullSpecBundle 之后、postSpecSync 之前
- type: architecture
- status: accepted
- supersedes: D-002@v1（rev1"pull 之前"，被 Design Grill P0 否决）
- source: design-grill + user
- question: init 步骤插在编排哪个位置？
- answer: pull 之后。pullSpecBundle 是整删重建（spec-sync.ts:191-196 rm -rf 后解包），pull 前 init 的骨架会被物理删除且 .runtime（sillyspec.db）不在 bundle 中无法恢复。后置则骨架免删，且 postSpecSync（其后）把骨架回传服务器。
- normalized_requirement: handleInitLease 编排序 = writeDaemonState → pullSpecBundle → runSillyspecInit → postSpecSync → writeLocalYaml。
- impacts: [FR-01, task-05]
- evidence: Grill X-01（spec-sync.ts:191-196）；用户 2026-08-15 拍板修法 a
- priority: high

## D-003@v1: init 失败 = 硬失败，lease 终态 failed
- type: boundary
- status: accepted
- source: user
- question: init 命令失败时 lease 终态？
- answer: 硬失败（对齐 2026-08-12-init-provision-local-yaml D-003 写盘失败先例）；error 前缀 sillyspec_init_failed: / sillyspec_init_cli_too_old。
- normalized_requirement: ok:false → abort 后续步骤 → _finish(false) lease failed。
- impacts: [FR-02, task-05]
- evidence: design.md D-003
- priority: high

## D-004@v1: skills 只走 skill-manager，init 跳过 skills 复制
- type: boundary
- status: accepted
- source: user
- question: init 的 skills 复制与 skill-manager 双渠道冲突？
- answer: 只留 skill-manager 渠道；CLI 加 --no-skills 开关，init 不复制 skills。
- normalized_requirement: runSillyspecInit 必传 --no-skills；skill-manager 链路不动。
- impacts: [FR-01, FR-07, task-01, task-04]
- evidence: design.md D-004；skill-manager.ts 独立链路核实
- priority: high

## D-005@v1: 目标工具 = agent-detector 检测结果映射
- type: boundary
- status: accepted
- source: user
- question: init 装给哪些 AI 工具？
- answer: daemon 检测到什么装什么（VALID_TOOLS 同名交集）；空兜底 ['claude']（与 sillyspec detectTools 空兜底一致）。
- impacts: [FR-04, task-06]
- evidence: Grill X-04（agent-detector 12 provider 与 VALID_TOOLS 6 值同名可映射）
- priority: medium

## D-006@v1: 超时 60s
- type: definition
- status: accepted
- answer: init 纯本地 fs+SQLite 无网络，60s 充裕；超时按失败处理，杀树防孤儿。
- impacts: [FR-02, NFR-01, task-04]
- priority: medium

## D-007@v1: tools 透传 = cli.ts 构造注入 detectedAgents
- type: architecture
- status: accepted
- source: design-grill
- question: agent-detector 结果（Daemon._agentPaths 私有）如何到达 _runInitLease？
- answer: cli.ts 构造 TaskRunner 前先跑 detectAgents（或静态探测）映射后构造注入；创建点在 cli.ts 非 daemon.ts（复核 N-03 修正）；缺省兜底 ['claude']。
- impacts: [FR-04, task-06]
- evidence: Grill X-03 + 复核（new TaskRunner 唯一处 cli.ts:769，detectAgents 在 Daemon.start():905 晚于构造）
- priority: high

## D-008@v2: 骨架多成员冲突 = backend 同 hash no-op + daemon 排除 projects/
- type: architecture
- status: accepted
- supersedes: 原非目标"backend 零变更"（用户解除）
- source: design-grill + user
- question: 第二成员的骨架文件 add(base_version=0) 对服务器已有行必冲突怎么解？
- answer: backend apply_ops 冲突分支加同内容豁免（op.hash == row.content_hash → no-op 不 conflict，new_versions 回 row.version）；projects/<name>.yaml（含成员机器绝对路径互异）三处排除不上传。
- impacts: [FR-05, FR-06, task-07, task-09]
- evidence: Grill X-02/X-16 + 复核 N-01（三处排除防全量路径漏传与 delete op 误删）
- priority: high

## D-009@v1: spawn 前版本门控
- type: risk
- status: accepted
- source: design-grill + user
- question: 老 CLI 静默忽略 --no-skills 且 exit 0、preflight 仅启动跑一次，怎么防？
- answer: runSillyspecInit 先跑 sillyspec --version（3s），低于 MIN_SILLYSPEC_VERSION_FOR_INIT 即 fail-fast，中文升级指引；升级后无需重启 daemon。
- impacts: [FR-03, task-04]
- evidence: Grill X-09/X-10（index.js 未知 flag 落 filteredArgs 不报错；preflight.ts:84-99 仅启动跑）
- priority: high
