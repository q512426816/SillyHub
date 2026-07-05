---
id: task-03
title: 实现「工作区文档存储」组渲染
change: 2026-07-05-workspace-config-card
created_at: 2026-07-05T01:18:51
author: qinyi
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-001, FR-002, FR-004]
decision_ids: [D-001@V1, D-002@V1, D-004@V1]
allowed_paths:
  - frontend/src/components/workspace-config-card.tsx
---

## Goal

在 task-01 骨架基础上，于 WorkspaceConfigCard 内渲染「工作区文档存储」共享只读组：spec_root / runtime_root 派生 / cache_root+tooltip / sync_status 徽标 / last_synced_at / strategy **六字段**（**不展示工作区级 spec_version**——R-07：frontend SpecWorkspace 类型 + SpecWorkspaceRead + backend schema 均无此字段，仅 profile_version 语义不符；版本仅「我的接入」组展示 myBinding.init_synced_spec_version），无任何编辑入口（D-002@V1）。来源 `props.specWs: SpecWorkspace | null`（D-001@V1）。

## Implementation

1. 在卡片内「我的接入」组下方新增「工作区文档存储」SectionCard 子区块（标题 + dl 网格，沿用 page.tsx 第 787-819 行现有样式 `grid-cols-[8rem_1fr] gap-y-1 text-xs`）。
2. **派生值**（前端拼，§7.3）：`const runtimeRoot = specWs?.spec_root ? \`${specWs.spec_root}/runtime\` : null;`；`const cacheRoot = \`~/.sillyhub/daemon/specs/${workspace.id}\``。
3. **字段渲染**（§7.4 表，6 字段）：
   - 服务器文档目录：`specWs.spec_root`，mono+truncate+title 全路径。
   - runtime 目录：派生 `runtimeRoot`，mono+truncate+title。
   - 守护进程本地缓存：`cacheRoot`，仅 `workspace.path_source !== 'server-local'` 渲染（即 daemon-client），mono+truncate，外层 tooltip 含 `~` 三平台解释（见 constraints）。server-local 时该字段整行不渲染。
   - 同步状态：复用 page.tsx 现有 `SYNC_STATUS_VARIANT` / `SYNC_STATUS_LABEL` 常量，Badge 渲染 `specWs.sync_status`（clean=emerald/pending=amber/conflicted/dirty=red）。
   - 上次文档同步：`formatTs(specWs.last_synced_at)`（复用现有工具）。
   - spec 策略：复用 `STRATEGY_LABEL[specWs.strategy]`，Badge。
   - **不展示「文档版本」**：`specWs.profile_version` 是 scan profile 格式版本（如 "0.1.0"）非文档递增版本，对用户无意义；`spec_version`（文档递增版本）在 frontend 类型 + backend SpecWorkspaceRead schema 均缺失（R-07/workspace-config-flow task-09 遗漏），本变更不展示工作区级版本号（版本仅「我的接入」组的 init_synced_spec_version，task-02 负责）。
4. **无编辑入口**（D-002@V1 / AC-03）：整组 `<dl>` 只输出 `<dt>/<dd>`，无按钮、无 input、无 onClick；不渲染「编辑」入口。
5. **空态**：`specWs == null` 时整组显示「当前工作区尚未关联 Spec Workspace」（沿用 page.tsx 第 822 行文案），仍保留组标题。

## Acceptance

- AC-02：daemon-client 工作区下完整渲染 6 字段（spec_root/runtime_root/cache_root/sync_status/last_synced_at/strategy），数据全部来自 `props.specWs`（D-001@V1）。**不展示工作区级 spec_version/profile_version**（R-07）。
- AC-03：整组无任何编辑入口（无 button/input/可点击 chip）。
- AC-04：cache_root 行 tooltip 文案含 `~` 三平台解释（Windows/macOS/Linux 各自 home 路径）。
- AC-10：所有路径字段 mono+truncate+title；中文标签 + 英文术语（spec_root/runtime_root 等保留英文）。

## Verify

```
cd frontend && pnpm exec tsc --noEmit
cd frontend && pnpm exec vitest run src/components/workspace-config-card.test.tsx
```

task-03 仅交付渲染层，单测由 task-08 统一覆盖；本任务 verify 以类型检查通过 + 组件在 page.tsx 手动渲染无报错为准。

## Constraints

- **runtime_root 派生**：`specWs.spec_root + "/runtime"`，spec_root 为空则该字段不渲染（D-002@V1）。
- **cache_root 约定模板**：`~/.sillyhub/daemon/specs/<workspace.id>`，前端硬拼，不请求后端（D-004@V1）。
- **cache_root tooltip 文案**（CLAUDE.md 规则 15 通俗化）：「守护进程在你电脑上缓存这个工作区文档的位置。`~` = 你的用户主目录（Windows: `C:\Users\<你>`；macOS/Linux: `/home/<你>`）」。
- **path_source !== 'daemon-client' 隐藏 cache_root**：server-local 工作区无 daemon 概念，整行不渲染（D-004@V1 / §5.3）。`workspace.path_source` 来自 props.workspace。
- **共享组无编辑入口**（D-002@V1）：spec_root/runtime_root 是工作区共享权威值，本变更范围禁止改；本任务不渲染任何可交互控件。
- **中文标签 + 英文术语**：dt 用中文（「服务器文档目录」「runtime 目录」「守护进程本地缓存」「文档版本」「同步状态」「上次文档同步」「spec 策略」），路径/字段值保留英文/原值；CLAUDE.md 规则 11/15。
- **不展示工作区级「文档版本」**（R-07）：`SpecWorkspace` 类型字段实际是 `profile_version`（lib/spec-workspaces.ts:18，语义是 scan profile 格式版本如 "0.1.0"，对用户无意义）；`spec_version`（文档递增版本）在 frontend SpecWorkspace 类型 + SpecWorkspaceRead OpenAPI（api-types.ts:11236）+ backend SpecWorkspaceRead schema（schema.py:32-44）均缺失（workspace-config-flow task-09 加了 DB 列但未暴露到 Read schema 的遗漏）。本变更**不展示**工作区级版本号，避免扩大范围碰 backend schema（违反 N4）。版本仅「我的接入」组的 `myBinding.init_synced_spec_version`（task-02 负责）。workspace-config-flow 后续补 spec_version 到 schema + gen:types 后可低成本加回。
- **复用现有常量**：`STRATEGY_LABEL` / `SYNC_STATUS_VARIANT` / `SYNC_STATUS_LABEL` 从 page.tsx 等价迁入或抽到组件内（task-07 迁移时统一处理，本任务可临时局部声明，避免与 page.tsx 冲突；优先 import 共享）。
- **不读项目根 .sillyspec-platform.json**（D-001@V1 / N2）：所有字段来自 `props.specWs`，不读本地文件。
