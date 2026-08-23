---
author: qinyi
created_at: 2026-08-23 21:25:00
---

# 决策台账（2026-08-23-repo-native-spec-backfill）

> 每条记录必须有稳定版本 ID；被修正的决策用 @v2 并写明 supersedes。只记录有实现/验收影响的决策。

## D-001@v1: 修复落点双管（backend strategy 门禁 + CLI realpath 回环判定）
- type: architecture
- status: accepted
- source: user
- question: 修复 repo-native spec 回灌断链，改 SillyHub backend、sillyspec CLI 工具仓，还是两者？
- answer: 双管。backend `build_scan_bundle` 按 strategy 三分支（repo-native 走本地模板）；CLI 指针生命周期（写入/恢复/平台模式判定）加 realpath 回环判定。用户启动指令原文两手段并列（"不应带 specRoot（或 CLI 不因此禁用内置 sync）"）。
- normalized_requirement: ① repo-native 工作区的 scan prompt 不含任何平台参数（--spec-root/--runtime-root/--workspace-id/--scan-run-id）且不含 init 步骤；② CLI 侧 specRoot 解析后真实路径等于 cwd/.sillyspec 时按本地模式处理（不禁用内置 sync、不写/不恢复指针）。
- impacts: [Phase-1, Phase-2, verify]
- evidence: 用户启动指令；`backend/app/modules/agent/context_builder.py:354-479`（scan 模板无条件注入）；`sillyspec/src/run/shared.js:534-536`（平台模式跳过内置 sync，四处裸判定 536/609/631/698）；`sillyspec/src/run/command.js:309-359`（指针恢复链 + fail-closed）
- priority: P0

## D-002@v1: 仅 repo-native 改变行为，repo-mirrored/platform-managed 完全不变
- type: boundary
- status: accepted
- source: code
- question: 三策略中哪些的策略行为在本次变更中改变？
- answer: 仅 repo-native。platform-managed 维持平台模板；repo-mirrored scan 维持平台模板（daemon 缓存回灌链依赖平台模式）。
- normalized_requirement: platform-managed 与 repo-mirrored 的 scan bundle 输出与现状逐字节一致（回归测试断言既有快照不变）。
- impacts: [Phase-1, verify]
- evidence: `sillyhub-daemon/src/spec-sync.ts:127-141`（repo-mirrored 首次 cp/后续 pull，缓存为工作区）；`spec-sync.ts:104-119`（repo-native junction 直写源项目）
- priority: P0

## D-003@v1: daemon 第四回灌触发点为非目标
- type: boundary
- status: accepted
- source: user
- question: 是否在 daemon 侧为 repo-native 增加事件式自动回灌（本地 mtime 新于 synced_at 即推）？
- answer: 非目标，记后续变更。CLI 内置 sync 恢复后本地变更已有自动上行通道；平台会话结束回灌与手动「同步到服务器」按钮覆盖其余场景。
- normalized_requirement: 本次 daemon 零代码改动；spec-sync.ts 不进文件变更清单。
- impacts: [Phase-1, Phase-2]
- evidence: 用户上轮对话对"可选保险"未要求纳入；daemon 现有三触发点（`daemon.ts:1874` 会话结束 / outbox kind=spec-sync / D-008 pull 前回灌）
- priority: P1

## D-004@v1: scan 与 stage 的 repo-mirrored 门禁差异有意保留
- type: compatibility
- status: accepted
- source: code
- question: stage 派发只对 platform-managed 注入平台参数（service.py:1358），scan 对 repo-mirrored 也注入——本次是否统一？
- answer: 不统一，保留差异。repo-mirrored scan 走平台模式（daemon 缓存为同步锚），stage 走本地模式（产出经 CLI 内置 sync 增量上行，resolve-by-root-path 归属 workspace）。两通道（整树 tar + manifest 增量）并存是 platform_sync 既有设计。
- normalized_requirement: 不改 service.py:1358 的 stage 门禁；design 风险登记该差异，后续变更复核。
- impacts: [Phase-1]
- evidence: `backend/app/modules/agent/service.py:1352-1380`；`sillyspec/src/sync.js:307-312`（本地模式 resolve-by-root-path）
- priority: P2
