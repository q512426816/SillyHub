---
author: qinyi
created_at: 2026-06-23 10:35:00
change: 2026-06-23-spec-transport-tar-sync
---

# Decisions: spec 文档回传 backend 独占（transport 双模式）

本文件是变更 `2026-06-23-spec-transport-tar-sync` 的决策台账。D-xxx@vN 为本变更 scope
内编号，与其他变更（如 `spec_workspace/service.py` 注释中的 D-006@v1 whole-tree
overwrite）不冲突。

## D-001@v1: transport 正交于 strategy，走全局 config 不入库

- **type**: architecture
- **status**: accepted
- **source**: user（explore 阶段 AskUserQuestion）
- **question**: transport 维度与现有 `SpecWorkspace.strategy`（platform-managed/repo-mirrored/repo-native）如何关系？transport 存哪？
- **answer**: 两者正交。`strategy` = spec 存哪（仓库内 vs 平台托管目录）；`transport` = spec 怎么在 daemon 与 backend 间同步（shared 同机 bind mount / tar 异机回传）。transport 不入库，走全局 `Settings.spec_transport`。
- **normalized_requirement**: backend 读 `settings.spec_transport` 决定 prompt `--spec-root` 路径与是否让 daemon 触发 `_pullSpecBundle`/`postSpecSync`；`SpecWorkspace` 表不加 transport 字段。
- **impacts**: design §5.0、§8（无表结构变更）、§9（兼容策略）；纠正 explore 早期「加 transport/spec_owner 表字段」说法。
- **evidence**: explore 阶段用户选定「方案B 字段驱动」后，step6 进一步选定「全局环境变量」。
- **priority**: P0

## D-002@v1: transport 全局环境变量 `SPEC_TRANSPORT=shared|tar`

- **type**: architecture
- **status**: accepted
- **source**: user（step6 对话式探索 AskUserQuestion）
- **question**: workspace 的 transport 由什么决定？
- **answer**: 全局环境变量 `SPEC_TRANSPORT`，枚举 `shared|tar`，默认 `shared`（向后兼容现有同机部署）。同机开发设 shared，异机生产设 tar。不在 workspace 创建流程加选择。
- **normalized_requirement**: `Settings.spec_transport` 读 `SPEC_TRANSPORT` env，默认 `shared`，`field_validator` 规范化（小写 + 枚举校验）。
- **impacts**: design §5.0、§6（config.py 改动）、§9（默认 shared 零影响）；非目标 N1。
- **evidence**: step6 用户选「全局环境变量（推荐）」。
- **priority**: P0
- **已知约束**: 全局单一 → 同一 backend 不能同时服务同机 + 异机 daemon（混部需未来升级为 per-daemon transport，见风险 R-04、非目标 N1）。

## D-003@v1: tar 模式双向同步（回传 + 按需拉取）

- **type**: architecture
- **status**: accepted
- **source**: code 核实 + inference（用户「daemon 保留缓存」决策推导）
- **question**: tar 模式 spec 同步方向是单向还是双向？
- **answer**: 双向。
  - daemon → backend：lease complete 时 `postSpecSync` 打 tar 整树回传（一次性，D-004）；backend `apply_sync` 解到权威源 `/data/{ws}` + reparse。
  - backend → daemon：lease 开始时 `_pullSpecBundle` 拉取 backend 已有 spec bundle 解到本地 `~/.sillyhub/daemon/specs/{ws}`（缓存），供 agent 后续步骤（plan 读 design 等）直接读。
- **normalized_requirement**: tar 模式 `build_claim_payload` 不透传 spec_root → daemon `existingSpecRoot` 空 → `_pullSpecBundle` 触发；`specRoot` 变量 = 本地路径 → `postSpecSync` 触发。
- **impacts**: design §5.2、§7.2、§7.4（契约表）；G2 backend 独占 + daemon 缓存语义。
- **evidence**: `task-runner.ts:480`（postSpecSync）、`:1417-1438`（_pullSpecBundle）、`:1444-1449`（_resolveSpecDir 本地路径）；step6 用户选「保留作缓存」。
- **priority**: P0

## D-004@v1: shared 模式保持现状（向后兼容）

- **type**: compatibility
- **status**: accepted
- **source**: inference（基于 D-002 默认 shared）
- **question**: shared 模式现有行为是否保留？
- **answer**: 完全保留。transport=shared 时：prompt 用宿主路径 `spec_data_host_dir/{ws}`、bind mount 共享物理盘、不 pull 不回传、backend 读容器路径 reparse。现有同机部署零改动。
- **normalized_requirement**: shared 分支不改变 `build_claim_payload`（仍透传 spec_root）、不改 prompt 路径、不触发 daemon 回传。
- **impacts**: design §5.1、§9（兼容策略 G3）；降低回归风险。
- **evidence**: 现状代码 context_builder.py:467-487、lease/context.py:110-116、task-runner.ts:1422-1423（existingSpecRoot 非空 return null）。
- **priority**: P0

## D-005@v1: 数据可清不做迁移

- **type**: compatibility
- **status**: accepted
- **source**: CLAUDE.md 规则7（项目未上线，数据可清）
- **question**: 切换 transport 时历史 spec 数据如何迁移？
- **answer**: 不做迁移。切换 `SPEC_TRANSPORT` 后清空重来即可（重新 scan）。
- **normalized_requirement**: 实现不包含任何 transport 切换的数据迁移/兼容转换逻辑。
- **impacts**: design §3（非目标 N4）、§9（回退路径）。
- **evidence**: CLAUDE.md 规则7。
- **priority**: P1

## D-006@v1: test_context_builder 行 142/162 过时断言随重写（改测试不改代码）

- **type**: tech-debt
- **status**: accepted
- **source**: code 核实（用户测试发现）
- **question**: `build_scan_bundle` prompt 的 `--spec-root` 用 config 宿主路径（`spec_data_host_dir/{ws}`）而非入参 `spec_root`，测试 `test_build_scan_bundle_prompt_contains_spec_root`（行 142）断言 `--spec-root /data/specs/ws-abc` 已过时，改测试还是改代码？
- **answer**: 改测试，不改代码。代码是方案 B（commit `fcbf3fa7`）的故意双轨设计——prompt 用宿主路径（daemon 零配置），`bundle.spec_root`/`platform_metadata.spec_root` 用入参容器路径，经 bind mount 同一物理目录。改代码会破坏方案 B。本次 transport 改造里 prompt 路径改为按 transport 分支，该测试随之重写为分支断言。
- **normalized_requirement**: 重写 `test_context_builder.py:142/162` 为按 transport 分支断言（tar 模式含 `~/.sillyhub/daemon/specs/{ws}`，shared 模式含宿主路径）；不动 `build_scan_bundle` 的双轨字段语义。
- **impacts**: design §6（测试修正）、§11 决策追踪；本变更 scope，区别于 `spec_workspace/service.py` 注释中的另一变更 D-006@v1（whole-tree overwrite）。
- **evidence**: context_builder.py:483（prompt 用 host_spec_root）、:565/573（metadata/bundle 用入参）；commit fcbf3fa7。
- **priority**: P1

## D-007@v1: scan/stage 走 interactive，spec 同步在 interactive 路径 + 抽 spec-sync utility

- **type**: architecture（correction）
- **status**: accepted
- **source**: design-grill（step 12，X-001）
- **supersedes**: D-003@v1 中「复用 task-runner `_pullSpecBundle`+`postSpecSync`」的**实现位置**措辞（D-003 双向语义不变，仅实现从 task-runner 改为 interactive 路径 + 共享 utility）
- **question**: scan/stage 是否复用 task-runner 的 `_pullSpecBundle`/`postSpecSync`？
- **answer**: 否。scan（`prepare_scan_interactive_dispatch`）和 stage（`start_stage_dispatch`→`dispatch_to_daemon`→`prepare_interactive_dispatch`）都创建 `kind='interactive'` lease；daemon 对 interactive lease 走 `_startInteractiveSession`（`daemon.ts:1711`），**显式不调 TaskRunner.runLease**（`daemon.ts:1701-1702`）。因此 task-runner 的 pull/sync 双通道（`task-runner.ts:480/1417`）**只在 batch 路径**，scan/stage 完全不经过。tar 模式改为在 **interactive 路径**实现 spec 同步：`_startInteractiveSession` 调 `pullSpecBundle`（session 开始）、`onSessionEnd` 调 `postSpecSync`（session 终态）；task-runner 的 `_pullSpecBundle`/`_packSpecDir`/`_resolveSpecDir` 抽成共享 `spec-sync.ts` utility，batch 与 interactive 共用。
- **normalized_requirement**: 新增 `sillyhub-daemon/src/spec-sync.ts`（`pullSpecBundle`/`packSpecDir`/`resolveSpecDir`/`postSpecSync`）；`daemon.ts` `_startInteractiveSession` tar 模式 pull、`onSessionEnd` tar 模式 sync；`task-runner.ts` `runLease` 改调 utility（batch 行为不变）；`build_claim_payload` interactive 分支 tar 模式透传 `workspace_id`。
- **impacts**: design §5.0/5.2/5.3/§6/§7.2/7.3/7.4/§10/§13；plan Wave1 Layer3 范围扩大（新增 spec-sync.ts + daemon.ts interactive 接入）。
- **evidence**: `placement.py:341/429/504`、`service.py:1103`、`daemon.ts:1701-1702/1164/1711`、`task-runner.ts:480/1417/1444`、grep `daemon.ts`+`interactive/*.ts` 零命中 `_pullSpecBundle/postSpecSync/_packSpecDir`。
- **priority**: P0
- **scope clarification（D-008 补充）**: D-007 最初表述「scan/stage 都走 interactive」中 **stage 部分有误**——见 D-008@v1。

## D-008@v1: stage 走 batch lease（非 interactive），scan/stage 分流

- **type**: architecture（refinement）
- **status**: accepted
- **source**: plan step7（task-11 蓝图子代理核实代码）
- **supersedes**: D-007@v1 / X-001 中「stage 走 interactive lease」的表述（X-001 的 **scan** 部分仍正确，仅 **stage** 修正）
- **question**: stage（propose/plan/execute）走 interactive 还是 batch lease？
- **answer**: **batch**。分流：
  - **scan** → `prepare_scan_interactive_dispatch`（`placement.py:429`）→ `kind='interactive'`（`placement.py:513`）→ daemon `_startInteractiveSession`（不经 task-runner）；interactive 路径当前**无** spec pull/sync。
  - **stage** → `start_stage_dispatch`→`dispatch_to_daemon`（`placement.py:163/272`）→ `kind='batch'`（INSERT 无 kind 列，DB 默认 batch）→ daemon `TaskRunner.runLease` → **现有 `_pullSpecBundle`（步骤1.5）+ `postSpecSync`（步骤8.5）已覆盖**（stage batch claim payload 不 set specRoot → daemon pull 触发）。
- **normalized_requirement**: scan tar 回传靠 **task-06**（interactive 新接入 pull+sync）；stage tar 回传靠 **task-04/05**（batch utility 抽离，现有机制行为等价）+ task-10 prompt 本地路径。**task-06 范围 = scan only**，stage 不经 task-06。
- **impacts**: design §5.0（已重写 scan interactive / stage batch）、§13（X-005）；plan task-05（服务 stage batch）/task-06（scan only）；task-11 蓝图已正确覆盖 batch 路径（§0 事实修正）。
- **evidence**: `placement.py:163/272/399/513`、`test_interactive_session_placement.py:223-259`（TestBatchDispatchUnchanged 断言 stage lease `kind=='batch'` + `agent_run_id==run.id`）、`task-runner.ts:324/480`、`lease/context.py:119-200`（batch 分支不 set specRoot）。
- **priority**: P0
